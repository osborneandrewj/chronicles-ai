import type { HostRoster, PlaceConnection } from '@/domain/entities'
import type {
  CharacterRepository,
  Clock,
  DossierWriter,
  ReverieRepository,
  WorldArchetypeProvider,
  WorldArchetype,
  PlaceConnectionInput,
  PlaceConnectionRepository,
  PlaceRepository,
  RelationshipInput,
  RelationshipRepository,
  WorldRepository,
} from '@/domain/ports'
import type { OpeningPlotSeeder } from '@/domain/ports/opening-plot-seeder'
import type {
  EnsembleGenerator,
  GeneratedEnsemble,
} from '@/domain/ports/ensemble-generator'
import { buildDeckGraph, isConnected, orphanRooms } from '@/domain/services/deck-graph'
import { serializeRefusals } from '@/domain/services/host-refusals'
import { ensureSeedTension } from '@/domain/services/seed-tension'
import { capSpeechRegister } from '@/domain/services/speech-staging'

// SeedBoundedWorld (starship P1) — pure orchestration that turns an authored
// deck-plan template plus LLM-generated dressing into a bounded world: one
// `worlds` row, one place per room, the topology edges, one character per crew
// member at their home room, and the relationship graph. No SQL, no SDK, no
// framework — every store/LLM seam is an injected port. The only deciding logic
// it runs in-process is the deck-graph connectivity validation (a pure domain
// service) over the rooms it just wrote; mapping a thrown error to HTTP/UI is an
// adapter concern, not this layer's.

export class TemplateNotFoundError extends Error {
  constructor(public readonly templateId: string) {
    super(`Deck-plan template ${templateId} not found`)
    this.name = 'TemplateNotFoundError'
  }
}

export class DisconnectedTopologyError extends Error {
  constructor(
    public readonly worldId: number,
    public readonly orphanPlaceIds: number[],
  ) {
    super(
      `Seeded world ${worldId} topology is disconnected; orphan place ids: ${orphanPlaceIds.join(', ')}`,
    )
    this.name = 'DisconnectedTopologyError'
  }
}

export type SeedBoundedWorldInput = {
  templateId: string
  name: string
  premise: string
  playerName?: string
  roster?: HostRoster
}

export type SeedBoundedWorldResult = {
  worldId: number
  placeIds: number[]
  characterIds: number[]
}

export type SeedBoundedWorldDeps = {
  decks: WorldArchetypeProvider
  crew: EnsembleGenerator
  worlds: WorldRepository
  places: PlaceRepository
  placeConnections: PlaceConnectionRepository
  characters: CharacterRepository
  relationships: RelationshipRepository
  clock: Clock
  /** When set, seed 2–3 Booker-shaped opening threads after the ensemble. */
  dossierWriter?: DossierWriter
  openingPlotSeeder?: OpeningPlotSeeder
  /** Cornerstone writes for authored hosts. */
  reveries?: ReverieRepository
}

// Resolve a crew member's daily-loop place reference (a template room key OR its
// display name, per the EnsembleGenerator contract) to a seeded place id. Anything
// that fails to resolve falls back to the crew member's home room so the loop
// always points at a real room rather than free text (the seed-time invariant).
function resolveDailyLoop(
  dailyLoop: Record<string, { activity: string; place?: string }>,
  template: WorldArchetype,
  placeIdByRoomKey: Map<string, number>,
  homePlaceId: number,
): Record<string, { activity: string; place_id: number }> {
  const idByName = new Map<string, number>()
  for (const room of template.rooms) {
    const placeId = placeIdByRoomKey.get(room.key)
    if (placeId !== undefined) idByName.set(room.name, placeId)
  }
  const resolved: Record<string, { activity: string; place_id: number }> = {}
  for (const [band, entry] of Object.entries(dailyLoop)) {
    const placeId = placeIdByRoomKey.get(entry.place) ?? idByName.get(entry.place) ?? homePlaceId
    resolved[band] = { activity: entry.activity, place_id: placeId }
  }
  return resolved
}

export async function seedBoundedWorld(
  { templateId, name, premise, playerName, roster }: SeedBoundedWorldInput,
  deps: SeedBoundedWorldDeps,
): Promise<SeedBoundedWorldResult> {
  const { decks, crew, worlds, places, placeConnections, characters, relationships } = deps

  const template = await decks.getTemplate(templateId)
  if (!template) throw new TemplateNotFoundError(templateId)

  const dressing: GeneratedEnsemble = roster
    ? dressingFromRoster(roster, template, name, premise)
    : await crew.generate({ template, premise, playerName })
  const dressingByRoomKey = new Map(dressing.roomDressing.map((d) => [d.key, d.description]))

  const { id: worldId } = await worlds.createBounded({
    name,
    premise,
    initialStateJson: JSON.stringify({ premise: dressing.premise, world_name: dressing.worldName }),
    templateId,
  })

  // Rooms → places (map room key → new place id).
  const placeIdByRoomKey = new Map<string, number>()
  for (const room of template.rooms) {
    const { id } = await places.add({
      world_id: worldId,
      name: room.name,
      description: dressingByRoomKey.get(room.key) ?? room.description,
      kind: 'room',
      deck: room.deck,
      layout_hint: room.layoutHint,
    })
    placeIdByRoomKey.set(room.key, id)
  }
  const placeIds = template.rooms.map((room) => placeIdByRoomKey.get(room.key) as number)

  // Edges → place_connections (map room keys → place ids).
  const edges: PlaceConnectionInput[] = template.edges.map((edge) => ({
    world_id: worldId,
    from_place_id: placeIdByRoomKey.get(edge.from) as number,
    to_place_id: placeIdByRoomKey.get(edge.to) as number,
    kind: edge.kind,
    bidirectional: edge.bidirectional ? 1 : 0,
  }))
  await placeConnections.add(edges)

  // Crew → characters (home room → current_place_id; resolved daily loop JSON).
  const characterIdByRole = new Map<string, number>()
  const characterIdByName = new Map<string, number>()
  if (roster) {
    await seedAuthoredHosts(roster, {
      worldId,
      template,
      placeIdByRoomKey,
      placeIds,
      characters,
      reveries: deps.reveries,
      characterIdByRole,
      characterIdByName,
    })
  } else {
    for (const member of dressing.crew) {
      const homePlaceId = placeIdByRoomKey.get(member.homeRoomKey) ?? null
      const dailyLoop = resolveDailyLoop(
        member.dailyLoop,
        template,
        placeIdByRoomKey,
        homePlaceId ?? placeIds[0],
      )
      const { id } = await characters.add({
        world_id: worldId,
        name: member.name,
        description: member.persona,
        is_player: 0,
        current_place_id: homePlaceId,
        role: member.role,
        active_goal: member.goal,
        daily_loop: JSON.stringify(dailyLoop),
      })
      const register = capSpeechRegister(member.speechRegister)
      if (register) await characters.setSpeechRegisterIfEmpty(id, register)
      characterIdByRole.set(member.role, id)
      characterIdByName.set(member.name.toLowerCase(), id)
    }
  }

  const relationshipEdges: RelationshipInput[] = roster
    ? relationshipsFromRoster(worldId, roster, characterIdByName)
    : relationshipsFromDressing(worldId, dressing, characterIdByRole)
  if (relationshipEdges.length > 0) await relationships.upsert(relationshipEdges)

  if (roster) {
    await seedAuthoredOpeningThreads(worldId, roster, deps.dossierWriter)
  } else {
    await seedOpeningPlots(worldId, {
      premise: dressing.premise || premise,
      worldName: dressing.worldName || name,
      crew: dressing.crew,
      relationships: dressing.relationships,
      seed: hashSeed(`${templateId}\0${premise}`),
      dossierWriter: deps.dossierWriter,
      openingPlotSeeder: deps.openingPlotSeeder,
    })
  }

  // Validate the seeded topology forms a single connected component.
  const connections: PlaceConnection[] = edges.map((edge, index) => ({
    id: index + 1,
    world_id: edge.world_id,
    from_place_id: edge.from_place_id,
    to_place_id: edge.to_place_id,
    kind: edge.kind,
    bidirectional: edge.bidirectional,
    created_at: null,
  }))
  const graph = buildDeckGraph(connections)
  if (!isConnected(graph, placeIds)) {
    throw new DisconnectedTopologyError(worldId, orphanRooms(graph, placeIds))
  }

  const characterIds = roster
    ? roster.hosts
        .map((host) => characterIdByName.get(host.name.toLowerCase()))
        .filter((id): id is number => id !== undefined)
    : dressing.crew.map((m) => characterIdByRole.get(m.role) as number)
  return { worldId, placeIds, characterIds }
}

async function seedOpeningPlots(
  worldId: number,
  args: {
    premise: string
    worldName: string
    crew: GeneratedEnsemble['crew']
    relationships: GeneratedEnsemble['relationships']
    seed: number
    dossierWriter?: DossierWriter
    openingPlotSeeder?: OpeningPlotSeeder
  },
): Promise<void> {
  if (!args.dossierWriter || !args.openingPlotSeeder) return
  try {
    const { threads } = await args.openingPlotSeeder.generate({
      premise: args.premise,
      worldName: args.worldName,
      crew: args.crew.map((c) => ({
        name: c.name,
        role: c.role,
        persona: c.persona,
        goal: c.goal,
      })),
      relationships: args.relationships,
      seed: args.seed,
    })
    for (const t of threads) {
      await args.dossierWriter.insertThread({
        world_id: worldId,
        title: t.title,
        kind: t.kind,
        status: 'active',
        summary: t.summary,
        stakes: t.stakes,
        rewards: null,
        consequences: null,
        hidden: null,
        relevance_tags_json: JSON.stringify(t.relevanceTags),
        source_turn_id: null,
      })
    }
  } catch (err) {
    console.error('[opening plots seed]', err)
  }
}

function dressingFromRoster(
  roster: HostRoster,
  template: WorldArchetype,
  name: string,
  premise: string,
): GeneratedEnsemble {
  return {
    worldName: name,
    premise,
    roomDressing: template.rooms.map((room) => ({
      key: room.key,
      description: room.description,
    })),
    crew: roster.hosts.map((host) => ({
      role: host.publicRole,
      name: host.name,
      persona: `${host.appearance} ${host.coreDrive}`,
      goal: host.coreDrive,
      homeRoomKey: host.homeRoomKey,
      dailyLoop: {
        morning: {
          activity: host.dailyLoop.morning.activity,
          place: host.dailyLoop.morning.place ?? host.homeRoomKey,
        },
        midday: {
          activity: host.dailyLoop.midday.activity,
          place: host.dailyLoop.midday.place ?? host.homeRoomKey,
        },
        evening: {
          activity: host.dailyLoop.evening.activity,
          place: host.dailyLoop.evening.place ?? host.homeRoomKey,
        },
        night: {
          activity: host.dailyLoop.night.activity,
          place: host.dailyLoop.night.place ?? host.homeRoomKey,
        },
      },
      speechRegister: host.speechRegister,
    })),
    relationships: roster.hosts.flatMap((host) =>
      host.web.map((edge) => ({
        fromRole: host.publicRole,
        toRole: edge.toName,
        kind: edge.kind,
        valence: edge.valence,
      })),
    ),
  }
}

async function seedAuthoredHosts(
  roster: HostRoster,
  args: {
    worldId: number
    template: WorldArchetype
    placeIdByRoomKey: Map<string, number>
    placeIds: number[]
    characters: CharacterRepository
    reveries?: ReverieRepository
    characterIdByRole: Map<string, number>
    characterIdByName: Map<string, number>
  },
): Promise<void> {
  for (const host of roster.hosts) {
    const offStage = host.kind === 'off-stage'
    const homePlaceId = offStage ? null : (args.placeIdByRoomKey.get(host.homeRoomKey) ?? null)
    const dailyLoop = resolveDailyLoop(
      host.dailyLoop,
      args.template,
      args.placeIdByRoomKey,
      homePlaceId ?? args.placeIds[0],
    )
    const { id } = await args.characters.add({
      world_id: args.worldId,
      name: host.name,
      description: `${host.appearance} ${host.coreDrive}`,
      is_player: 0,
      current_place_id: homePlaceId,
      role: host.publicRole,
      active_goal: null,
      daily_loop: JSON.stringify(dailyLoop),
      status: offStage ? 'inactive' : 'active',
      agency_level: offStage ? 'dormant' : host.kind === 'principal' ? 'local' : 'npc',
    })
    const register = capSpeechRegister(host.speechRegister)
    if (register) await args.characters.setSpeechRegisterIfEmpty(id, register)
    if (host.coreDrive.trim()) {
      await args.characters.setPersonalGoalsIfEmpty(id, host.coreDrive.trim())
    }
    if (host.refusals.length > 0) {
      await args.characters.setRefusalsIfEmpty(id, serializeRefusals(host.refusals))
    }
    if (host.publicRole === 'program lead') {
      await args.characters.setClearanceLevel(id, 'antagonist')
    }
    if (args.reveries && host.cornerstone.text.trim()) {
      await args.reveries.add(
        args.worldId,
        id,
        [
          {
            text: host.cornerstone.text,
            match_tags: host.cornerstone.matchTags,
            intensity: host.cornerstone.intensity ?? 0.8,
            is_cornerstone: 1,
          },
        ],
        null,
      )
    }
    args.characterIdByRole.set(host.publicRole, id)
    args.characterIdByName.set(host.name.toLowerCase(), id)
  }
}

function relationshipsFromRoster(
  worldId: number,
  roster: HostRoster,
  characterIdByName: Map<string, number>,
): RelationshipInput[] {
  const edges: RelationshipInput[] = []
  for (const host of roster.hosts) {
    const fromId = characterIdByName.get(host.name.toLowerCase())
    if (fromId === undefined) continue
    for (const edge of host.web) {
      const toId = characterIdByName.get(edge.toName.toLowerCase())
      if (toId === undefined) continue
      edges.push({
        world_id: worldId,
        from_character_id: fromId,
        to_character_id: toId,
        kind: edge.kind,
        valence: edge.valence,
        note: edge.note ?? null,
      })
    }
  }
  return edges
}

function relationshipsFromDressing(
  worldId: number,
  dressing: GeneratedEnsemble,
  characterIdByRole: Map<string, number>,
): RelationshipInput[] {
  const seededRelationships = ensureSeedTension(dressing.relationships)
  const relationshipEdges: RelationshipInput[] = []
  for (const rel of seededRelationships) {
    const fromId = characterIdByRole.get(rel.fromRole)
    const toId = characterIdByRole.get(rel.toRole)
    if (fromId === undefined || toId === undefined) continue
    relationshipEdges.push({
      world_id: worldId,
      from_character_id: fromId,
      to_character_id: toId,
      kind: rel.kind,
      valence: rel.valence,
      note: null,
    })
  }
  return relationshipEdges
}

async function seedAuthoredOpeningThreads(
  worldId: number,
  roster: HostRoster,
  dossierWriter?: DossierWriter,
): Promise<void> {
  if (!dossierWriter) return
  for (const t of roster.openingThreads) {
    await dossierWriter.insertThread({
      world_id: worldId,
      title: t.title,
      kind: t.kind,
      status: 'active',
      summary: t.summary,
      stakes: t.stakes,
      rewards: null,
      consequences: null,
      hidden: null,
      relevance_tags_json: JSON.stringify(t.relevanceTags),
      source_turn_id: null,
    })
  }
}

function hashSeed(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0
  }
  return h || 1
}

import type { PlaceConnection } from '@/domain/entities'
import type {
  CharacterRepository,
  Clock,
  WorldArchetypeProvider,
  WorldArchetype,
  PlaceConnectionInput,
  PlaceConnectionRepository,
  PlaceRepository,
  RelationshipInput,
  RelationshipRepository,
  WorldRepository,
} from '@/domain/ports'
import type {
  CompanionDailyLoopEntry,
  EnsembleGenerator,
  GeneratedEnsemble,
} from '@/domain/ports/ensemble-generator'
import { buildDeckGraph, isConnected, orphanRooms } from '@/domain/services/deck-graph'

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
}

// Resolve a crew member's daily-loop place reference (a template room key OR its
// display name, per the EnsembleGenerator contract) to a seeded place id. Anything
// that fails to resolve falls back to the crew member's home room so the loop
// always points at a real room rather than free text (the seed-time invariant).
function resolveDailyLoop(
  dailyLoop: Record<string, CompanionDailyLoopEntry>,
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
  { templateId, name, premise, playerName }: SeedBoundedWorldInput,
  deps: SeedBoundedWorldDeps,
): Promise<SeedBoundedWorldResult> {
  const { decks, crew, worlds, places, placeConnections, characters, relationships } = deps

  const template = await decks.getTemplate(templateId)
  if (!template) throw new TemplateNotFoundError(templateId)

  const dressing: GeneratedEnsemble = await crew.generate({ template, premise, playerName })
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
    characterIdByRole.set(member.role, id)
  }

  // Relationships → character_relationships (role → character id). Edges whose
  // endpoints didn't resolve to generated crew are dropped (the adapter already
  // enforced the role-reference invariant; this is belt-and-suspenders).
  const relationshipEdges: RelationshipInput[] = []
  for (const rel of dressing.relationships) {
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
  if (relationshipEdges.length > 0) await relationships.upsert(relationshipEdges)

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

  return { worldId, placeIds, characterIds: dressing.crew.map((m) => characterIdByRole.get(m.role) as number) }
}

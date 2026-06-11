import type { CharacterRelationship } from '@/domain/entities'
import type {
  CharacterRepository,
  Clock,
  DramaParticipant,
  DramaPort,
  PlaceConnectionRepository,
  PlaceRepository,
  RelationshipRepository,
  TimelineWriter,
  WorldRepository,
} from '@/domain/ports'
import { shouldEmitBeat } from '@/domain/services/beat-gating'
import type { CharacterPosition } from '@/domain/services/colocation'
import { coLocatedGroups } from '@/domain/services/colocation'
import { buildDeckGraph, neighbors } from '@/domain/services/deck-graph'
import { nextPlaceId, type ResolvedDailyLoop } from '@/domain/services/npc-movement'
import {
  applyDrift,
  coLocationOutcome,
  driftFromOutcome,
} from '@/domain/services/relationship-drift'
import { tickToBand, tickToWorldTime } from '@/domain/services/sim-clock'
import type { WorldTimeBand } from '@/domain/services/world-clock'

// SimulateWorldForward (starship P2 + P3) — the player-less forward sim. Pure
// orchestration: it loads NPCs, the topology graph and the relationship graph
// through injected ports, then runs N ticks of pure movement + co-location +
// drift entirely in memory. Persists final positions, relationship valence deltas
// and the advanced world clock ONCE at the end. P3 adds the one LLM seam: when a
// co-located group has enough tension/bond and the cooldown has elapsed, it spends
// ONE structured drama beat (DramaPort) that is appended to the timeline as a
// provenance='sim' event and supersedes that group's deterministic drift for the
// tick. No SQL, no SDK, no framework — every store seam is a port. Parsing the
// untrusted daily_loop JSON to a ResolvedDailyLoop happens here at the application
// edge, then is trusted inward.

export type SimulateWorldForwardInput = {
  worldId: number
  ticks: number
  cooldownTicks?: number
  tensionThreshold?: number
}

const DEFAULT_COOLDOWN_TICKS = 3
const DEFAULT_TENSION_THRESHOLD = 0.3
// How many of the most recent ship-wide beats to hand the generator as memory, so
// it advances the situation instead of regenerating the same conflict.
const RECENT_BEATS_WINDOW = 5
// Importance of a sim-generated beat on the timeline — a small, modest value so
// player-turn events still outrank ambient pre-sim drama.
const BEAT_IMPORTANCE = 2

export type SimulateWorldForwardResult = {
  ticks: number
  beats: number
  finalPositions: Array<{ characterId: number; placeId: number | null }>
  drifted: Array<{ relationshipId: number; from: number; to: number; valence: number }>
}

export type SimulateWorldForwardDeps = {
  characters: CharacterRepository
  placeConnections: PlaceConnectionRepository
  relationships: RelationshipRepository
  worlds: WorldRepository
  places: PlaceRepository
  drama: DramaPort
  timeline: TimelineWriter
  clock: Clock
}

// Parse the characters.daily_loop JSON text (Record<band,{activity,place_id}>, the
// shape SeedBoundedWorld writes) into a ResolvedDailyLoop (band → place_id). Any
// null/missing/malformed loop projects to an empty loop, so the NPC simply stays
// put — untrusted persisted text never throws the sim.
function parseDailyLoop(dailyLoopJson: string | null): ResolvedDailyLoop {
  if (!dailyLoopJson) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(dailyLoopJson)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object') return {}
  const resolved: ResolvedDailyLoop = {}
  for (const band of BANDS) {
    const entry = (parsed as Record<string, unknown>)[band]
    if (entry === null || typeof entry !== 'object') continue
    const placeId = (entry as Record<string, unknown>).place_id
    if (typeof placeId === 'number') resolved[band] = placeId
  }
  return resolved
}

const BANDS: readonly WorldTimeBand[] = ['morning', 'midday', 'evening', 'night']

export async function simulateWorldForward(
  { worldId, ticks, cooldownTicks, tensionThreshold }: SimulateWorldForwardInput,
  deps: SimulateWorldForwardDeps,
): Promise<SimulateWorldForwardResult> {
  const { characters, drama, placeConnections, places, relationships, timeline, worlds } = deps
  const beatCooldown = cooldownTicks ?? DEFAULT_COOLDOWN_TICKS
  const beatThreshold = tensionThreshold ?? DEFAULT_TENSION_THRESHOLD

  // Room manifest → place_id → name (for beat input + readable timeline events).
  const placeRows = await places.forWorld(worldId)
  const placeNameById = new Map<number, string>(placeRows.map((p) => [p.id, p.name]))

  // NPCs only (drop the player). Each carries its starting room + parsed loop, plus
  // the enrichment a drama beat reasons over: name, role (P1 stored it in
  // `current_focus`) and goal (`active_goal`).
  const roster = await characters.forWorld(worldId)
  const npcs = roster
    .filter((c) => c.is_player === 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      role: c.current_focus,
      goal: c.active_goal,
      dailyLoop: parseDailyLoop(c.daily_loop),
    }))
  const npcById = new Map(npcs.map((npc) => [npc.id, npc]))

  // Topology graph → a neighbours function for the movement service.
  const connections = await placeConnections.forWorld(worldId)
  const graph = buildDeckGraph(connections)
  const neighborsOf = (placeId: number): number[] => neighbors(graph, placeId)

  // Relationship graph as a mutable working copy keyed by id; remember each
  // original valence so we persist a delta only for edges that actually drifted.
  const relationshipRows = await relationships.forWorld(worldId)
  const working = new Map<number, CharacterRelationship>(
    relationshipRows.map((rel) => [rel.id, { ...rel }]),
  )
  const originalValence = new Map<number, number>(
    relationshipRows.map((rel) => [rel.id, rel.valence]),
  )

  // In-memory positions seeded from current_place_id.
  const positions = new Map<number, number | null>(
    roster.filter((c) => c.is_player === 0).map((c) => [c.id, c.current_place_id]),
  )

  // Beat cooldown is per-room: each place remembers the tick of its last beat.
  const lastBeatTickByPlace = new Map<number, number>()
  // Beat memory is ship-wide: a rolling list of prior beats as 'title: summary',
  // most-recent-last, so the generator advances rather than repeats (the repeated
  // conflict in the live smoke spanned different rooms, so memory must be global).
  const recentBeats: string[] = []
  let beats = 0

  for (let tick = 0; tick < ticks; tick += 1) {
    const band = tickToBand(tick)
    for (const npc of npcs) {
      positions.set(
        npc.id,
        nextPlaceId({
          dailyLoop: npc.dailyLoop,
          band,
          currentPlaceId: positions.get(npc.id) ?? null,
          neighborsOf,
        }),
      )
    }

    const snapshot: CharacterPosition[] = npcs.map((npc) => ({
      characterId: npc.id,
      placeId: positions.get(npc.id) ?? null,
    }))
    const groups = coLocatedGroups(snapshot)

    for (const group of groups) {
      const placeId = group.placeId
      const members = new Set(group.characterIds)
      // Working edges fully contained in this room this tick.
      const groupRelIds = [...working.keys()].filter((id) => {
        const rel = working.get(id)!
        return members.has(rel.from_character_id) && members.has(rel.to_character_id)
      })
      const relationshipsInGroup = groupRelIds.map((id) => working.get(id)!)

      const emit = shouldEmitBeat({
        characterIds: group.characterIds,
        relationships: relationshipsInGroup,
        currentTick: tick,
        lastBeatTick: lastBeatTickByPlace.get(placeId) ?? null,
        cooldownTicks: beatCooldown,
        tensionThreshold: beatThreshold,
      })

      if (emit) {
        // A beat SUPERSEDES this group's deterministic drift for the tick.
        const participants: DramaParticipant[] = group.characterIds
          .map((id) => npcById.get(id))
          .filter((npc): npc is NonNullable<typeof npc> => npc !== undefined)
          .map((npc) => ({
            character_id: npc.id,
            name: npc.name,
            role: npc.role,
            goal: npc.goal,
          }))

        const beat = await drama.generateBeat({
          world_id: worldId,
          sim_tick: tick,
          world_time: tickToWorldTime(tick),
          place_id: placeId,
          place_name: placeNameById.get(placeId) ?? '',
          participants,
          relationships: relationshipsInGroup,
          threads: [],
          recentBeats: recentBeats.slice(-RECENT_BEATS_WINDOW),
        })

        recentBeats.push(`${beat.title}: ${beat.summary}`)

        await timeline.append({
          world_id: worldId,
          turn_id: null,
          thread_id: null,
          world_time: tickToWorldTime(tick),
          title: beat.title,
          summary: beat.summary,
          importance: BEAT_IMPORTANCE,
          sim_tick: tick,
          provenance: 'sim',
        })

        // Apply each proposed valence delta to its matching working edge; deltas
        // with no co-located edge in this group are ignored.
        for (const vd of beat.valenceDeltas) {
          const matchId = groupRelIds.find((id) => {
            const rel = working.get(id)!
            return (
              rel.from_character_id === vd.from_character_id &&
              rel.to_character_id === vd.to_character_id
            )
          })
          if (matchId !== undefined) {
            working.set(matchId, applyDrift(working.get(matchId)!, vd.delta))
          }
        }

        lastBeatTickByPlace.set(placeId, tick)
        beats += 1
      } else {
        // No beat: P2 deterministic co-location drift for this group's edges.
        for (const id of groupRelIds) {
          const rel = working.get(id)!
          working.set(id, applyDrift(rel, driftFromOutcome(coLocationOutcome(rel.valence))))
        }
      }
    }
  }

  // Persist once (compact): final rooms, relationship deltas, advanced clock.
  for (const npc of npcs) {
    await characters.setPlace(npc.id, positions.get(npc.id) ?? null)
  }

  const drifted: SimulateWorldForwardResult['drifted'] = []
  for (const [id, rel] of working) {
    const original = originalValence.get(id) ?? 0
    if (rel.valence !== original) {
      await relationships.adjustValence(id, rel.valence - original)
      drifted.push({
        relationshipId: id,
        from: rel.from_character_id,
        to: rel.to_character_id,
        valence: rel.valence,
      })
    }
  }

  // Clock follows positions: persist the band of the LAST LIVED tick (ticks-1),
  // not the arrival band (ticks), so a joining player reads the same moment the
  // NPCs are actually positioned for (e.g. crew in their night spots ⇒ clock says
  // night, not the next morning). No ticks ⇒ nothing simulated, leave the clock.
  if (ticks > 0) {
    await worlds.setWorldTime(worldId, tickToWorldTime(ticks - 1))
  }

  return {
    ticks,
    beats,
    finalPositions: npcs.map((npc) => ({
      characterId: npc.id,
      placeId: positions.get(npc.id) ?? null,
    })),
    drifted,
  }
}

import type { CharacterRelationship } from '@/domain/entities'
import type {
  CharacterRepository,
  Clock,
  PlaceConnectionRepository,
  RelationshipRepository,
  WorldRepository,
} from '@/domain/ports'
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

// SimulateWorldForward (starship P2) — the player-less, deterministic forward sim.
// Pure orchestration: it loads NPCs, the topology graph and the relationship graph
// through injected ports, then runs N ticks of pure movement + co-location + drift
// entirely in memory and persists ONCE at the end (final positions, relationship
// valence deltas, advanced world clock). No SQL, no SDK, no framework — every store
// seam is a port. No LLM (drama beats are P3); the only deciding logic it runs in
// process is the pure domain services. Parsing the untrusted daily_loop JSON to a
// ResolvedDailyLoop happens here at the application edge, then is trusted inward.

export type SimulateWorldForwardInput = {
  worldId: number
  ticks: number
}

export type SimulateWorldForwardResult = {
  ticks: number
  finalPositions: Array<{ characterId: number; placeId: number | null }>
  drifted: Array<{ relationshipId: number; from: number; to: number; valence: number }>
}

export type SimulateWorldForwardDeps = {
  characters: CharacterRepository
  placeConnections: PlaceConnectionRepository
  relationships: RelationshipRepository
  worlds: WorldRepository
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
  { worldId, ticks }: SimulateWorldForwardInput,
  deps: SimulateWorldForwardDeps,
): Promise<SimulateWorldForwardResult> {
  const { characters, placeConnections, relationships, worlds } = deps

  // NPCs only (drop the player). Each carries its starting room + parsed loop.
  const roster = await characters.forWorld(worldId)
  const npcs = roster
    .filter((c) => c.is_player === 0)
    .map((c) => ({
      id: c.id,
      dailyLoop: parseDailyLoop(c.daily_loop),
    }))

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
    const together = new Set<number>()
    for (const group of groups) {
      for (const id of group.characterIds) together.add(id)
    }

    for (const [id, rel] of working) {
      if (together.has(rel.from_character_id) && together.has(rel.to_character_id)) {
        // Both endpoints share a room this tick. Confirm it is the SAME room.
        if (positions.get(rel.from_character_id) === positions.get(rel.to_character_id)) {
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

  await worlds.setWorldTime(worldId, tickToWorldTime(ticks))

  return {
    ticks,
    finalPositions: npcs.map((npc) => ({
      characterId: npc.id,
      placeId: positions.get(npc.id) ?? null,
    })),
    drifted,
  }
}

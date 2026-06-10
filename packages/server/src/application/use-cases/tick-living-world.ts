import type { CharacterRelationship } from '@/domain/entities'
import type {
  CharacterRepository,
  Clock,
  DramaParticipant,
  DramaPort,
  PlaceConnectionRepository,
  PlaceRepository,
  RelationshipRepository,
  TimelineReader,
  TimelineWriter,
  WorldRepository,
} from '@/domain/ports'
import { isHighStakesBeat, shouldEmitBeat } from '@/domain/services/beat-gating'
import type { CharacterPosition } from '@/domain/services/colocation'
import { coLocatedGroups } from '@/domain/services/colocation'
import { buildDeckGraph, neighbors } from '@/domain/services/deck-graph'
import { nextPlaceId, type ResolvedDailyLoop } from '@/domain/services/npc-movement'
import {
  applyDrift,
  coLocationOutcome,
  driftFromOutcome,
} from '@/domain/services/relationship-drift'
import type { WorldTimeBand } from '@/domain/services/world-clock'
import { worldTimeBand } from '@/domain/services/world-clock'

// TickLivingWorld (starship P5) — the DURING-PLAY "living tick". The pre-play
// forward sim freezes once the player boards: the turn pipeline skips off-scene
// looped NPCs (an open-world cost optimisation). On a sealed bounded ship that is
// wrong — ALL crew should stay active every turn. This use case runs exactly ONE
// tick of the same pure machinery the pre-play sim uses, but: (a) the band comes
// off the LIVE world clock, not a sim clock; (b) only OFF-SCENE crew move (anyone
// in the player's room is the narrator/archivist's job — no double-move); and (c)
// the sim_tick continues past the pre-play sim's last tick. A gated co-located
// group spends ONE drama beat (appended as a provenance='sim' timeline event) and
// drifts its relationships; otherwise the group takes the deterministic co-location
// drift. Pure orchestration — every store/LLM seam is an injected port.

export type TickLivingWorldInput = {
  worldId: number
  playerPlaceId: number | null
  // A MONOTONIC per-turn counter (the player turn id). It anchors the tick number
  // + the beat cooldown. It must NOT be derived from the last written sim_tick:
  // doing so deadlocks the cooldown (with a prior beat at tick 11, maxSimTick+1
  // pins it at 12 forever, so 12-11 never clears a cooldown of 2 and no beat ever
  // fires). A turn id advances every turn, so the cooldown elapses as play continues.
  currentTick: number
  cooldownTicks?: number
  tensionThreshold?: number
}

const DEFAULT_COOLDOWN_TICKS = 2
const DEFAULT_TENSION_THRESHOLD = 0.25
// Valence magnitude at which a group is treated as "high-stakes" (A8). Above
// this threshold the living tick drops the per-group beat cooldown to 0 so an
// LLM beat fires immediately, pushing off-scene NPCs into proactive action
// rather than waiting out a normal inter-beat pause.
const HIGH_STAKES_TENSION_THRESHOLD = 0.7
// How many of the most recent ship-wide beats to hand the generator as memory so
// it advances the situation instead of regenerating the same conflict.
const RECENT_BEATS_WINDOW = 5
// Importance of a sim-generated beat on the timeline — small + modest so
// player-turn events still outrank ambient drama.
const BEAT_IMPORTANCE = 2

export type TickLivingWorldResult = {
  movedCount: number
  beatsWritten: number
  finalPositions: Array<{ characterId: number; placeId: number | null }>
}

export type TickLivingWorldDeps = {
  characters: CharacterRepository
  placeConnections: PlaceConnectionRepository
  relationships: RelationshipRepository
  worlds: WorldRepository
  places: PlaceRepository
  drama: DramaPort
  timeline: TimelineWriter
  timelineReader: TimelineReader
  clock: Clock
}

const BANDS: readonly WorldTimeBand[] = ['morning', 'midday', 'evening', 'night']

// Parse the characters.daily_loop JSON text (Record<band,{activity,place_id}>) into
// a ResolvedDailyLoop (band → place_id). Any null/missing/malformed loop projects
// to an empty loop, so the NPC simply stays put — untrusted persisted text never
// throws the tick.
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

export async function tickLivingWorld(
  { worldId, playerPlaceId, currentTick, cooldownTicks, tensionThreshold }: TickLivingWorldInput,
  deps: TickLivingWorldDeps,
): Promise<TickLivingWorldResult> {
  const {
    characters,
    drama,
    placeConnections,
    places,
    relationships,
    timeline,
    timelineReader,
    worlds,
  } = deps
  const beatCooldown = cooldownTicks ?? DEFAULT_COOLDOWN_TICKS
  const beatThreshold = tensionThreshold ?? DEFAULT_TENSION_THRESHOLD

  // The band comes off the LIVE world clock — the world cursor's world_time, which
  // the pre-play sim and every player turn keep current — not a separate sim clock.
  // The during-play tick is anchored to the moment the player is actually living.
  const cursor = await worlds.cursor(worldId)
  const worldTime = cursor.world_time
  const band = worldTimeBand(worldTime)

  // Room manifest → place_id → name (for beat input + readable timeline events).
  const placeRows = await places.forWorld(worldId)
  const placeNameById = new Map<number, string>(placeRows.map((p) => [p.id, p.name]))

  // NPCs only (drop the player). Each carries its starting room + parsed loop, plus
  // the enrichment a drama beat reasons over: name, role (current_focus) and goal.
  const roster = await characters.forWorld(worldId)
  const npcs = roster
    .filter((c) => c.is_player === 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      role: c.current_focus,
      goal: c.active_goal,
      dailyLoop: parseDailyLoop(c.daily_loop),
      startPlaceId: c.current_place_id,
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

  // OFF-SCENE crew only: anyone NOT in the player's room. Crew present with the
  // player are the narrator/archivist's job — never double-moved here.
  const offScene = npcs.filter((npc) => npc.startPlaceId !== playerPlaceId)

  // In-memory positions seeded from each off-scene NPC's current room. ONE tick:
  // move each toward its band target (no skip — all off-scene crew move).
  const positions = new Map<number, number | null>()
  let movedCount = 0
  for (const npc of offScene) {
    const next = nextPlaceId({
      dailyLoop: npc.dailyLoop,
      band,
      currentPlaceId: npc.startPlaceId,
      neighborsOf,
    })
    positions.set(npc.id, next)
    if (next !== npc.startPlaceId) {
      await characters.setPlace(npc.id, next)
      movedCount += 1
    }
  }

  // Beat memory + cooldown seeded from prior sim history. The timeline carries no
  // place_id, so the per-room cooldown floor is the most recent ship-wide sim beat
  // tick (recentSimEvents is newest-first; the first element is the latest beat).
  const priorBeats = await timelineReader.recentSimEvents(worldId, RECENT_BEATS_WINDOW)
  const lastSimBeatTick = priorBeats[0]?.sim_tick ?? null
  const lastBeatTickByPlace = new Map<number, number>()
  // recentBeats as 'title: summary', most-recent-last (priorBeats is newest-first,
  // so reverse to match the generator's expected ordering).
  const recentBeats: string[] = [...priorBeats]
    .reverse()
    .map((e) => `${e.title}: ${e.summary}`)
  let beatsWritten = 0

  const snapshot: CharacterPosition[] = offScene.map((npc) => ({
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

    // A8 (proactive NPCs): when a group's peak tension is high-stakes, drop the
    // per-group cooldown to 0 so the beat fires immediately, even if the normal
    // inter-beat pause hasn't elapsed. This pushes off-scene NPCs into action
    // (via the beat pathway) during hot situations rather than standing idle.
    const highStakes = isHighStakesBeat({
      characterIds: group.characterIds,
      relationships: relationshipsInGroup,
      highStakesThreshold: HIGH_STAKES_TENSION_THRESHOLD,
    })
    const effectiveCooldown = highStakes ? 0 : beatCooldown

    const emit = shouldEmitBeat({
      characterIds: group.characterIds,
      relationships: relationshipsInGroup,
      currentTick: currentTick,
      lastBeatTick: lastBeatTickByPlace.get(placeId) ?? lastSimBeatTick,
      cooldownTicks: effectiveCooldown,
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
        sim_tick: currentTick,
        world_time: worldTime,
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
        world_time: worldTime,
        title: beat.title,
        summary: beat.summary,
        importance: BEAT_IMPORTANCE,
        sim_tick: currentTick,
        provenance: 'sim',
      })

      // Apply each proposed valence delta to its matching working edge; deltas with
      // no co-located edge in this group are ignored.
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

      lastBeatTickByPlace.set(placeId, currentTick)
      beatsWritten += 1
    } else {
      // No beat: deterministic co-location drift for this group's edges.
      for (const id of groupRelIds) {
        const rel = working.get(id)!
        working.set(id, applyDrift(rel, driftFromOutcome(coLocationOutcome(rel.valence))))
      }
    }
  }

  // Persist relationship deltas only for edges that actually drifted.
  for (const [id, rel] of working) {
    const original = originalValence.get(id) ?? 0
    if (rel.valence !== original) {
      await relationships.adjustValence(id, rel.valence - original)
    }
  }

  return {
    movedCount,
    beatsWritten,
    finalPositions: offScene.map((npc) => ({
      characterId: npc.id,
      placeId: positions.get(npc.id) ?? null,
    })),
  }
}

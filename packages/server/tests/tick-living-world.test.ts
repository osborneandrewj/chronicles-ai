import { describe, expect, it } from 'vitest'

import { tickLivingWorld } from '@/application/use-cases/tick-living-world'
import type { TickLivingWorldDeps } from '@/application/use-cases/tick-living-world'
import type {
  Character,
  CharacterRelationship,
  Place,
  PlaceConnection,
  TimelineEvent,
} from '@/domain/entities'
import type {
  CharacterRepository,
  Clock,
  DramaBeat,
  DramaBeatInput,
  DramaPort,
  PlaceConnectionRepository,
  PlaceRepository,
  RelationshipRepository,
  TimelineEventInput,
  TimelineReader,
  TimelineWriter,
  WorldRepository,
} from '@/domain/ports'

// Unit test for TickLivingWorld (starship P5). Pure orchestration exercised with
// in-memory fake ports that record their calls — no DB, no LLM. A 3-room line graph
// (bridge A ── mess B ── quarters C). The player stands in room A; two off-scene
// NPCs (the cook + the medic) have loops that put them in room B at the live band;
// a third NPC stands WITH the player in room A. Asserts: the two off-scene crew move
// to B (setPlace), the present-with-player crew is NOT moved, an off-scene NPC already
// at its band target stays put, and — with a tension edge + the cooldown satisfied —
// a beat fires and a provenance='sim' timeline event is appended.

const WORLD_ID = 42

// Place ids for the line graph.
const ROOM_A = 200 // Bridge — the player's room.
const ROOM_B = 201 // Mess — the off-scene crew's band target.
const ROOM_C = 202 // Quarters.

const COOK_ID = 1 // off-scene, due in B this band — moves C→B.
const MEDIC_ID = 2 // off-scene, due in B this band — moves C→B (co-locates the cook).
const STEWARD_ID = 3 // present WITH the player in room A — must NOT be moved.
const SETTLED_ID = 4 // off-scene, already in its band target B — stays put.
const PLAYER_ID = 5

// Live band is 'midday' (set via the cursor world_time). Each off-scene NPC's loop
// names B for midday so they converge there; the steward shares the player's room.
const MIDDAY_B_LOOP = {
  morning: { activity: 'rest', place_id: ROOM_C },
  midday: { activity: 'work', place_id: ROOM_B },
  evening: { activity: 'rest', place_id: ROOM_C },
  night: { activity: 'sleep', place_id: ROOM_C },
}

function character(overrides: Partial<Character>): Character {
  return {
    id: 0,
    world_id: WORLD_ID,
    name: 'crew',
    description: null,
    is_player: 0,
    current_place_id: null,
    memorable_facts: null,
    status: 'active',
    active_goal: null,
    current_attitude: null,
    observations: null,
    agency_level: 'npc',
    personal_goals: null,
    current_focus: null,
    recent_activity: null,
    private_beliefs: null,
    reveries: null,
    relationship_to_player: null,
    long_term_agenda: null,
    tool_access: null,
    appearance_count: 0,
    last_seen_turn_id: null,
    last_agent_tick_turn_id: null,
    player_notes: null,
    in_transit_to_place_id: null,
    arrival_world_time: null,
    last_known_situation: null,
    aliases: null,
    daily_loop: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function relationship(overrides: Partial<CharacterRelationship>): CharacterRelationship {
  return {
    id: 0,
    world_id: WORLD_ID,
    from_character_id: 0,
    to_character_id: 0,
    kind: null,
    valence: 0,
    note: null,
    updated_at: null,
    ...overrides,
  }
}

function place(overrides: Partial<Place>): Place {
  return {
    id: 0,
    world_id: WORLD_ID,
    name: 'room',
    description: null,
    kind: null,
    deck: null,
    layout_hint: null,
    player_notes: null,
    osm_display_name: null,
    osm_street: null,
    osm_neighborhood: null,
    osm_lat: null,
    osm_lng: null,
    geo_status: 'unresolved',
    geo_resolved_at: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const ROOMS: Place[] = [
  place({ id: ROOM_A, name: 'Bridge' }),
  place({ id: ROOM_B, name: 'Mess' }),
  place({ id: ROOM_C, name: 'Quarters' }),
]

type Fakes = {
  deps: TickLivingWorldDeps
  setPlaceCalls: Array<{ characterId: number; placeId: number | null }>
  adjustCalls: Array<{ relationshipId: number; delta: number }>
  beatCalls: DramaBeatInput[]
  appendCalls: TimelineEventInput[]
}

// A canned beat: nudges the (COOK, MEDIC) edge by +0.5 so a beat is clearly
// distinguishable from the ±0.1 deterministic co-location step.
function cannedBeat(input: DramaBeatInput): DramaBeat {
  return {
    title: `Beat in ${input.place_name}`,
    summary: 'A canned drama beat for the test.',
    participant_ids: input.participants.map((p) => p.character_id),
    valenceDeltas: [{ from_character_id: COOK_ID, to_character_id: MEDIC_ID, delta: 0.5 }],
  }
}

function buildFakes(
  roster: Character[],
  rels: CharacterRelationship[],
  priorSimEvents: TimelineEvent[] = [],
): Fakes {
  const setPlaceCalls: Fakes['setPlaceCalls'] = []
  const adjustCalls: Fakes['adjustCalls'] = []
  const beatCalls: DramaBeatInput[] = []
  const appendCalls: TimelineEventInput[] = []

  // A line graph: A ── B ── C (two bidirectional corridors).
  const connections: PlaceConnection[] = [
    {
      id: 1,
      world_id: WORLD_ID,
      from_place_id: ROOM_A,
      to_place_id: ROOM_B,
      kind: 'corridor',
      bidirectional: 1,
      created_at: null,
    },
    {
      id: 2,
      world_id: WORLD_ID,
      from_place_id: ROOM_B,
      to_place_id: ROOM_C,
      kind: 'corridor',
      bidirectional: 1,
      created_at: null,
    },
  ]

  const characters: CharacterRepository = {
    forWorld: async () => roster,
    inPlace: async () => [],
    add: async () => ({ id: 0 }),
    setPlace: async (characterId, placeId) => {
      setPlaceCalls.push({ characterId, placeId })
    },
    findByExactLowerName: async () => null,
    insert: async () => ({ id: 0 }),
    update: async () => {},
    setActiveGoal: async () => {},
    setCurrentAttitude: async () => {},
    setObservations: async () => {},
    merge: async () => {},
    delete: async () => {},
    setAliases: async () => {},
    rename: async () => {},
    setPlayersPlace: async () => {},
    appendPlayerNotes: async () => {},
    recordAppearancesAndAutoPromote: async () => ({
      promoted: [],
      counted: 0,
      tiers: { local: [], nearby: [], distant: [], dormant: [], demoted: [] },
    }),
    agentNpcsForTick: async () => [],
    setLastAgentTick: async () => {},
    findAgentNpcByName: async () => null,
    applyAgentNpcFields: async () => {},
    setDailyLoopIfEmpty: async () => {},
  }
  const placeConnections: PlaceConnectionRepository = {
    forWorld: async () => connections,
    add: async () => {},
  }
  const relationships: RelationshipRepository = {
    forWorld: async () => rels,
    upsert: async () => {},
    adjustValence: async (relationshipId, delta) => {
      adjustCalls.push({ relationshipId, delta })
    },
  }
  const worlds = {
    getWorld: async () => ({ id: WORLD_ID, world_time: 'Day 1 — midday' }),
    cursor: async () => ({ world_time: 'Day 1 — midday', current_scene_id: null }),
  } as unknown as WorldRepository
  const places: PlaceRepository = {
    forWorld: async () => ROOMS,
    byId: async (id) => ROOMS.find((p) => p.id === id) ?? null,
    add: async () => ({ id: 0 }),
    currentPlaceForWorld: async () => null,
    nameById: async (id) => ROOMS.find((p) => p.id === id)?.name ?? null,
    insert: async () => ({ id: 0 }),
    update: async () => {},
    merge: async () => {},
    moveCharactersToPlace: async () => {},
    moveScenesToPlace: async () => {},
    delete: async () => {},
    appendPlayerNotes: async () => {},
    setGeoResolution: async () => {},
  }
  const drama: DramaPort = {
    generateBeat: async (input) => {
      beatCalls.push(input)
      return cannedBeat(input)
    },
  }
  const timeline: TimelineWriter = {
    append: async (event) => {
      appendCalls.push(event)
    },
  }
  const timelineReader: TimelineReader = {
    recentSimEvents: async () => priorSimEvents,
    maxSimTick: async () =>
      priorSimEvents.length > 0
        ? Math.max(...priorSimEvents.map((e) => e.sim_tick ?? 0))
        : null,
  }
  const clock: Clock = { now: () => new Date(0), today: () => '1970-01-01' }

  return {
    deps: {
      characters,
      placeConnections,
      relationships,
      worlds,
      places,
      drama,
      timeline,
      timelineReader,
      clock,
    },
    setPlaceCalls,
    adjustCalls,
    beatCalls,
    appendCalls,
  }
}

describe('tickLivingWorld', () => {
  const roster: Character[] = [
    character({
      id: COOK_ID,
      current_place_id: ROOM_C, // off-scene: moves C→B (B is adjacent to C).
      daily_loop: JSON.stringify(MIDDAY_B_LOOP),
      current_focus: 'cook',
      active_goal: 'feed a restless crew',
    }),
    character({
      id: MEDIC_ID,
      current_place_id: ROOM_C, // off-scene: moves C→B.
      daily_loop: JSON.stringify(MIDDAY_B_LOOP),
      current_focus: 'medic',
      active_goal: 'press the captain for rest rotations',
    }),
    character({
      id: STEWARD_ID,
      current_place_id: ROOM_A, // present WITH the player — left to the narrator.
      daily_loop: JSON.stringify(MIDDAY_B_LOOP),
    }),
    character({
      id: SETTLED_ID,
      current_place_id: ROOM_B, // already at its band target — stays put.
      daily_loop: JSON.stringify(MIDDAY_B_LOOP),
    }),
    character({ id: PLAYER_ID, is_player: 1, current_place_id: ROOM_A }),
  ]
  // Cook + medic are rivals — |valence| above the default 0.25 threshold.
  const rivalRels: CharacterRelationship[] = [
    relationship({
      id: 10,
      from_character_id: COOK_ID,
      to_character_id: MEDIC_ID,
      kind: 'rival',
      valence: -0.5,
    }),
  ]

  it('moves off-scene crew to their band target and persists via setPlace', async () => {
    const fakes = buildFakes(roster, rivalRels)
    const result = await tickLivingWorld(
      { worldId: WORLD_ID, playerPlaceId: ROOM_A, currentTick: 0 },
      fakes.deps,
    )

    // Cook (C→B) and medic (C→B) moved; movedCount counts only actual moves.
    expect(result.movedCount).toBe(2)
    const setById = new Map(fakes.setPlaceCalls.map((c) => [c.characterId, c.placeId]))
    expect(setById.get(COOK_ID)).toBe(ROOM_B)
    expect(setById.get(MEDIC_ID)).toBe(ROOM_B)

    // Final positions report the cook + medic in B.
    const posById = new Map(result.finalPositions.map((p) => [p.characterId, p.placeId]))
    expect(posById.get(COOK_ID)).toBe(ROOM_B)
    expect(posById.get(MEDIC_ID)).toBe(ROOM_B)
  })

  it('does not move the NPC present in the player room or the player', async () => {
    const fakes = buildFakes(roster, rivalRels)
    const result = await tickLivingWorld(
      { worldId: WORLD_ID, playerPlaceId: ROOM_A, currentTick: 0 },
      fakes.deps,
    )

    // The steward stands in the player's room (A): excluded from the off-scene set
    // entirely — never moved, never in finalPositions.
    expect(fakes.setPlaceCalls.some((c) => c.characterId === STEWARD_ID)).toBe(false)
    expect(result.finalPositions.some((p) => p.characterId === STEWARD_ID)).toBe(false)
    // The player is never simulated.
    expect(fakes.setPlaceCalls.some((c) => c.characterId === PLAYER_ID)).toBe(false)
    expect(result.finalPositions.some((p) => p.characterId === PLAYER_ID)).toBe(false)
  })

  it('keeps an off-scene NPC already at its band target put (no setPlace)', async () => {
    const fakes = buildFakes(roster, rivalRels)
    const result = await tickLivingWorld(
      { worldId: WORLD_ID, playerPlaceId: ROOM_A, currentTick: 0 },
      fakes.deps,
    )

    // The settled NPC is already in B at midday — no move, no setPlace call, but it
    // is still an off-scene NPC reported at B.
    expect(fakes.setPlaceCalls.some((c) => c.characterId === SETTLED_ID)).toBe(false)
    const posById = new Map(result.finalPositions.map((p) => [p.characterId, p.placeId]))
    expect(posById.get(SETTLED_ID)).toBe(ROOM_B)
  })

  it('fires a gated beat and appends a provenance=sim timeline event', async () => {
    const fakes = buildFakes(roster, rivalRels)
    const result = await tickLivingWorld(
      { worldId: WORLD_ID, playerPlaceId: ROOM_A, currentTick: 0 },
      fakes.deps,
    )

    // Cook + medic co-locate in B with rival tension and no prior beat → one beat.
    expect(result.beatsWritten).toBe(1)
    expect(fakes.beatCalls).toHaveLength(1)
    const call = fakes.beatCalls[0]!
    expect(call.place_id).toBe(ROOM_B)
    expect(call.place_name).toBe('Mess')
    expect(call.sim_tick).toBe(0) // no prior sim ticks → numbering starts at 0.
    // All three off-scene NPCs co-locate in B; the rival cook↔medic edge supplies
    // the tension, but the whole co-located group is the beat's cast.
    expect(call.participants.map((p) => p.character_id).sort()).toEqual([
      COOK_ID,
      MEDIC_ID,
      SETTLED_ID,
    ])

    // A provenance='sim' timeline event was appended with the beat's tick.
    expect(fakes.appendCalls).toHaveLength(1)
    const event = fakes.appendCalls[0]!
    expect(event.provenance).toBe('sim')
    expect(event.sim_tick).toBe(0)
    expect(event.turn_id).toBeNull()
    expect(event.world_time).toBe('Day 1 — midday')
    expect(event.title).toBe('Beat in Mess')

    // The beat applied its +0.5 delta to the rival edge (not the −0.1 chafe).
    expect(fakes.adjustCalls).toHaveLength(1)
    expect(fakes.adjustCalls[0]!.relationshipId).toBe(10)
    expect(fakes.adjustCalls[0]!.delta).toBeCloseTo(0.5, 6)
  })

  it('continues sim_tick numbering past the pre-play sim max', async () => {
    const priorEvent: TimelineEvent = {
      id: 99,
      world_id: WORLD_ID,
      turn_id: null,
      thread_id: null,
      thread_title: null,
      world_time: 'Day 1 — morning',
      title: 'Earlier beat',
      summary: 'Something happened before boarding.',
      importance: 2,
      sim_tick: 11,
      provenance: 'sim',
      created_at: '',
    }
    const fakes = buildFakes(roster, rivalRels, [priorEvent])
    // currentTick 12 (a later turn) with a prior beat at 11 + cooldownTicks 1:
    // 12 − 11 = 1 ≥ 1 ⇒ a beat fires, numbered 12 — past the pre-play sim's last.
    await tickLivingWorld(
      { worldId: WORLD_ID, playerPlaceId: ROOM_A, currentTick: 12, cooldownTicks: 1 },
      fakes.deps,
    )

    expect(fakes.beatCalls).toHaveLength(1)
    expect(fakes.beatCalls[0]!.sim_tick).toBe(12)
    expect(fakes.appendCalls[0]!.sim_tick).toBe(12)
    // Prior beat threaded into recentBeats memory.
    expect(fakes.beatCalls[0]!.recentBeats).toContain(
      'Earlier beat: Something happened before boarding.',
    )
  })

  it('suppresses a beat when a recent sim beat is within the cooldown', async () => {
    const recentEvent: TimelineEvent = {
      id: 99,
      world_id: WORLD_ID,
      turn_id: null,
      thread_id: null,
      thread_title: null,
      world_time: 'Day 1 — morning',
      title: 'Just now',
      summary: 'A beat one tick ago.',
      importance: 2,
      sim_tick: 5,
      provenance: 'sim',
      created_at: '',
    }
    // currentTick 6, lastSimBeatTick 5, cooldown 2 ⇒ 6 − 5 = 1 < 2 ⇒ gated FALSE.
    // The rivals still take the deterministic chafe instead.
    const fakes = buildFakes(roster, rivalRels, [recentEvent])
    const result = await tickLivingWorld(
      { worldId: WORLD_ID, playerPlaceId: ROOM_A, currentTick: 6 },
      fakes.deps,
    )

    expect(result.beatsWritten).toBe(0)
    expect(fakes.appendCalls).toHaveLength(0)
    // Deterministic rival chafe: −0.5 → −0.6, persisted as a −0.1 delta.
    expect(fakes.adjustCalls).toHaveLength(1)
    expect(fakes.adjustCalls[0]!.delta).toBeCloseTo(-0.1, 6)
  })

  it('does NOT deadlock the cooldown when prior beats exist (regression)', async () => {
    // The bug: the tick was derived from maxSimTick+1, so a prior beat at 11 pinned
    // the tick at 12 forever and (12 − 11 = 1) never cleared a cooldown of 2 — no
    // beat ever fired during play. With a monotonic per-turn currentTick, a later
    // turn (here 150) clears the cooldown against the prior beat at 11 and fires.
    const priorBeat: TimelineEvent = {
      id: 99,
      world_id: WORLD_ID,
      turn_id: null,
      thread_id: null,
      thread_title: null,
      world_time: 'Day 1 — morning',
      title: 'Pre-play beat',
      summary: 'Before boarding.',
      importance: 2,
      sim_tick: 11,
      provenance: 'sim',
      created_at: '',
    }
    const fakes = buildFakes(roster, rivalRels, [priorBeat])
    const result = await tickLivingWorld(
      { worldId: WORLD_ID, playerPlaceId: ROOM_A, currentTick: 150 },
      fakes.deps,
    )

    expect(result.beatsWritten).toBe(1)
    expect(fakes.beatCalls[0]!.sim_tick).toBe(150)
  })
})

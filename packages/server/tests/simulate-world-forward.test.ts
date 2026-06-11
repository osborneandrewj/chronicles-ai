import { describe, expect, it } from 'vitest'

import { simulateWorldForward } from '@/application/use-cases/simulate-world-forward'
import type { SimulateWorldForwardDeps } from '@/application/use-cases/simulate-world-forward'
import type { Character, CharacterRelationship, Place, PlaceConnection } from '@/domain/entities'
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
  TimelineWriter,
  WorldRepository,
} from '@/domain/ports'

// Unit test for SimulateWorldForward (starship P2). Pure orchestration exercised
// with in-memory fake ports that record their calls — no DB, no LLM. A 3-room line
// graph (bridge ── mess ── quarters), three NPCs on routines plus an ally pair that
// co-locates, run for 8 ticks. Asserts: final positions match each routine's target
// for the final band, setPlace persisted those, the co-located allies' valence
// drifted positive and was persisted via a single adjustValence delta, the world
// clock advanced to the right label, and an NPC with a malformed loop stays put.

const WORLD_ID = 7

// Place ids for the line graph.
const BRIDGE = 100
const MESS = 101
const QUARTERS = 102

// 8 ticks → bands cycle morning, midday, evening, night, morning, midday, evening,
// night. tick 7 (the last) is band 'night'. Each NPC's loop names where it belongs
// per band; the captain + cook share the MESS at night so they co-locate there.
const CAPTAIN_LOOP = {
  morning: { activity: 'command', place_id: BRIDGE },
  midday: { activity: 'command', place_id: BRIDGE },
  evening: { activity: 'rounds', place_id: MESS },
  night: { activity: 'supper', place_id: MESS },
}
const COOK_LOOP = {
  morning: { activity: 'prep', place_id: MESS },
  midday: { activity: 'serve', place_id: MESS },
  evening: { activity: 'clean', place_id: MESS },
  night: { activity: 'supper', place_id: MESS },
}
// The loner sleeps in quarters at night, alone — never co-located.
const LONER_LOOP = {
  morning: { activity: 'patrol', place_id: BRIDGE },
  midday: { activity: 'patrol', place_id: QUARTERS },
  evening: { activity: 'rest', place_id: QUARTERS },
  night: { activity: 'sleep', place_id: QUARTERS },
}

const CAPTAIN_ID = 1
const COOK_ID = 2
const LONER_ID = 3
const PLAYER_ID = 4
const DRIFTER_ID = 5 // NPC with a malformed daily_loop — stays at its start room.

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
  place({ id: BRIDGE, name: 'Bridge' }),
  place({ id: MESS, name: 'Mess' }),
  place({ id: QUARTERS, name: 'Quarters' }),
]

type Fakes = {
  deps: SimulateWorldForwardDeps
  setPlaceCalls: Array<{ characterId: number; placeId: number | null }>
  adjustCalls: Array<{ relationshipId: number; delta: number }>
  setWorldTimeCalls: Array<{ worldId: number; worldTime: string }>
  beatCalls: DramaBeatInput[]
  appendCalls: TimelineEventInput[]
}

// A canned beat: nudges the (CAPTAIN, COOK) edge by +0.5 so a beat is clearly
// distinguishable from the +0.1 deterministic co-location step.
function cannedBeat(input: DramaBeatInput): DramaBeat {
  return {
    title: `Beat in ${input.place_name}`,
    summary: 'A canned drama beat for the test.',
    participant_ids: input.participants.map((p) => p.character_id),
    valenceDeltas: [{ from_character_id: CAPTAIN_ID, to_character_id: COOK_ID, delta: 0.5 }],
  }
}

function buildFakes(roster: Character[], rels: CharacterRelationship[]): Fakes {
  const setPlaceCalls: Fakes['setPlaceCalls'] = []
  const adjustCalls: Fakes['adjustCalls'] = []
  const setWorldTimeCalls: Fakes['setWorldTimeCalls'] = []
  const beatCalls: DramaBeatInput[] = []
  const appendCalls: TimelineEventInput[] = []

  // A line graph: bridge ── mess ── quarters (two bidirectional corridors).
  const connections: PlaceConnection[] = [
    {
      id: 1,
      world_id: WORLD_ID,
      from_place_id: BRIDGE,
      to_place_id: MESS,
      kind: 'corridor',
      bidirectional: 1,
      created_at: null,
    },
    {
      id: 2,
      world_id: WORLD_ID,
      from_place_id: MESS,
      to_place_id: QUARTERS,
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
    setWorldTime: async (worldId: number, worldTime: string) => {
      setWorldTimeCalls.push({ worldId, worldTime })
    },
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
  const clock: Clock = { now: () => new Date(0), today: () => '1970-01-01' }

  return {
    deps: { characters, placeConnections, relationships, worlds, places, drama, timeline, clock },
    setPlaceCalls,
    adjustCalls,
    setWorldTimeCalls,
    beatCalls,
    appendCalls,
  }
}

describe('simulateWorldForward', () => {
  const roster: Character[] = [
    character({ id: CAPTAIN_ID, current_place_id: BRIDGE, daily_loop: JSON.stringify(CAPTAIN_LOOP) }),
    character({ id: COOK_ID, current_place_id: MESS, daily_loop: JSON.stringify(COOK_LOOP) }),
    character({ id: LONER_ID, current_place_id: BRIDGE, daily_loop: JSON.stringify(LONER_LOOP) }),
    character({ id: PLAYER_ID, is_player: 1, current_place_id: BRIDGE }),
    character({ id: DRIFTER_ID, current_place_id: QUARTERS, daily_loop: 'not json {{' }),
  ]
  const rels: CharacterRelationship[] = [
    relationship({ id: 10, from_character_id: CAPTAIN_ID, to_character_id: COOK_ID, kind: 'ally', valence: 0.2 }),
  ]

  it('moves NPCs to their routine target for the final band and persists final positions', async () => {
    const fakes = buildFakes(roster, rels)
    const result = await simulateWorldForward({ worldId: WORLD_ID, ticks: 8, tensionThreshold: 2 }, fakes.deps)

    // tick 7 = 'night': captain + cook in MESS, loner in QUARTERS.
    const byId = new Map(result.finalPositions.map((p) => [p.characterId, p.placeId]))
    expect(byId.get(CAPTAIN_ID)).toBe(MESS)
    expect(byId.get(COOK_ID)).toBe(MESS)
    expect(byId.get(LONER_ID)).toBe(QUARTERS)

    // setPlace persisted the same final rooms (one call per NPC, not the player).
    const setById = new Map(fakes.setPlaceCalls.map((c) => [c.characterId, c.placeId]))
    expect(setById.get(CAPTAIN_ID)).toBe(MESS)
    expect(setById.get(COOK_ID)).toBe(MESS)
    expect(setById.get(LONER_ID)).toBe(QUARTERS)
    expect(fakes.setPlaceCalls).toHaveLength(4) // captain, cook, loner, drifter — not the player
  })

  it('drifts co-located allies positive and persists a single valence delta', async () => {
    const fakes = buildFakes(roster, rels)
    const result = await simulateWorldForward({ worldId: WORLD_ID, ticks: 8, tensionThreshold: 2 }, fakes.deps)

    // Captain + cook share MESS at evening (tick 2,6) and night (tick 3,7); the
    // cook is always in MESS. Each co-located tick bonds +0.1 from 0.2.
    const drifted = result.drifted.find((d) => d.relationshipId === 10)
    expect(drifted).toBeDefined()
    expect(drifted!.valence).toBeGreaterThan(0.2)
    expect(drifted!.from).toBe(CAPTAIN_ID)
    expect(drifted!.to).toBe(COOK_ID)

    // Exactly one adjustValence call, with a positive delta = final − original.
    expect(fakes.adjustCalls).toHaveLength(1)
    expect(fakes.adjustCalls[0]!.relationshipId).toBe(10)
    expect(fakes.adjustCalls[0]!.delta).toBeCloseTo(drifted!.valence - 0.2, 6)
    expect(fakes.adjustCalls[0]!.delta).toBeGreaterThan(0)
  })

  it('advances the world clock to the LAST LIVED tick band (clock follows positions)', async () => {
    const fakes = buildFakes(roster, rels)
    await simulateWorldForward({ worldId: WORLD_ID, ticks: 8, tensionThreshold: 2 }, fakes.deps)

    // 8 ticks run as tick 0..7; the last lived tick is 7 → Day 2, night (4 ticks/
    // day). The clock matches where the NPCs actually ended, not the next band.
    expect(fakes.setWorldTimeCalls).toHaveLength(1)
    expect(fakes.setWorldTimeCalls[0]).toEqual({ worldId: WORLD_ID, worldTime: 'Day 2 — night' })
  })

  it('keeps an NPC with a malformed daily_loop at its starting room', async () => {
    const fakes = buildFakes(roster, rels)
    const result = await simulateWorldForward({ worldId: WORLD_ID, ticks: 8, tensionThreshold: 2 }, fakes.deps)

    const drifter = result.finalPositions.find((p) => p.characterId === DRIFTER_ID)
    expect(drifter?.placeId).toBe(QUARTERS) // never moved
    const setDrifter = fakes.setPlaceCalls.find((c) => c.characterId === DRIFTER_ID)
    expect(setDrifter?.placeId).toBe(QUARTERS)
  })

  it('excludes the player from the sim entirely', async () => {
    const fakes = buildFakes(roster, rels)
    const result = await simulateWorldForward({ worldId: WORLD_ID, ticks: 8, tensionThreshold: 2 }, fakes.deps)

    expect(result.finalPositions.some((p) => p.characterId === PLAYER_ID)).toBe(false)
    expect(fakes.setPlaceCalls.some((c) => c.characterId === PLAYER_ID)).toBe(false)
  })
})

// P3 — threshold-gated LLM beats. Same line graph, but the captain and cook are
// RIVALS (valence −0.5, |−0.5| ≥ the 0.3 threshold) and share the MESS at several
// ticks. With the threshold met, a beat fires; a large cooldown proves the per-room
// suppression of a second immediate beat; the canned beat's +0.5 delta (not the
// −0.1 deterministic rival-chafe) is what moves the relationship that tick.
describe('simulateWorldForward — gated drama beats (P3)', () => {
  // role lives in current_focus, goal in active_goal (P1 storage); enriched into the
  // DramaParticipant the beat reasons over.
  const beatRoster: Character[] = [
    character({
      id: CAPTAIN_ID,
      current_place_id: BRIDGE,
      daily_loop: JSON.stringify(CAPTAIN_LOOP),
      current_focus: 'captain',
      active_goal: 'keep the ship on course',
    }),
    character({
      id: COOK_ID,
      current_place_id: MESS,
      daily_loop: JSON.stringify(COOK_LOOP),
      current_focus: 'cook',
      active_goal: 'feed a restless crew',
    }),
    character({ id: PLAYER_ID, is_player: 1, current_place_id: BRIDGE }),
  ]
  // Captain + cook are rivals — tension above the default 0.3 threshold.
  const rivalRels: CharacterRelationship[] = [
    relationship({ id: 10, from_character_id: CAPTAIN_ID, to_character_id: COOK_ID, kind: 'rival', valence: -0.5 }),
  ]

  it('fires a gated beat, appends a sim timeline event, and applies the beat delta over deterministic drift', async () => {
    const fakes = buildFakes(beatRoster, rivalRels)
    // Large cooldown so only the FIRST co-located tick fires a beat.
    const result = await simulateWorldForward(
      { worldId: WORLD_ID, ticks: 8, cooldownTicks: 100, tensionThreshold: 0.3 },
      fakes.deps,
    )

    // Captain + cook first co-locate in MESS at tick 2 (evening). Exactly one beat.
    expect(result.beats).toBe(1)
    expect(fakes.beatCalls).toHaveLength(1)
    const call = fakes.beatCalls[0]!
    expect(call.sim_tick).toBe(2)
    expect(call.place_id).toBe(MESS)
    expect(call.place_name).toBe('Mess')
    expect(call.participants.map((p) => p.character_id).sort()).toEqual([CAPTAIN_ID, COOK_ID])
    // Enrichment: role from current_focus, goal from active_goal.
    const captain = call.participants.find((p) => p.character_id === CAPTAIN_ID)!
    expect(captain.role).toBe('captain')
    expect(captain.goal).toBe('keep the ship on course')

    // A provenance='sim' timeline event was appended with the beat's tick.
    expect(fakes.appendCalls).toHaveLength(1)
    const event = fakes.appendCalls[0]!
    expect(event.provenance).toBe('sim')
    expect(event.sim_tick).toBe(2)
    expect(event.turn_id).toBeNull()
    expect(event.title).toBe('Beat in Mess')

    // The beat supersedes the deterministic chafe on its tick. Co-location ticks for
    // the captain + cook are 2,3,6,7. At tick 2 the beat applies +0.5 (NOT the −0.1
    // rival chafe), taking −0.5 → 0.0. The cooldown blocks further beats, so ticks
    // 3,6,7 each apply the now-positive +0.1 deterministic drift: 0.0 → 0.3. Had the
    // beat tick ALSO chafed, the start of that chain would be −0.6, not 0.0.
    const drifted = result.drifted.find((d) => d.relationshipId === 10)
    expect(drifted).toBeDefined()
    expect(drifted!.valence).toBeCloseTo(0.3, 6)
    expect(drifted!.from).toBe(CAPTAIN_ID)
    expect(drifted!.to).toBe(COOK_ID)
    // Single net adjustValence delta = final − original = 0.3 − (−0.5) = 0.8.
    expect(fakes.adjustCalls).toHaveLength(1)
    expect(fakes.adjustCalls[0]!.relationshipId).toBe(10)
    expect(fakes.adjustCalls[0]!.delta).toBeCloseTo(0.8, 6)
  })

  it('threads a rolling ship-wide recentBeats window into later beats', async () => {
    const fakes = buildFakes(beatRoster, rivalRels)
    // Cooldown 0 + threshold 0 so a beat fires on every co-located tick (2,3,6,7),
    // even after the canned +0.5 delta drifts the rival edge out of tension range.
    await simulateWorldForward(
      { worldId: WORLD_ID, ticks: 8, cooldownTicks: 0, tensionThreshold: 0 },
      fakes.deps,
    )

    expect(fakes.beatCalls.length).toBeGreaterThanOrEqual(2)
    // The FIRST beat saw no prior beats.
    expect(fakes.beatCalls[0]!.recentBeats).toEqual([])
    // The SECOND beat saw the first beat as 'title: summary', proving the rolling
    // ship-wide window threads through (the canned beat: 'Beat in Mess: ...').
    const firstBeat = fakes.appendCalls[0]!
    expect(fakes.beatCalls[1]!.recentBeats).toContain(
      `${firstBeat.title}: ${firstBeat.summary}`,
    )
  })

  it('cooldown suppresses a second immediate beat in the same room', async () => {
    const fakes = buildFakes(beatRoster, rivalRels)
    // Cooldown 100 over 8 ticks: even though captain + cook share MESS at ticks
    // 2,3,6,7, only one beat may fire.
    const result = await simulateWorldForward(
      { worldId: WORLD_ID, ticks: 8, cooldownTicks: 100, tensionThreshold: 0.3 },
      fakes.deps,
    )

    expect(result.beats).toBe(1)
    expect(fakes.beatCalls).toHaveLength(1)
    expect(fakes.appendCalls).toHaveLength(1)
  })
})

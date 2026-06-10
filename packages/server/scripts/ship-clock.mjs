#!/usr/bin/env node
// Offline proof for starship P6 (the PROSE-DRIVEN ship-clock). Mirrors
// sim-ship.mjs: it builds the SQLite container against a throwaway temp DB and
// seeds a scout ship with the deterministic StubCrewGenerator (free, no key). It
// then sets the world's ship_clock_minutes near a band boundary (late 'night')
// and simulates a few player turns. On each turn a deterministic
// StubTimePassageEstimator returns a CHUNK of elapsed in-world minutes (the
// prose-time the narration would have covered); the script advances the clock by
// that chunk EXACTLY as narrate-turn does — ship_clock_minutes += elapsed, then
// minutesToShipTime(next) renders the new world_time + band, persisted via
// setShipClockMinutes + setWorldTime. It PRINTS the world_time + band after every
// step.
//
// Assertions (exit non-zero on any failure):
//   1. The clock advances every step (ship_clock_minutes strictly increases).
//   2. The narrative band SHIFTS across at least one boundary (night -> morning).
//   3. minutesToShipTime's band matches worldTimeBand(the rendered world_time) on
//      every step (the round-trip the living tick relies on).
// Ends with an OK line.
//
// Run with the repo's tsx runner + the react-server condition (so the
// `server-only` markers on the adapters resolve to a no-op), exactly like
// sim-ship.mjs:
//
//   npx tsx --conditions=react-server --tsconfig packages/server/tsconfig.json \
//     packages/server/scripts/ship-clock.mjs
//
// DATABASE_PATH is set to a fresh /tmp file BEFORE the container is imported so
// migrations.ts runs on a clean DB and nothing touches a real world store.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

// Point the SQLite engine at a fresh temp DB before any infra module loads.
const tmpDir = mkdtempSync(path.join(tmpdir(), 'chronicles-ship-clock-'))
process.env.DATABASE_PATH = path.join(tmpDir, 'ship-clock.sqlite')
process.env.PERSISTENCE = 'sqlite'

const { getContainer } = await import('@/composition/container')
const { seedBoundedWorld } = await import(
  '@/application/use-cases/seed-bounded-world'
)
const { StubCrewGenerator } = await import(
  '@/infrastructure/world-gen/stub-crew-generator'
)
const { StubTimePassageEstimator } = await import(
  '@/infrastructure/world-gen/stub-time-passage-estimator'
)
const { SCOUT_TEMPLATE_ID } = await import(
  '@/infrastructure/world-gen/scout-template'
)
const { minutesToShipTime, shipTimeToMinutes } = await import(
  '@/domain/services/ship-clock'
)
const { worldTimeBand } = await import('@/domain/services/world-clock')

// A handful of narration beats with the prose-time each would plausibly cover.
// The StubTimePassageEstimator IGNORES the prose (deterministic), so we drive the
// elapsed minutes per step explicitly — the proof is the CLOCK MATH + round-trip,
// not the LLM estimate. The spans are chosen to walk the band from late night
// through morning and into midday across the run.
const TURNS = [
  { narration: 'A brief exchange on the dark bridge.', elapsedMinutes: 90 },
  { narration: 'The watch wears on; coffee, quiet checks.', elapsedMinutes: 120 },
  { narration: 'Shift change. The crew filter into the mess for a meal.', elapsedMinutes: 180 },
  { narration: 'Morning drills run long in the sim deck.', elapsedMinutes: 150 },
  { narration: 'Repairs in the engine room stretch past midday.', elapsedMinutes: 120 },
]

async function main() {
  const c = getContainer()
  console.log(`[ship-clock] temp DB: ${process.env.DATABASE_PATH}`)

  // Seed a scout ship with the deterministic stub crew (free + reproducible).
  const seedResult = await seedBoundedWorld(
    {
      templateId: SCOUT_TEMPLATE_ID,
      name: 'EMS Wayfarer',
      premise:
        'A lone scout vessel runs a long, quiet survey arc through an unmapped fringe; the crew has been alone with each other for far too long.',
    },
    {
      decks: c.decks,
      crew: new StubCrewGenerator(),
      worlds: c.worlds,
      places: c.places,
      placeConnections: c.placeConnections,
      characters: c.characters,
      relationships: c.relationships,
      clock: c.clock,
    },
  )
  const worldId = seedResult.worldId

  const estimator = new StubTimePassageEstimator()

  // Start the clock late at 'night' (just before the 05:00 morning boundary), so
  // the first chunk of prose-time crosses into morning. 04:10 on Day 3.
  const startMinutes = 2 * 1440 + 4 * 60 + 10 // Day 3, 04:10
  const startRender = minutesToShipTime(startMinutes)
  await c.worlds.setShipClockMinutes(worldId, startMinutes)
  await c.worlds.setWorldTime(worldId, startRender.worldTime)

  console.log('')
  console.log(`SHIP: world #${worldId} "EMS Wayfarer" — prose-driven clock`)
  console.log(
    `  start: ${startMinutes} min -> ${startRender.worldTime} [band ${startRender.band}]`,
  )

  // Sanity: the seeded clock reads back through the repo (getWorld carries the
  // ship_clock_minutes field — the masked-cast prerequisite the plan flags).
  const seeded = await c.worlds.getWorld(worldId)
  if (seeded?.ship_clock_minutes !== startMinutes) {
    console.error(
      `FAIL: ship_clock_minutes did not round-trip via getWorld ` +
        `(set ${startMinutes}, read ${seeded?.ship_clock_minutes ?? 'null'})`,
    )
    process.exit(1)
  }

  console.log('')
  console.log(`SIMULATING ${TURNS.length} TURNS (prose -> elapsed minutes):`)

  // Walk the turns, advancing the clock exactly as narrate-turn does post-stream.
  const steps = [
    { worldTime: startRender.worldTime, band: startRender.band, minutes: startMinutes },
  ]
  let prevWorldTime = startRender.worldTime

  for (const [i, turn] of TURNS.entries()) {
    const world = await c.worlds.getWorld(worldId)
    // backfill-on-null exactly like the narrate-turn integration.
    const current = world?.ship_clock_minutes ?? shipTimeToMinutes(world?.world_time ?? null)

    const { elapsedMinutes } = await estimator.estimate({
      narration: turn.narration,
      priorWorldTime: prevWorldTime,
    })
    // The stub returns a fixed span; drive the proof with this turn's chunk so the
    // band visibly walks across boundaries.
    const elapsed = turn.elapsedMinutes + elapsedMinutes
    const next = current + elapsed
    const { worldTime, band } = minutesToShipTime(next)

    await c.worlds.setShipClockMinutes(worldId, next)
    await c.worlds.setWorldTime(worldId, worldTime)

    console.log(
      `  turn ${i + 1}: +${elapsed} min -> ${worldTime} [band ${band}] ` +
        `<- "${turn.narration}"`,
    )

    steps.push({ worldTime, band, minutes: next })
    prevWorldTime = worldTime
  }

  // ---- Assertions ----

  // 1. The clock advances every step (strictly increasing minute counter), and
  //    the persisted counter matches the final computed value.
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].minutes <= steps[i - 1].minutes) {
      console.error(
        `FAIL: clock did not advance at step ${i} ` +
          `(${steps[i - 1].minutes} -> ${steps[i].minutes})`,
      )
      process.exit(1)
    }
  }
  const finalWorld = await c.worlds.getWorld(worldId)
  const finalMinutes = steps[steps.length - 1].minutes
  if (finalWorld?.ship_clock_minutes !== finalMinutes) {
    console.error(
      `FAIL: persisted ship_clock_minutes ${finalWorld?.ship_clock_minutes ?? 'null'} ` +
        `!= final computed ${finalMinutes}`,
    )
    process.exit(1)
  }

  // 2. minutesToShipTime's band matches worldTimeBand(the rendered string) on
  //    every step — the round-trip the living tick relies on.
  for (const step of steps) {
    const parsed = worldTimeBand(step.worldTime)
    if (parsed !== step.band) {
      console.error(
        `FAIL: band round-trip broke for "${step.worldTime}" — ` +
          `minutesToShipTime said '${step.band}' but worldTimeBand parsed '${parsed}'`,
      )
      process.exit(1)
    }
  }

  // 3. The narrative band SHIFTS across at least one boundary, and specifically
  //    crosses night -> morning (the boundary we seeded against).
  const bands = steps.map((s) => s.band)
  const distinctBands = new Set(bands)
  if (distinctBands.size < 2) {
    console.error(
      `FAIL: band never shifted — stayed '${bands[0]}' across all ${steps.length} steps`,
    )
    process.exit(1)
  }
  let crossedNightToMorning = false
  for (let i = 1; i < bands.length; i++) {
    if (bands[i - 1] === 'night' && bands[i] === 'morning') crossedNightToMorning = true
  }
  if (!crossedNightToMorning) {
    console.error(
      `FAIL: band did not cross the night -> morning boundary ` +
        `(saw ${bands.join(' -> ')})`,
    )
    process.exit(1)
  }

  console.log('')
  console.log(
    `OK: prose-time advanced the clock ${startMinutes} -> ${finalMinutes} min ` +
      `(${TURNS.length} turns); band walked ${bands.join(' -> ')}; ` +
      `every render round-trips through worldTimeBand`,
  )
}

main().catch((err) => {
  console.error('[ship-clock] failed:', err)
  process.exit(1)
})

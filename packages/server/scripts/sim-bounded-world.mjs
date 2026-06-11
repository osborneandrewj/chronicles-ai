#!/usr/bin/env node
// Offline proof for starship P2 + P3 (the deterministic forward sim + the
// threshold-gated LLM beat seam). Builds the SQLite container against a throwaway
// temp DB, seeds a scout ship with the deterministic StubEnsembleGenerator (free,
// reproducible, no API key), then runs the SimulateWorldForward use case for 24
// ticks. P2: pure NPC movement + co-location + relationship drift. P3: when a
// co-located group has enough seeded tension and the cooldown has elapsed, it
// spends ONE structured beat via the deterministic StubDramaPort (no spend) and
// the real SqliteTimelineWriter appends it as a provenance='sim' timeline event.
// It reads the result back through the repos and prints the world time after the
// run, each NPC's final room, every relationship's valence (before -> after), and
// every provenance='sim' timeline beat written. It asserts the world clock
// advanced, every NPC ended in the room its daily_loop assigns for the final
// tick's band, at least one relationship drifted, and at least one sim beat was
// written — exiting non-zero on any failure.
//
// Run with the repo's tsx runner + the react-server condition (so the
// `server-only` markers on the adapters resolve to a no-op), exactly like the
// other TS scripts:
//
//   npx tsx --conditions=react-server --tsconfig packages/server/tsconfig.json \
//     packages/server/scripts/sim-ship.mjs
//
// (the --tsconfig flag is required so the `@/*` path alias, which is rooted in
// packages/server, resolves from the repo root)
//
// DATABASE_PATH is set to a fresh /tmp file BEFORE the container is imported so
// migrations.ts runs on a clean DB and nothing touches a real world store.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

// Point the SQLite engine at a fresh temp DB before any infra module loads.
const tmpDir = mkdtempSync(path.join(tmpdir(), 'chronicles-sim-ship-'))
process.env.DATABASE_PATH = path.join(tmpDir, 'sim-ship.sqlite')
process.env.PERSISTENCE = 'sqlite'

const { getContainer } = await import('@/composition/container')
const { seedBoundedWorld } = await import(
  '@/application/use-cases/seed-bounded-world'
)
const { simulateWorldForward } = await import(
  '@/application/use-cases/simulate-world-forward'
)
const { StubEnsembleGenerator } = await import(
  '@/infrastructure/world-gen/stub-crew-generator'
)
const { StubDramaPort } = await import(
  '@/infrastructure/world-gen/stub-drama-port'
)
const { db } = await import('@/lib/db')
const { tickToBand } = await import('@/domain/services/sim-clock')

const TICKS = 24

async function main() {
  const c = getContainer()
  console.log(`[sim-ship] temp DB: ${process.env.DATABASE_PATH}`)

  // Seed a scout ship with the deterministic stub crew (free + reproducible).
  const seedResult = await seedBoundedWorld(
    {
      templateId: 'scout-vessel',
      name: 'EMS Wayfarer',
      premise:
        'A lone scout vessel runs a long, quiet survey arc through an unmapped fringe; the crew has been alone with each other for far too long.',
    },
    {
      decks: c.decks,
      crew: new StubEnsembleGenerator(),
      worlds: c.worlds,
      places: c.places,
      placeConnections: c.placeConnections,
      characters: c.characters,
      relationships: c.relationships,
      clock: c.clock,
    },
  )
  const worldId = seedResult.worldId

  // Snapshot the world time + relationship valences BEFORE the sim runs.
  const startCursor = await c.worlds.cursor(worldId)
  const startWorldTime = startCursor.world_time
  const startRelationships = await c.relationships.forWorld(worldId)
  const startValenceById = new Map(startRelationships.map((r) => [r.id, r.valence]))

  // Run the forward sim. cooldownTicks/tensionThreshold are set so the seeded
  // ally tension (StubEnsembleGenerator emits valence 0.4 ally edges, |valence| >=
  // 0.3) clears the gate and beats fire when co-located crew share a room. The
  // real SqliteTimelineWriter persists each beat; the StubDramaPort generates them
  // free + deterministically (no spend).
  const simResult = await simulateWorldForward(
    { worldId, ticks: TICKS, cooldownTicks: 3, tensionThreshold: 0.3 },
    {
      characters: c.characters,
      placeConnections: c.placeConnections,
      relationships: c.relationships,
      worlds: c.worlds,
      places: c.places,
      drama: new StubDramaPort(),
      timeline: c.timeline,
      clock: c.clock,
    },
  )

  // Read everything back through the repos.
  const endCursor = await c.worlds.cursor(worldId)
  const endWorldTime = endCursor.world_time
  const places = await c.places.forWorld(worldId)
  const crew = await c.characters.forWorld(worldId)
  const relationships = await c.relationships.forWorld(worldId)

  const placeById = new Map(places.map((p) => [p.id, p]))
  const charById = new Map(crew.map((ch) => [ch.id, ch]))
  const roomName = (id) => (id == null ? '(none)' : placeById.get(id)?.name ?? `#${id}`)

  // Positions reflect the LAST EXECUTED tick (the loop runs tick = 0..TICKS-1),
  // so the routine to check against is the band of tick TICKS-1 — and the world
  // clock now matches it (clock follows positions: set to tickToWorldTime(TICKS-1)).
  const finalBand = tickToBand(TICKS - 1)

  console.log('')
  console.log(`SHIP: world #${worldId} "EMS Wayfarer" — simulated ${TICKS} ticks`)
  console.log(`  world time: ${startWorldTime ?? '(none)'} -> ${endWorldTime ?? '(none)'}`)
  console.log(`  last executed tick band: ${finalBand} (tick ${TICKS - 1})`)

  console.log('')
  console.log(`FINAL POSITIONS (${simResult.finalPositions.length} NPCs):`)
  for (const pos of simResult.finalPositions) {
    const ch = charById.get(pos.characterId)
    const loop = ch?.daily_loop ? safeParse(ch.daily_loop) : null
    const expectedRoomId = loop?.[finalBand]?.place_id ?? null
    console.log(
      `  #${pos.characterId} ${ch?.name ?? '?'} — in ${roomName(pos.placeId)} ` +
        `(routine ${finalBand} -> ${roomName(expectedRoomId)})`,
    )
  }

  console.log('')
  console.log(`RELATIONSHIPS (${relationships.length}):`)
  for (const r of relationships) {
    const before = startValenceById.get(r.id) ?? 0
    const changed = before !== r.valence ? '  <- drifted' : ''
    console.log(
      `  ${charById.get(r.from_character_id)?.name ?? '?'} -> ` +
        `${charById.get(r.to_character_id)?.name ?? '?'}: ` +
        `${r.kind ?? 'rel'} valence ${before} -> ${r.valence}${changed}`,
    )
  }

  // Read the provenance='sim' timeline beats back through the raw DB handle (no
  // onion read port for timeline_events yet; this is an offline script).
  const simBeats = db
    .prepare(
      `SELECT sim_tick, world_time, title, summary
         FROM timeline_events
        WHERE world_id = ? AND provenance = 'sim'
        ORDER BY sim_tick, id`,
    )
    .all(worldId)

  console.log('')
  console.log(`SIM BEATS (provenance='sim') (${simBeats.length}):`)
  for (const beat of simBeats) {
    console.log(
      `  tick ${beat.sim_tick} [${beat.world_time ?? '(none)'}] — ${beat.title}`,
    )
  }

  // Assertions — the P2 + P3 proof.
  // 1. The world clock advanced past the start.
  if (endWorldTime == null) {
    console.error('FAIL: world time was not set by the sim')
    process.exit(1)
  }
  if (endWorldTime === startWorldTime) {
    console.error(
      `FAIL: world time did not advance (still ${endWorldTime ?? '(none)'})`,
    )
    process.exit(1)
  }

  // 2. Every NPC's final room matches its daily_loop for the final tick's band.
  for (const pos of simResult.finalPositions) {
    const ch = charById.get(pos.characterId)
    const loop = ch?.daily_loop ? safeParse(ch.daily_loop) : null
    const expectedRoomId = loop?.[finalBand]?.place_id ?? null
    if (pos.placeId !== expectedRoomId) {
      console.error(
        `FAIL: NPC #${pos.characterId} ${ch?.name ?? '?'} ended in ` +
          `${roomName(pos.placeId)} but its ${finalBand} routine is ` +
          `${roomName(expectedRoomId)}`,
      )
      process.exit(1)
    }
  }

  // 3. At least one relationship drifted from co-location.
  const driftedCount = relationships.filter(
    (r) => (startValenceById.get(r.id) ?? 0) !== r.valence,
  ).length
  if (driftedCount < 1) {
    console.error('FAIL: no relationship valence changed — co-location drift never fired')
    process.exit(1)
  }

  // 4. At least one threshold-gated sim beat was written to the timeline.
  if (simBeats.length < 1) {
    console.error(
      'FAIL: no provenance=\'sim\' timeline beat written — the gated beat seam never fired',
    )
    process.exit(1)
  }
  if (simResult.beats !== simBeats.length) {
    console.error(
      `FAIL: result reported ${simResult.beats} beats but ${simBeats.length} ` +
        'sim timeline events were persisted',
    )
    process.exit(1)
  }

  console.log('')
  console.log(
    `OK: simulated ${TICKS} ticks; crew ended on routine ` +
      `(${driftedCount} relationship${driftedCount === 1 ? '' : 's'} drifted, ` +
      `${simBeats.length} beat${simBeats.length === 1 ? '' : 's'} written, ` +
      `world time ${endWorldTime})`,
  )
}

function safeParse(json) {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

main().catch((err) => {
  console.error('[sim-ship] failed:', err)
  process.exit(1)
})

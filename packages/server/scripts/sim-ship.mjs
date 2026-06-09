#!/usr/bin/env node
// Offline proof for starship P2 (the deterministic forward sim). Builds the
// SQLite container against a throwaway temp DB, seeds a scout ship with the
// deterministic StubCrewGenerator (free, reproducible, no API key), then runs the
// SimulateWorldForward use case for 24 ticks of pure NPC movement + co-location +
// relationship drift with NO LLM. It reads the result back through the repos and
// prints the world time after the run, each NPC's final room, and every
// relationship's valence (before -> after). It asserts the world clock advanced,
// every NPC ended in the room its daily_loop assigns for the final tick's band,
// and at least one relationship drifted from co-location — exiting non-zero on any
// failure.
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
const { StubCrewGenerator } = await import(
  '@/infrastructure/world-gen/stub-crew-generator'
)
const { SCOUT_TEMPLATE_ID } = await import(
  '@/infrastructure/world-gen/scout-template'
)
const { tickToBand } = await import('@/domain/services/sim-clock')

const TICKS = 24

async function main() {
  const c = getContainer()
  console.log(`[sim-ship] temp DB: ${process.env.DATABASE_PATH}`)

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

  // Snapshot the world time + relationship valences BEFORE the sim runs.
  const startCursor = await c.worlds.cursor(worldId)
  const startWorldTime = startCursor.world_time
  const startRelationships = await c.relationships.forWorld(worldId)
  const startValenceById = new Map(startRelationships.map((r) => [r.id, r.valence]))

  // Run the deterministic forward sim.
  const simResult = await simulateWorldForward(
    { worldId, ticks: TICKS },
    {
      characters: c.characters,
      placeConnections: c.placeConnections,
      relationships: c.relationships,
      worlds: c.worlds,
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
  // so the routine to check against is the band of tick TICKS-1. The world clock,
  // by contrast, is set to tickToWorldTime(TICKS) — the next band to play.
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

  // Assertions — the P2 proof.
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

  console.log('')
  console.log(
    `OK: simulated ${TICKS} ticks; crew ended on routine ` +
      `(${driftedCount} relationship${driftedCount === 1 ? '' : 's'} drifted, ` +
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

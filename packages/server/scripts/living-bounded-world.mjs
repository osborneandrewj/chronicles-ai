#!/usr/bin/env node
// Offline proof for starship P5 (the DURING-PLAY "living tick"). The pre-play
// forward sim freezes once a player boards, because the open-world turn pipeline
// skips off-scene looped NPCs. On a sealed bounded ship that is wrong — ALL
// off-scene crew should keep moving every turn. This script proves the
// TickLivingWorld use case does exactly that against a throwaway temp SQLite DB.
//
// It builds the SQLite container, seeds a scout ship with the deterministic
// StubEnsembleGenerator (free, reproducible, no API key), then sets the player in ONE
// room and drives the LIVE world clock to a known band so the crew's daily_loop
// has somewhere to send them. It calls tickLivingWorld several times — printing
// off-scene crew positions before/after each tick and the provenance='sim' beats
// written — and asserts (exiting non-zero on any failure):
//   1. at least one OFF-SCENE crew member MOVED toward its routine room;
//   2. at least one drama beat fired (a provenance='sim' timeline event written);
//   3. a crew member CO-LOCATED with the player was NOT force-moved (left to the
//      narrator/archivist — the living tick never double-moves the player's room).
//
// Run with the repo's tsx runner + the react-server condition (so the
// `server-only` markers on the adapters resolve to a no-op), exactly like the
// other TS scripts:
//
//   npx tsx --conditions=react-server --tsconfig packages/server/tsconfig.json \
//     packages/server/scripts/living-ship.mjs
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
const tmpDir = mkdtempSync(path.join(tmpdir(), 'chronicles-living-ship-'))
process.env.DATABASE_PATH = path.join(tmpDir, 'living-ship.sqlite')
process.env.PERSISTENCE = 'sqlite'

const { getContainer } = await import('@/composition/container')
const { seedBoundedWorld } = await import(
  '@/application/use-cases/seed-bounded-world'
)
const { tickLivingWorld } = await import(
  '@/application/use-cases/tick-living-world'
)
const { StubEnsembleGenerator } = await import(
  '@/infrastructure/world-gen/stub-crew-generator'
)
const { StubDramaPort } = await import(
  '@/infrastructure/world-gen/stub-drama-port'
)
const { db } = await import('@/lib/db')
const { worldTimeBand } = await import('@/domain/services/world-clock')

// The live clock band the tick reads off. Midday sends every crew member's
// stub daily_loop to the shared room (the bridge), so off-scene crew have a real
// reason to move and then co-locate.
const LIVE_WORLD_TIME = 'Day 1 — midday'

async function main() {
  const c = getContainer()
  console.log(`[living-ship] temp DB: ${process.env.DATABASE_PATH}`)

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

  // Set the LIVE world clock so worldTimeBand() resolves to a band whose routine
  // target (the bridge) differs from where most crew start — giving the off-scene
  // crew somewhere to move toward this tick.
  await c.worlds.setWorldTime(worldId, LIVE_WORLD_TIME)
  const band = worldTimeBand(LIVE_WORLD_TIME)

  const places = await c.places.forWorld(worldId)
  const placeById = new Map(places.map((p) => [p.id, p]))
  const placeIdByName = new Map(places.map((p) => [p.name, p.id]))
  const roomName = (id) => (id == null ? '(none)' : placeById.get(id)?.name ?? `#${id}`)

  // Land the player in the Med Bay — the medic's home room — so the medic is
  // co-located with the player (off-scene filter excludes it ⇒ it must NOT be
  // force-moved) while the other crew start elsewhere and must move toward the
  // bridge for this band.
  const playerPlaceId = placeIdByName.get('Med Bay') ?? null
  if (playerPlaceId == null) {
    console.error('FAIL: Med Bay room not found in the seeded ship')
    process.exit(1)
  }

  const crewBefore = (await c.characters.forWorld(worldId)).filter((ch) => ch.is_player === 0)
  const startPlaceById = new Map(crewBefore.map((ch) => [ch.id, ch.current_place_id]))
  const charById = new Map(crewBefore.map((ch) => [ch.id, ch]))

  // The crew co-located with the player at the start — these must never be
  // force-moved by the living tick (they are the narrator/archivist's job).
  const coLocatedWithPlayer = crewBefore.filter(
    (ch) => ch.current_place_id === playerPlaceId,
  )

  console.log('')
  console.log(`SHIP: world #${worldId} "EMS Wayfarer"`)
  console.log(`  live world time: ${LIVE_WORLD_TIME} (band: ${band})`)
  console.log(`  player is in: ${roomName(playerPlaceId)}`)

  console.log('')
  console.log('OFF-SCENE CREW — positions BEFORE the living tick:')
  for (const ch of crewBefore) {
    const tag = ch.current_place_id === playerPlaceId ? '  [with player]' : ''
    console.log(`  #${ch.id} ${ch.name} — in ${roomName(ch.current_place_id)}${tag}`)
  }

  // Call the living tick SEVERAL times. The drama port is the deterministic
  // StubDramaPort (no spend); the real Sqlite timeline writer/reader persist and
  // re-read the beats. We keep the band fixed across calls (the player lingers in
  // the Med Bay for a few turns of play): the first tick does the real moving, and
  // later ticks exercise the cooldown / no-double-move paths.
  const TICK_CALLS = 3
  let totalMoved = 0
  let totalBeats = 0
  for (let call = 0; call < TICK_CALLS; call += 1) {
    const result = await tickLivingWorld(
      { worldId, playerPlaceId, currentTick: call * 5, cooldownTicks: 2, tensionThreshold: 0.25 },
      {
        characters: c.characters,
        placeConnections: c.placeConnections,
        relationships: c.relationships,
        worlds: c.worlds,
        places: c.places,
        drama: new StubDramaPort(),
        timeline: c.timeline,
        timelineReader: c.timelineReader,
        clock: c.clock,
      },
    )
    totalMoved += result.movedCount
    totalBeats += result.beatsWritten
    console.log('')
    console.log(
      `LIVING TICK call ${call + 1}/${TICK_CALLS}: moved ${result.movedCount}, ` +
        `beats ${result.beatsWritten}`,
    )
    for (const pos of result.finalPositions) {
      console.log(`  #${pos.characterId} ${charById.get(pos.characterId)?.name ?? '?'} — now in ${roomName(pos.placeId)}`)
    }
  }

  // Re-read the crew so we see persisted positions (not just in-memory results).
  const crewAfter = (await c.characters.forWorld(worldId)).filter((ch) => ch.is_player === 0)
  console.log('')
  console.log('OFF-SCENE CREW — positions AFTER all living ticks (persisted):')
  for (const ch of crewAfter) {
    const moved = startPlaceById.get(ch.id) !== ch.current_place_id ? '  <- moved' : ''
    console.log(`  #${ch.id} ${ch.name} — in ${roomName(ch.current_place_id)}${moved}`)
  }

  // Read the provenance='sim' timeline beats back through the raw DB handle (the
  // script's own read; the use case writes them through the onion TimelineWriter).
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
    console.log(`  tick ${beat.sim_tick} [${beat.world_time ?? '(none)'}] — ${beat.title}`)
  }

  // ── Assertions — the P5 living-tick proof. ────────────────────────────────

  // 1. At least one OFF-SCENE crew member MOVED toward its routine room. We check
  // persisted positions against the start, EXCLUDING any crew that began with the
  // player (those are not off-scene), and confirm the move landed on the band's
  // routine target (the bridge).
  const bridgeId = placeIdByName.get('Bridge') ?? null
  const offSceneMovers = crewAfter.filter((ch) => {
    const start = startPlaceById.get(ch.id)
    return start !== playerPlaceId && ch.current_place_id !== start
  })
  if (offSceneMovers.length < 1) {
    console.error('FAIL: no off-scene crew member moved during the living tick')
    process.exit(1)
  }
  for (const mover of offSceneMovers) {
    if (mover.current_place_id !== bridgeId) {
      console.error(
        `FAIL: off-scene crew #${mover.id} ${mover.name} moved to ` +
          `${roomName(mover.current_place_id)} but its ${band} routine is ` +
          `${roomName(bridgeId)}`,
      )
      process.exit(1)
    }
  }

  // 2. At least one drama beat fired (a provenance='sim' timeline event).
  if (simBeats.length < 1) {
    console.error(
      'FAIL: no provenance=\'sim\' timeline beat written — the gated beat seam never fired',
    )
    process.exit(1)
  }
  if (totalBeats !== simBeats.length) {
    console.error(
      `FAIL: result reported ${totalBeats} beats but ${simBeats.length} sim ` +
        'timeline events were persisted',
    )
    process.exit(1)
  }

  // 3. A crew member co-located with the player was NOT force-moved. The medic
  // started in the Med Bay (the player's room) ⇒ off-scene filter excludes it ⇒
  // it must still be in the player's room after the ticks.
  if (coLocatedWithPlayer.length < 1) {
    console.error(
      'FAIL: test setup — no crew started co-located with the player; cannot prove no-double-move',
    )
    process.exit(1)
  }
  for (const present of coLocatedWithPlayer) {
    const now = crewAfter.find((ch) => ch.id === present.id)
    if (!now || now.current_place_id !== playerPlaceId) {
      console.error(
        `FAIL: crew #${present.id} ${present.name} was co-located with the player ` +
          `in ${roomName(playerPlaceId)} but the living tick moved it to ` +
          `${roomName(now?.current_place_id ?? null)}`,
      )
      process.exit(1)
    }
  }

  console.log('')
  console.log(
    `OK: living tick kept the ship alive — ${offSceneMovers.length} off-scene ` +
      `crew moved to the ${band} routine room, ${simBeats.length} sim beat` +
      `${simBeats.length === 1 ? '' : 's'} fired, and ` +
      `${coLocatedWithPlayer.length} crew with the player ` +
      `(${coLocatedWithPlayer.map((ch) => ch.name).join(', ')}) ` +
      'was left in place (total moved across calls: ' +
      `${totalMoved}, total beats: ${totalBeats})`,
  )
}

main().catch((err) => {
  console.error('[living-ship] failed:', err)
  process.exit(1)
})

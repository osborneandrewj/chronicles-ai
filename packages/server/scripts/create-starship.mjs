#!/usr/bin/env node
// Offline proof for starship P4a (creatable + playable Starship). Builds the
// SQLite container against a throwaway temp DB, then runs the CreateStarshipWorld
// use case with the deterministic StubCrewGenerator + StubDramaPort swapped in for
// the real Grok/Haiku adapters (so the run is free + reproducible + needs no API
// key — and it deliberately does NOT call the opening turn / real Grok, which is
// browser-verified). It seeds the authored scout ship, runs the player-less
// forward sim for 12 ticks, drops the player aboard as a newcomer on the Bridge,
// opens an active Scene 1 there, and points the world cursor at it. It then reads
// the world back through the repos and asserts the world is bounded, exactly one
// is_player character exists and sits in the Bridge, an active scene exists, the
// world cursor points at it, at least 3 crew exist, and the sim set world_time —
// exiting non-zero on any failure.
//
// Run with the repo's tsx runner + the react-server condition (so the
// `server-only` markers on the adapters resolve to a no-op), exactly like the
// other TS scripts:
//
//   npx tsx --conditions=react-server --tsconfig packages/server/tsconfig.json \
//     packages/server/scripts/create-starship.mjs
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
const tmpDir = mkdtempSync(path.join(tmpdir(), 'chronicles-create-starship-'))
process.env.DATABASE_PATH = path.join(tmpDir, 'create-starship.sqlite')
process.env.PERSISTENCE = 'sqlite'

const { getContainer } = await import('@/composition/container')
const { createStarshipWorld } = await import(
  '@/application/use-cases/create-starship-world'
)
const { StubCrewGenerator } = await import(
  '@/infrastructure/world-gen/stub-crew-generator'
)
const { StubDramaPort } = await import(
  '@/infrastructure/world-gen/stub-drama-port'
)
const { SCOUT_TEMPLATE_ID } = await import(
  '@/infrastructure/world-gen/scout-template'
)

const TICKS = 12

async function main() {
  const c = getContainer()
  console.log(`[create-starship] temp DB: ${process.env.DATABASE_PATH}`)

  // Build the CreateStarshipWorld deps from the container, but swap in the
  // deterministic stubs for the Grok crew generator + Haiku drama port so the run
  // is free + reproducible (no spend, no API key). This is the same DI surface the
  // real createStarshipWorldAction wires from the container.
  const deps = {
    decks: c.decks,
    crew: new StubCrewGenerator(),
    worlds: c.worlds,
    places: c.places,
    placeConnections: c.placeConnections,
    characters: c.characters,
    relationships: c.relationships,
    drama: new StubDramaPort(),
    timeline: c.timeline,
    scenes: c.scenes,
    clock: c.clock,
  }

  const result = await createStarshipWorld(
    {
      templateId: SCOUT_TEMPLATE_ID,
      name: 'EMS Wayfarer',
      premise:
        'A lone scout vessel runs a long, quiet survey arc through an unmapped fringe; the crew has been alone with each other for far too long.',
      playerName: '',
      ticks: TICKS,
    },
    deps,
  )

  const worldId = result.worldId

  // Read everything back through the repos.
  const world = await c.worlds.getWorld(worldId)
  const cursor = await c.worlds.cursor(worldId)
  const places = await c.places.forWorld(worldId)
  const everyone = await c.characters.forWorld(worldId)
  const activeScene = await c.scenes.activeForWorld(worldId)

  const placeById = new Map(places.map((p) => [p.id, p]))
  const roomName = (id) => (id == null ? '(none)' : placeById.get(id)?.name ?? `#${id}`)

  const players = everyone.filter((ch) => ch.is_player === 1)
  const crew = everyone.filter((ch) => ch.is_player !== 1)
  const player = players[0] ?? null

  // The scout template's first room is the Bridge — placeIds[0] / the entry room.
  // Resolve it from the seeded places to assert the player landed there.
  const bridgePlaceId = places.length ? places[0].id : null

  console.log('')
  console.log(`SHIP: world #${worldId} "${world?.name}"`)
  console.log(`  spatial_mode=${world?.spatial_mode} template_id=${world?.template_id}`)
  console.log(`  world_time=${cursor.world_time ?? '(none)'}`)
  console.log(`  current_scene_id=${cursor.current_scene_id ?? '(none)'}`)

  console.log('')
  console.log(`PLAYER (${players.length}):`)
  if (player) {
    console.log(
      `  #${player.id} "${player.name}" — in ${roomName(player.current_place_id)} ` +
        `(is_player=${player.is_player})`,
    )
  } else {
    console.log('  (none)')
  }

  console.log('')
  console.log(`CREW (${crew.length}):`)
  for (const ch of crew) {
    console.log(`  #${ch.id} ${ch.name} — in ${roomName(ch.current_place_id)}`)
  }

  console.log('')
  console.log('ACTIVE SCENE:')
  if (activeScene) {
    console.log(
      `  #${activeScene.id} "${activeScene.title}" — ${roomName(activeScene.place_id)} ` +
        `(scene_number=${activeScene.scene_number}, status=${activeScene.status})`,
    )
  } else {
    console.log('  (none)')
  }

  // Assertions — the P4a "playable starship" proof. Exit non-zero on any failure.
  const fail = (msg) => {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }

  // 1. The world is in bounded spatial mode.
  if (world?.spatial_mode !== 'bounded') {
    fail(`world spatial_mode is '${world?.spatial_mode}', expected 'bounded'`)
  }

  // 2. Exactly one is_player character exists, and it sits in the Bridge (entry).
  if (players.length !== 1) {
    fail(`expected exactly 1 is_player character, found ${players.length}`)
  }
  if (player.current_place_id !== bridgePlaceId) {
    fail(
      `player is in ${roomName(player.current_place_id)} ` +
        `(#${player.current_place_id}) but should be in the Bridge ` +
        `(${roomName(bridgePlaceId)} #${bridgePlaceId})`,
    )
  }

  // 3. An active scene exists.
  if (!activeScene) {
    fail('no active scene exists')
  }

  // 4. The world cursor points at the active scene.
  if (cursor.current_scene_id !== activeScene.id) {
    fail(
      `world current_scene_id is ${cursor.current_scene_id} but the active ` +
        `scene is #${activeScene.id}`,
    )
  }
  if (result.sceneId !== activeScene.id) {
    fail(
      `result reported sceneId ${result.sceneId} but the active scene is ` +
        `#${activeScene.id}`,
    )
  }

  // 5. At least 3 crew (non-player) exist.
  if (crew.length < 3) {
    fail(`expected >= 3 crew, found ${crew.length}`)
  }

  // 6. The sim set world_time.
  if (cursor.world_time == null) {
    fail('world_time was not set by the sim')
  }

  console.log('')
  console.log(`OK: created a playable starship (world #${worldId})`)
}

main().catch((err) => {
  console.error('[create-starship] failed:', err)
  process.exit(1)
})

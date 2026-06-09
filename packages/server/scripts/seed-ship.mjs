#!/usr/bin/env node
// Offline proof for starship P1 (the seed pipeline). Builds the SQLite container
// against a throwaway temp DB, runs the SeedBoundedWorld use case with the
// deterministic StubCrewGenerator swapped in for the real Grok adapter (so it is
// free + reproducible + needs no API key), then reads the seeded world back
// through the repos and prints the ship, its rooms, the connectivity graph, the
// crew, and the relationship graph. It asserts the deck graph is connected and
// that crew count is in the authored 3–5 band, exiting non-zero on any failure.
//
// Run with the repo's tsx runner + the react-server condition (so the
// `server-only` markers on the adapters resolve to a no-op), exactly like the
// other TS scripts:
//
//   npx tsx --conditions=react-server --tsconfig packages/server/tsconfig.json \
//     packages/server/scripts/seed-ship.mjs
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
const tmpDir = mkdtempSync(path.join(tmpdir(), 'chronicles-seed-ship-'))
process.env.DATABASE_PATH = path.join(tmpDir, 'seed-ship.sqlite')
process.env.PERSISTENCE = 'sqlite'

const { getContainer } = await import('@/composition/container')
const { seedBoundedWorld } = await import(
  '@/application/use-cases/seed-bounded-world'
)
const { StubCrewGenerator } = await import(
  '@/infrastructure/world-gen/stub-crew-generator'
)
const { SCOUT_TEMPLATE_ID } = await import(
  '@/infrastructure/world-gen/scout-template'
)

async function main() {
  const c = getContainer()
  console.log(`[seed-ship] temp DB: ${process.env.DATABASE_PATH}`)

  // Build the use-case deps from the container, but swap in the deterministic
  // stub crew generator so the run is free + reproducible.
  const deps = {
    decks: c.decks,
    crew: new StubCrewGenerator(),
    worlds: c.worlds,
    places: c.places,
    placeConnections: c.placeConnections,
    characters: c.characters,
    relationships: c.relationships,
    clock: c.clock,
  }

  const result = await seedBoundedWorld(
    {
      templateId: SCOUT_TEMPLATE_ID,
      name: 'EMS Wayfarer',
      premise:
        'A lone scout vessel runs a long, quiet survey arc through an unmapped fringe; the crew has been alone with each other for far too long.',
    },
    deps,
  )

  // Read everything back through the repos.
  const worldId = result.worldId
  const world = await c.worlds.getWorld(worldId)
  const places = await c.places.forWorld(worldId)
  const connections = await c.placeConnections.forWorld(worldId)
  const crew = await c.characters.forWorld(worldId)
  const relationships = await c.relationships.forWorld(worldId)

  const placeById = new Map(places.map((p) => [p.id, p]))
  const charById = new Map(crew.map((ch) => [ch.id, ch]))
  const roomName = (id) => (id == null ? '(none)' : placeById.get(id)?.name ?? `#${id}`)

  console.log('')
  console.log(`SHIP: world #${worldId} "${world?.name}"`)
  console.log(`  spatial_mode=${world?.spatial_mode} template_id=${world?.template_id}`)

  console.log('')
  console.log(`ROOMS (${places.length}):`)
  for (const p of places) {
    console.log(`  #${p.id} ${p.name} [deck=${p.deck ?? '-'}]`)
  }

  console.log('')
  console.log(`CONNECTIONS (${connections.length}):`)
  for (const e of connections) {
    const arrow = e.bidirectional ? '<->' : '-->'
    console.log(
      `  ${roomName(e.from_place_id)} ${arrow} ${roomName(e.to_place_id)} (${e.kind ?? 'link'})`,
    )
  }

  console.log('')
  console.log(`CREW (${crew.length}):`)
  for (const ch of crew) {
    const loop = ch.daily_loop ? safeParse(ch.daily_loop) : null
    const loopStr = loop
      ? Object.entries(loop)
          .map(([band, v]) => `${band}=${roomName(v.place_id)}`)
          .join(', ')
      : '(no loop)'
    console.log(
      `  #${ch.id} ${ch.name} — goal: ${ch.active_goal ?? '-'}`,
    )
    console.log(`        home room: ${roomName(ch.current_place_id)}`)
    console.log(`        daily loop: ${loopStr}`)
  }

  console.log('')
  console.log(`RELATIONSHIPS (${relationships.length}):`)
  for (const r of relationships) {
    console.log(
      `  ${charById.get(r.from_character_id)?.name ?? '?'} -> ` +
        `${charById.get(r.to_character_id)?.name ?? '?'}: ` +
        `${r.kind ?? 'rel'} (valence ${r.valence})`,
    )
  }

  // Assertions — the P1 proof. seedBoundedWorld already throws on a disconnected
  // topology; re-check connectivity over the read-back rows + the crew bound here.
  const placeIds = places.map((p) => p.id)
  const adjacency = new Map(placeIds.map((id) => [id, new Set()]))
  for (const e of connections) {
    adjacency.get(e.from_place_id)?.add(e.to_place_id)
    if (e.bidirectional) adjacency.get(e.to_place_id)?.add(e.from_place_id)
  }
  const reachable = new Set()
  const stack = placeIds.length ? [placeIds[0]] : []
  while (stack.length) {
    const node = stack.pop()
    if (reachable.has(node)) continue
    reachable.add(node)
    for (const next of adjacency.get(node) ?? []) stack.push(next)
  }
  const connected = reachable.size === placeIds.length && placeIds.length > 0
  if (!connected) {
    console.error(
      `FAIL: deck graph is NOT connected — reached ${reachable.size}/${placeIds.length} rooms`,
    )
    process.exit(1)
  }
  if (crew.length < 3 || crew.length > 5) {
    console.error(`FAIL: crew count ${crew.length} is outside the 3-5 band`)
    process.exit(1)
  }

  console.log('')
  console.log(`OK: seeded a connected ship with ${crew.length} crew`)
}

function safeParse(json) {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

main().catch((err) => {
  console.error('[seed-ship] failed:', err)
  process.exit(1)
})

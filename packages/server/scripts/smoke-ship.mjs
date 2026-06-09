#!/usr/bin/env node
// LIVE smoke test for the starship pipeline — uses the REAL adapters (Grok crew
// generation + Haiku drama beats), unlike sim-ship.mjs which uses deterministic
// stubs. Spends a small amount of real API budget (1 Grok call + a handful of
// gated Haiku beats). Seeds a scout against a throwaway temp DB, prints the full
// Grok-generated crew/ship/room dressing, runs the forward sim with the real
// Haiku DramaPort, traces co-location per tick, and prints every beat's full
// text. It does NOT hard-fail on zero beats — beats only fire when the generated
// daily-loops put >=2 crew in the same room, so "no beats" is itself signal that
// the crew-dressing prompt needs a shared/communal band.
//
// Run (keys come from packages/server/.env.local via node --env-file):
//   npx tsx --conditions=react-server --tsconfig packages/server/tsconfig.json \
//     --env-file=packages/server/.env.local packages/server/scripts/smoke-ship.mjs

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const tmpDir = mkdtempSync(path.join(tmpdir(), 'chronicles-smoke-ship-'))
process.env.DATABASE_PATH = path.join(tmpDir, 'smoke-ship.sqlite')
process.env.PERSISTENCE = 'sqlite'

const { getContainer } = await import('@/composition/container')
const { seedBoundedWorld } = await import('@/application/use-cases/seed-bounded-world')
const { simulateWorldForward } = await import('@/application/use-cases/simulate-world-forward')
const { db } = await import('@/lib/db')
const { SCOUT_TEMPLATE_ID } = await import('@/infrastructure/world-gen/scout-template')

const TICKS = 16

function safeParse(json) {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

async function main() {
  if (!process.env.XAI_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error('MISSING KEYS: need XAI_API_KEY + ANTHROPIC_API_KEY (use --env-file=packages/server/.env.local)')
    process.exit(2)
  }
  const c = getContainer()
  console.log(`[smoke-ship] temp DB: ${process.env.DATABASE_PATH}`)
  console.log('[smoke-ship] calling Grok for crew/dressing… (1 live call)')

  const seedResult = await seedBoundedWorld(
    {
      templateId: SCOUT_TEMPLATE_ID,
      name: 'Scout (live smoke)',
      premise:
        'A lone scout vessel runs a long, quiet survey arc through an unmapped fringe; the crew has been alone with each other for far too long, and small frictions are starting to show.',
    },
    {
      decks: c.decks,
      crew: c.crewGenerator, // REAL Grok
      worlds: c.worlds,
      places: c.places,
      placeConnections: c.placeConnections,
      characters: c.characters,
      relationships: c.relationships,
      clock: c.clock,
    },
  )
  const worldId = seedResult.worldId

  const world = await c.worlds.getWorld(worldId)
  const places = await c.places.forWorld(worldId)
  const crew = await c.characters.forWorld(worldId)
  const relationships = await c.relationships.forWorld(worldId)
  const placeById = new Map(places.map((p) => [p.id, p]))
  const charById = new Map(crew.map((ch) => [ch.id, ch]))
  const roomName = (id) => (id == null ? '(none)' : placeById.get(id)?.name ?? `#${id}`)

  console.log('')
  console.log(`SHIP: "${safeParse(world?.initial_state_json)?.ship_name ?? world?.name}"`)
  console.log(`PREMISE: ${safeParse(world?.initial_state_json)?.premise ?? world?.premise}`)

  console.log('')
  console.log(`ROOMS (${places.length}) — Grok dressing:`)
  for (const p of places) {
    console.log(`  ${p.name} [deck=${p.deck ?? '?'}]: ${p.description}`)
  }

  console.log('')
  console.log(`CREW (${crew.filter((ch) => ch.is_player === 0).length}) — Grok generated:`)
  for (const ch of crew.filter((c2) => c2.is_player === 0)) {
    const loop = ch.daily_loop ? safeParse(ch.daily_loop) : null
    const loopStr = loop
      ? ['morning', 'midday', 'evening', 'night']
          .map((b) => `${b}=${roomName(loop[b]?.place_id)}`)
          .join(', ')
      : '(none)'
    console.log(`  ${ch.name} — role: ${ch.current_focus ?? '?'}`)
    console.log(`      persona: ${ch.description ?? ''}`)
    console.log(`      goal: ${ch.active_goal ?? ''}`)
    console.log(`      home: ${roomName(ch.current_place_id)} | loop: ${loopStr}`)
  }

  console.log('')
  console.log(`RELATIONSHIPS (${relationships.length}):`)
  for (const r of relationships) {
    console.log(
      `  ${charById.get(r.from_character_id)?.name ?? '?'} -> ` +
        `${charById.get(r.to_character_id)?.name ?? '?'}: ${r.kind ?? 'rel'} (valence ${r.valence})`,
    )
  }

  // Run the sim with the REAL Haiku DramaPort. cooldown/threshold tuned to let the
  // seeded relationships clear the gate when crew co-locate.
  console.log('')
  console.log(`[smoke-ship] running ${TICKS}-tick sim with live Haiku beats…`)
  const startValence = new Map(relationships.map((r) => [r.id, r.valence]))
  const simResult = await simulateWorldForward(
    { worldId, ticks: TICKS, cooldownTicks: 2, tensionThreshold: 0.25 },
    {
      characters: c.characters,
      placeConnections: c.placeConnections,
      relationships: c.relationships,
      worlds: c.worlds,
      places: c.places,
      drama: c.drama, // REAL Haiku
      timeline: c.timeline,
      clock: c.clock,
    },
  )

  const endCursor = await c.worlds.cursor(worldId)
  const endRels = await c.relationships.forWorld(worldId)

  const simBeats = db
    .prepare(
      `SELECT sim_tick, world_time, title, summary
         FROM timeline_events WHERE world_id = ? AND provenance = 'sim'
         ORDER BY sim_tick, id`,
    )
    .all(worldId)

  console.log('')
  console.log(`SIM RESULT: ${simResult.beats} beats over ${TICKS} ticks; clock -> ${endCursor.world_time}`)
  console.log('')
  console.log(`BEATS (${simBeats.length}) — Haiku generated:`)
  if (simBeats.length === 0) {
    console.log('  (none — the generated daily-loops never put >=2 crew in one room;')
    console.log('   signal that crew-dressing.md should schedule a shared/communal band)')
  }
  for (const b of simBeats) {
    console.log(`  tick ${b.sim_tick} [${b.world_time}] — ${b.title}`)
    console.log(`      ${b.summary}`)
  }

  console.log('')
  console.log('RELATIONSHIP DRIFT:')
  for (const r of endRels) {
    const before = startValence.get(r.id) ?? 0
    if (before !== r.valence) {
      console.log(
        `  ${charById.get(r.from_character_id)?.name ?? '?'} -> ` +
          `${charById.get(r.to_character_id)?.name ?? '?'}: ${before} -> ${r.valence}`,
      )
    }
  }

  console.log('')
  console.log(`OK: live smoke complete (world #${worldId}, ${crew.filter((ch) => ch.is_player === 0).length} crew, ${simBeats.length} beats).`)
}

main().catch((err) => {
  console.error('[smoke-ship] failed:', err)
  process.exit(1)
})

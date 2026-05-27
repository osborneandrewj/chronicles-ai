#!/usr/bin/env node
// One-shot: synthesize the narrator's opening move for a world that has no
// turns yet, persist it, and let subsequent player input pick up from there.
// Standalone mirror of src/lib/opening-turn.ts — calls Grok via @ai-sdk/xai,
// reads the on-disk narrator system prompt + premise + minimal state block,
// inserts the assistant turn into the DB. The archivist follow-up is skipped
// (the seed script has already populated canonical characters/places); the
// normal chat route will run the archivist on the next turn.
//
// Usage:
//   node /app/scripts/opening-turn.mjs --world 5
//
// Requires XAI_API_KEY in env (already set on Railway).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import Database from 'better-sqlite3'
import { xai } from '@ai-sdk/xai'
import { generateText } from 'ai'

const NARRATOR_MODEL = 'grok-4.3'
const OPENING_DIRECTIVE =
  "OPENING TURN: this world has no history yet. Make the narrator's first move per the " +
  '"Opening a new world" section of your system prompt. The player has not spoken; ' +
  'do not echo or pre-empt them.'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--world') args.world = Number(argv[++i])
    else if (argv[i] === '--prompts-dir') args.promptsDir = argv[++i]
  }
  return args
}

function loadNarratorPrompt(promptsDir) {
  // The compiled app on Railway lives at /app, so /app/prompts/* is canonical.
  // Fall back to ./prompts for local invocations.
  const candidates = [
    promptsDir && path.join(promptsDir, 'narrator-system.md'),
    '/app/prompts/narrator-system.md',
    path.join(process.cwd(), 'prompts', 'narrator-system.md'),
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf-8')
    } catch {
      // try next candidate
    }
  }
  throw new Error(`narrator-system.md not found in any of: ${candidates.join(', ')}`)
}

function openDb() {
  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'chronicles.sqlite')
  console.log(`[opening] opening ${dbPath}`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function readWorld(db, worldId) {
  const world = db
    .prepare('SELECT id, name, premise, world_time, current_scene_id, setting_region FROM worlds WHERE id = ?')
    .get(worldId)
  if (!world) throw new Error(`world ${worldId} not found`)
  const place = db
    .prepare(
      `SELECT p.id, p.name, p.description, p.osm_street, p.osm_neighborhood, p.geo_status
         FROM scenes s JOIN places p ON p.id = s.place_id
        WHERE s.id = ?`,
    )
    .get(world.current_scene_id)
  const player = db
    .prepare('SELECT name, description FROM characters WHERE world_id = ? AND is_player = 1')
    .get(worldId)
  const npcs = db
    .prepare(
      `SELECT name, description, relationship_to_player, personal_goals, last_known_situation
         FROM characters WHERE world_id = ? AND is_player = 0 ORDER BY id ASC`,
    )
    .all(worldId)
  return { world, place, player, npcs }
}

function formatStateBlock({ world, place, player, npcs }) {
  const lines = [
    '## STATE',
    'Listed facts are fixed. Unlisted small, genre-consistent details are open canvas.',
    `- Time: ${world.world_time ?? '(unset)'}`,
  ]
  if (place) {
    lines.push(`- Place: ${place.name}`)
    if (place.description) lines.push(`  ${place.description}`)
    if (place.geo_status === 'ok' && place.osm_street) {
      lines.push(`  - real-world geo: ${place.osm_street}${place.osm_neighborhood ? ' · ' + place.osm_neighborhood : ''}`)
    }
  }
  if (player) {
    lines.push('', '### Present')
    lines.push(`- ${player.name} (player)${player.description ? ' — ' + player.description : ''}`)
  }
  if (npcs && npcs.length > 0) {
    lines.push('', '### OFF-SCENE NPCs (tracked — do not contradict)')
    for (const n of npcs) {
      lines.push(`- ${n.name}${n.description ? ' — ' + n.description : ''}`)
      if (n.relationship_to_player) lines.push(`  - relationship: ${n.relationship_to_player}`)
      if (n.last_known_situation) lines.push(`  - situation: ${n.last_known_situation}`)
    }
  }
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.world) {
    console.error('usage: node opening-turn.mjs --world <id>')
    process.exit(1)
  }
  if (!process.env.XAI_API_KEY) {
    console.error('XAI_API_KEY required in env')
    process.exit(1)
  }

  const db = openDb()
  const ctx = readWorld(db, args.world)
  const existingTurns = db.prepare('SELECT COUNT(*) AS n FROM turns WHERE world_id = ?').get(args.world)
  if (existingTurns.n > 0) {
    console.error(`refusing to generate opening: world ${args.world} already has ${existingTurns.n} turn(s)`)
    db.close()
    process.exit(2)
  }

  const narratorBase = loadNarratorPrompt(args.promptsDir)
  const premiseBlock = ['## PREMISE', ctx.world.premise].join('\n')
  const stateBlock = formatStateBlock(ctx)
  const userMsg = `${premiseBlock}\n\n${stateBlock}\n\n${OPENING_DIRECTIVE}`

  console.log(`[opening] world #${ctx.world.id} "${ctx.world.name}"`)
  console.log(`[opening] place: ${ctx.place?.name ?? '(none)'} | npcs: ${ctx.npcs.length} | calling ${NARRATOR_MODEL}`)

  let text
  let usage
  try {
    const result = await generateText({
      model: xai(NARRATOR_MODEL),
      system: narratorBase,
      messages: [{ role: 'user', content: userMsg }],
    })
    text = result.text
    usage = result.usage
  } catch (err) {
    console.error('[opening] narrator generation failed:', err)
    db.close()
    process.exit(3)
  }

  const trimmed = text.trim()
  if (trimmed.length === 0) {
    console.error('[opening] narrator returned empty text')
    db.close()
    process.exit(4)
  }

  const turn = db
    .prepare(
      `INSERT INTO turns (world_id, role, content, scene_id, metadata)
       VALUES (?, 'assistant', ?, ?, ?) RETURNING id`,
    )
    .get(
      args.world,
      trimmed,
      ctx.world.current_scene_id,
      JSON.stringify({ narrator: { model: NARRATOR_MODEL, usage, opening: true } }),
    )

  console.log(`[opening] turn #${turn.id} inserted (${trimmed.length} chars)`)
  console.log('---')
  console.log(trimmed.slice(0, 600) + (trimmed.length > 600 ? '\n...[truncated]' : ''))
  db.close()
}

main()

#!/usr/bin/env node
// One-shot backfill for worlds.setting_region (added in migration 17).
//
// For each world whose setting_region is NULL, runs the same Haiku extractor
// the new-world action uses, then writes the result back. Worlds that the
// extractor flags as not real-world (fantasy, sci-fi, generic) stay NULL —
// the column is intentionally nullable for those cases.
//
// Usage:
//   node scripts/backfill-setting-region.mjs            # default DB path
//   DATABASE_PATH=/data/chronicles.sqlite node scripts/backfill-setting-region.mjs
//
// Requires ANTHROPIC_API_KEY in env. Pure prod deps — no tsx.

import path from 'node:path'
import process from 'node:process'

import Database from 'better-sqlite3'
import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'

const MODEL = 'claude-haiku-4-5-20251001'

const SettingRegionSchema = z.object({
  is_real_world: z
    .boolean()
    .describe(
      'True if the premise is set in a recognizable real-world location (real city, region, or country). ' +
        'False for fantasy worlds, sci-fi planets, or generic/unspecified settings.',
    ),
  region: z
    .string()
    .nullable()
    .describe(
      'A Nominatim-style region anchor: "City, State/Province, Country" or "City, Country". ' +
        'For example "Hayden, Idaho, USA" or "Mevagissey, Cornwall, United Kingdom". ' +
        'Return null when is_real_world is false, or when the premise does not name a specific real place.',
    ),
})

async function extractSettingRegion(premise, initialLocation) {
  try {
    const { object } = await generateObject({
      model: anthropic(MODEL),
      schema: SettingRegionSchema,
      system:
        'You extract the real-world geographic setting from an interactive-novel premise. ' +
          'Your output biases a Nominatim geocoder, so prefer canonical place names ' +
          '("Coeur d\'Alene, Idaho, USA", not "CDA"). When the setting is fantasy, ' +
          'science fiction, or unspecified, return is_real_world=false and region=null.',
      prompt: [
        'PREMISE:',
        premise,
        '',
        initialLocation ? `INITIAL LOCATION HINT:\n${initialLocation}` : 'INITIAL LOCATION HINT: (none)',
      ].join('\n'),
    })
    if (!object.is_real_world) return null
    const region = object.region?.trim()
    return region && region.length > 0 ? region : null
  } catch (err) {
    console.error('[region extractor failed]', err)
    return null
  }
}

function getInitialLocation(initialStateJson) {
  if (!initialStateJson) return null
  try {
    const parsed = JSON.parse(initialStateJson)
    return typeof parsed?.location === 'string' ? parsed.location : null
  } catch {
    return null
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is required.')
    process.exit(1)
  }

  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'chronicles.sqlite')
  console.log(`[backfill] opening ${dbPath}`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const rows = db
    .prepare(
      `SELECT id, name, premise, initial_state_json
         FROM worlds
        WHERE setting_region IS NULL
        ORDER BY id ASC`,
    )
    .all()

  if (rows.length === 0) {
    console.log('[backfill] nothing to do — all worlds already have setting_region')
    db.close()
    return
  }

  console.log(`[backfill] ${rows.length} world(s) need a region`)

  const updateStmt = db.prepare('UPDATE worlds SET setting_region = ? WHERE id = ?')
  let resolved = 0
  let nullified = 0
  for (const row of rows) {
    const initialLocation = getInitialLocation(row.initial_state_json)
    const region = await extractSettingRegion(row.premise, initialLocation)
    if (region) {
      updateStmt.run(region, row.id)
      console.log(`  ✓ world ${row.id} (${row.name}) → ${region}`)
      resolved += 1
    } else {
      console.log(`  · world ${row.id} (${row.name}) → not a real-world setting (left NULL)`)
      nullified += 1
    }
  }

  db.close()
  console.log(`[backfill] done — ${resolved} resolved, ${nullified} left NULL`)
}

main().catch((err) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})

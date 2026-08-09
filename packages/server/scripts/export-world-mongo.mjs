#!/usr/bin/env node
// Export a single world (with its full play history) out of a chronicles
// MongoDB database into one EJSON file. The Mongo sibling of copy-world.mjs's
// `export` mode.
//
// Collections are discovered at runtime rather than hardcoded: every collection
// holding at least one doc with `worldId === <id>` is included, plus the
// `worlds` doc itself. That keeps the export correct across schema drift.
//
// Read-only — it opens no write connections and never touches the source DB.
//
// Usage:
//   node scripts/export-world-mongo.mjs --name "Cluster Psi-1" --out world.json
//   node scripts/export-world-mongo.mjs --id 7 --out world.json
//
// Connection string comes from DATABASE_URL. To dump the production world
// without ever handling the secret locally, run it under Railway:
//   railway run node packages/server/scripts/export-world-mongo.mjs --name "..." --out ...
//
// tts_audio_cache is skipped — a regenerable TTS cache, not story state.

import { writeFileSync } from 'node:fs'
import process from 'node:process'

import { EJSON } from 'bson'
import { MongoClient } from 'mongodb'

const SKIP_COLLECTIONS = new Set(['tts_audio_cache', 'counters'])

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k.startsWith('--')) args[k.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]
  }
  return args
}

async function resolveWorld(db, a) {
  if (a.id) {
    const world = await db.collection('worlds').findOne({ id: Number(a.id) })
    if (!world) throw new Error(`no world with id ${a.id}`)
    return world
  }
  const matches = await db.collection('worlds').find({ name: a.name }).toArray()
  if (!matches.length) {
    const all = await db.collection('worlds').find({}, { projection: { id: 1, name: 1 } }).toArray()
    throw new Error(
      `no world named "${a.name}". Worlds present: ${all.map((w) => `#${w.id} ${w.name}`).join(', ') || '(none)'}`,
    )
  }
  if (matches.length > 1) {
    throw new Error(`"${a.name}" is ambiguous: ${matches.map((w) => `#${w.id}`).join(', ')}. Re-run with --id.`)
  }
  return matches[0]
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  if ((!a.name && !a.id) || !a.out) {
    console.error('usage: export-world-mongo.mjs (--name <name> | --id <id>) --out <file>')
    process.exit(1)
  }
  const uri = process.env.DATABASE_URL
  if (!uri) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const client = new MongoClient(uri)
  await client.connect()
  try {
    const db = client.db()
    const world = await resolveWorld(db, a)

    const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .filter((n) => !SKIP_COLLECTIONS.has(n) && n !== 'worlds')
      .sort()

    const data = { worlds: [world] }
    let total = 1
    for (const name of collections) {
      const rows = await db.collection(name).find({ worldId: world.id }).toArray()
      if (!rows.length) continue
      data[name] = rows
      total += rows.length
    }

    const payload = {
      exportedFromDb: db.databaseName,
      sourceWorldId: world.id,
      sourceWorldName: world.name,
      collections: data,
    }
    writeFileSync(a.out, EJSON.stringify(payload, { relaxed: false }))

    console.log(`[export] world #${world.id} "${world.name}" (db ${db.databaseName}) -> ${a.out}`)
    for (const [name, rows] of Object.entries(data)) console.log(`  ${name}: ${rows.length}`)
    console.log(`  total docs: ${total}`)
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error(`[export] failed: ${err.message}`)
  process.exit(1)
})

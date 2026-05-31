// scripts/repair-world-12-cleanup.mjs
// Usage:
//   node scripts/repair-world-12-cleanup.mjs --db /path/to/chronicles.sqlite --dry-run
//   node scripts/repair-world-12-cleanup.mjs --db /path/to/chronicles.sqlite --apply
//
// Deterministic repair of world 12 ("Joe Gallic Wars"):
//   1. Dedup Joseph's near-duplicate strip-the-scout memorable_facts.
//   2. Scrub "kilometer marker" -> era-neutral phrasing in stored facts.
// Touches only `characters` rows. Does NOT modify immutable `turns` prose.
import Database from 'better-sqlite3'

const args = process.argv.slice(2)
const dbPath = args[args.indexOf('--db') + 1]
const apply = args.includes('--apply')
if (!dbPath || args.indexOf('--db') === -1) {
  console.error('Missing --db <path>')
  process.exit(1)
}

const db = new Database(dbPath, { readonly: !apply })
const WORLD_ID = 12

const chars = db
  .prepare('SELECT id, name, memorable_facts FROM characters WHERE world_id = ?')
  .all(WORLD_ID)

function scrubKilometer(text) {
  return text.replace(/\bkilometer marker\b/gi, 'roadside marker')
}

function dedupStripFacts(text) {
  // Remove the redundant second "stripped the scout's pouch/torc" line, keeping
  // the first. The pattern is anchored on the STRIP verb so it does not also
  // catch the distinct map-discovery / show-Marcus facts, which merely mention
  // "the dead scout's pouch" without being a strip action.
  const lines = text.split('\n')
  let seenStrip = false
  const kept = []
  for (const line of lines) {
    const isStrip = /\bstrip(?:ped|s)?\b.*\b(?:pouch|torc)\b/i.test(line)
    if (isStrip) {
      if (seenStrip) continue
      seenStrip = true
    }
    kept.push(line)
  }
  return kept.join('\n')
}

const update = db.prepare('UPDATE characters SET memorable_facts = ? WHERE id = ?')
for (const c of chars) {
  if (!c.memorable_facts) continue
  const next = dedupStripFacts(scrubKilometer(c.memorable_facts))
  if (next === c.memorable_facts) continue
  console.log(`\n--- ${c.name} (#${c.id}) BEFORE:\n${c.memorable_facts}`)
  console.log(`--- AFTER:\n${next}`)
  if (apply) update.run(next, c.id)
}
console.log(apply ? '\nAPPLIED.' : '\nDRY RUN — no writes. Re-run with --apply.')

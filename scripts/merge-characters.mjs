#!/usr/bin/env node
// One-shot character-deduplication helper. Merges one or more duplicate
// character rows into a single canonical row using the same field-precedence
// rules as the archivist's runtime mergeCharacters() (line-block fields are
// concatenated and deduped; freshest scalars win; status escalates;
// appearance/last-seen counters take the maximum; the duplicate's display
// name becomes an alias on the canonical row).
//
// Usage:
//   node scripts/merge-characters.mjs --world <id> --canonical <id> --dupe <id> [--dupe <id>...]
//   node scripts/merge-characters.mjs --list-world <id>     # show characters with id/name/aliases
//   node scripts/merge-characters.mjs --dry-run --world <id> --canonical <id> --dupe <id>
//
// Run locally with `set -a; source .env.local; set +a; node scripts/...`
// or on Railway with `railway ssh -- node /app/scripts/...`.

import path from 'node:path'
import process from 'node:process'

import Database from 'better-sqlite3'

function parseArgs(argv) {
  const args = { world: null, canonical: null, dupes: [], list: null, dryRun: false, detect: null }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--world') args.world = Number(argv[++i])
    else if (k === '--canonical') args.canonical = Number(argv[++i])
    else if (k === '--dupe') args.dupes.push(Number(argv[++i]))
    else if (k === '--list-world') args.list = Number(argv[++i])
    else if (k === '--dry-run') args.dryRun = true
    else if (k === '--detect') args.detect = Number(argv[++i])
  }
  return args
}

function openDb() {
  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'chronicles.sqlite')
  console.log(`[merge] opening ${dbPath}`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function listWorld(worldId) {
  const db = openDb()
  const rows = db
    .prepare(
      `SELECT id, name, aliases, status, agency_level, appearance_count, last_seen_turn_id, updated_at
         FROM characters WHERE world_id = ? ORDER BY id ASC`,
    )
    .all(worldId)
  console.log(`[merge] ${rows.length} characters in world ${worldId}`)
  for (const r of rows) {
    const aliasLine = r.aliases ? ` aliases=[${r.aliases.replace(/\n/g, ' | ')}]` : ''
    console.log(
      `  #${String(r.id).padStart(4)} ${r.name}  [${r.agency_level}/${r.status}] ` +
        `seen=${r.appearance_count} last_seen=${r.last_seen_turn_id ?? '-'}${aliasLine}`,
    )
  }
  db.close()
}

const LINE_BLOCK_FIELDS = [
  'memorable_facts',
  'observations',
  'personal_goals',
  'recent_activity',
  'private_beliefs',
  'reveries',
  'long_term_agenda',
  'tool_access',
  'player_notes',
  'aliases',
]

const FRESHEST_FIELDS = [
  'description',
  'current_place_id',
  'active_goal',
  'current_attitude',
  'current_focus',
  'relationship_to_player',
  'in_transit_to_place_id',
  'arrival_world_time',
  'last_known_situation',
]

const STATUS_RANK = { active: 2, inactive: 1, dead: 3 }
const AGENCY_RANK = { npc: 0, dormant: 1, distant: 2, nearby: 3, local: 4, agent: 5 }

function mergeLineBlocks(a, b) {
  const lines = [...(a?.split('\n') ?? []), ...(b?.split('\n') ?? [])]
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return null
  const seen = new Set()
  const out = []
  for (const l of lines) {
    const key = l.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(l)
  }
  return out.join('\n')
}

function freshest(target, source, key) {
  const t = target[key]
  const s = source[key]
  if (t === null || t === undefined) return s ?? null
  if (s === null || s === undefined) return t
  return source.updated_at > target.updated_at ? s : t
}

function canonicalKey(s) {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|a|an|of|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function filterAliasesAgainstName(raw, name) {
  if (!raw) return null
  const nameKey = canonicalKey(name)
  const seen = new Set()
  const out = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const key = canonicalKey(trimmed)
    if (!key || key === nameKey) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out.length > 0 ? out.join('\n') : null
}

// Mirror of src/lib/character-identity.ts + src/lib/character-dedup.ts. Keep in
// sync with those if the rules change. NOTE: the name-key (near-identical-name)
// rule is intentionally omitted here — the two rules below are sufficient for
// CLI use.
const ARTICLE_RE = /^(the|a|an)\s+/i
const isDescriptorName = (name) => ARTICLE_RE.test((name ?? '').trim())
const FACT_MIN_LEN = 25
function distinctiveLines(text) {
  if (!text) return new Set()
  return new Set(
    text
      .split('\n')
      .map((l) => l.replace(/\s*\[t:\d+\]\s*$/, '').trim().toLowerCase())
      .filter((l) => l.length >= FACT_MIN_LEN),
  )
}
function detectWorld(worldId) {
  const db = openDb()
  const chars = db
    .prepare(
      `SELECT id, name, is_player, current_place_id, status, memorable_facts, observations
         FROM characters WHERE world_id = ? AND is_player = 0 AND status != 'dead' ORDER BY id`,
    )
    .all(worldId)
  const pairs = []
  for (let i = 0; i < chars.length; i++) {
    for (let j = i + 1; j < chars.length; j++) {
      const a = chars[i], b = chars[j]
      let reason = null
      if (a.current_place_id != null && a.current_place_id === b.current_place_id &&
          isDescriptorName(a.name) !== isDescriptorName(b.name)) {
        reason = 'descriptor + named at same place'
      }
      if (!reason) {
        const al = new Set([...distinctiveLines(a.memorable_facts), ...distinctiveLines(a.observations)])
        const bl = new Set([...distinctiveLines(b.memorable_facts), ...distinctiveLines(b.observations)])
        for (const l of al) { if (bl.has(l)) { reason = 'shared memorable fact'; break } }
      }
      if (reason) pairs.push({ a, b, reason })
    }
  }
  console.log(`[detect] ${pairs.length} candidate pair(s) in world ${worldId}`)
  for (const { a, b, reason } of pairs) {
    console.log(`  #${a.id} "${a.name}" ~ #${b.id} "${b.name}" — ${reason}`)
    console.log(`    node scripts/merge-characters.mjs --world ${worldId} --canonical ${b.id} --dupe ${a.id}`)
  }
  db.close()
}

function mergeOne(db, worldId, canonicalId, dupeId, dryRun) {
  const canonical = db
    .prepare(`SELECT * FROM characters WHERE id = ? AND world_id = ?`)
    .get(canonicalId, worldId)
  const dupe = db
    .prepare(`SELECT * FROM characters WHERE id = ? AND world_id = ?`)
    .get(dupeId, worldId)
  if (!canonical) throw new Error(`canonical id=${canonicalId} not found in world ${worldId}`)
  if (!dupe) throw new Error(`dupe id=${dupeId} not found in world ${worldId}`)
  if (canonical.id === dupe.id) throw new Error('canonical and dupe ids are identical')
  if (canonical.is_player !== dupe.is_player) {
    throw new Error('refusing to merge across the player/NPC boundary')
  }

  const merged = { ...canonical }
  for (const f of LINE_BLOCK_FIELDS) {
    merged[f] = mergeLineBlocks(canonical[f], dupe[f])
  }
  for (const f of FRESHEST_FIELDS) {
    merged[f] = freshest(canonical, dupe, f)
  }
  merged.status =
    (STATUS_RANK[dupe.status] ?? 0) > (STATUS_RANK[canonical.status] ?? 0)
      ? dupe.status
      : canonical.status
  merged.agency_level =
    (AGENCY_RANK[dupe.agency_level] ?? 0) > (AGENCY_RANK[canonical.agency_level] ?? 0)
      ? dupe.agency_level
      : canonical.agency_level
  merged.appearance_count = Math.max(canonical.appearance_count ?? 0, dupe.appearance_count ?? 0)
  merged.last_seen_turn_id =
    Math.max(canonical.last_seen_turn_id ?? 0, dupe.last_seen_turn_id ?? 0) || null
  merged.last_agent_tick_turn_id =
    Math.max(canonical.last_agent_tick_turn_id ?? 0, dupe.last_agent_tick_turn_id ?? 0) || null

  // Adopt the dupe's display name as an alias on the canonical row, then
  // dedupe and strip any line equal to the canonical name.
  const aliasesAfterAdopt = mergeLineBlocks(merged.aliases, dupe.name)
  merged.aliases = filterAliasesAgainstName(aliasesAfterAdopt, canonical.name)

  console.log(`[merge] canonical #${canonical.id} (${canonical.name}) ← dupe #${dupe.id} (${dupe.name})`)
  console.log(`  appearance_count: ${canonical.appearance_count} + ${dupe.appearance_count} → ${merged.appearance_count}`)
  console.log(`  aliases: ${merged.aliases ?? '(none)'}`)
  if (dryRun) {
    console.log('  --dry-run: not writing')
    return
  }

  const tx = db.transaction(() => {
    // Rewire resources owned by the dupe so they don't get orphaned by the FK
    // ON DELETE SET NULL.
    db.prepare(
      'UPDATE story_resources SET owner_character_id = ? WHERE owner_character_id = ?',
    ).run(canonical.id, dupe.id)

    db.prepare('DELETE FROM characters WHERE id = ?').run(dupe.id)
    db.prepare(
      `UPDATE characters SET
         description             = ?,
         current_place_id        = ?,
         memorable_facts         = ?,
         status                  = ?,
         active_goal             = ?,
         current_attitude        = ?,
         observations            = ?,
         agency_level            = ?,
         personal_goals          = ?,
         current_focus           = ?,
         recent_activity         = ?,
         private_beliefs         = ?,
         reveries                = ?,
         relationship_to_player  = ?,
         long_term_agenda        = ?,
         tool_access             = ?,
         appearance_count        = ?,
         last_seen_turn_id       = ?,
         last_agent_tick_turn_id = ?,
         player_notes            = ?,
         in_transit_to_place_id  = ?,
         arrival_world_time      = ?,
         last_known_situation    = ?,
         aliases                 = ?,
         updated_at              = datetime('now')
       WHERE id = ?`,
    ).run(
      merged.description ?? null,
      merged.current_place_id ?? null,
      merged.memorable_facts ?? null,
      merged.status,
      merged.active_goal ?? null,
      merged.current_attitude ?? null,
      merged.observations ?? null,
      merged.agency_level,
      merged.personal_goals ?? null,
      merged.current_focus ?? null,
      merged.recent_activity ?? null,
      merged.private_beliefs ?? null,
      merged.reveries ?? null,
      merged.relationship_to_player ?? null,
      merged.long_term_agenda ?? null,
      merged.tool_access ?? null,
      merged.appearance_count,
      merged.last_seen_turn_id ?? null,
      merged.last_agent_tick_turn_id ?? null,
      merged.player_notes ?? null,
      merged.in_transit_to_place_id ?? null,
      merged.arrival_world_time ?? null,
      merged.last_known_situation ?? null,
      merged.aliases ?? null,
      canonical.id,
    )
  })
  tx()
  console.log('  ✓ merged')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.list !== null) {
    listWorld(args.list)
    return
  }
  if (args.detect !== null) {
    detectWorld(args.detect)
    return
  }
  if (args.world === null || args.canonical === null || args.dupes.length === 0) {
    console.error('Usage:')
    console.error('  --list-world <id>')
    console.error('  --world <id> --canonical <id> --dupe <id> [--dupe <id>...] [--dry-run]')
    process.exit(1)
  }
  const db = openDb()
  try {
    for (const d of args.dupes) {
      mergeOne(db, args.world, args.canonical, d, args.dryRun)
    }
  } finally {
    db.close()
  }
}

main()

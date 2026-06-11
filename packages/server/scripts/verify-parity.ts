// scripts/verify-parity.ts  (P3 — spec §4.9 step 6, §5.1-P3)
//
// Dual-READ verification after migrate-sqlite-to-mongo.ts. Opens BOTH stores
// read-only and asserts:
//   - per-collection document/row counts match
//   - turn id/seq continuity (no gaps introduced) + MAX(seq) parity
//   - a sampled deep-equal on N random turns AND N random characters
//   - a full per-world state assembly (the getFullWorldState shape) matches
//     when assembled from each store
// Prints a PASS/FAIL summary with the first mismatches and exits non-zero on
// any diff. N is configurable: VERIFY_SAMPLE_N env or first CLI arg (default 25).
//
//   DATABASE_PATH=./backups/chronicles.copy.sqlite \
//   DATABASE_URL='mongodb://localhost:27017/chronicles?replicaSet=rs0' \
//   VERIFY_SAMPLE_N=50 \
//   npx tsx --conditions=react-server packages/server/scripts/verify-parity.ts
//
// DO NOT run against prod without a fresh backup (CLAUDE.md rule); run against a
// copy. This script never writes — it is read-only on both stores. (The migrate
// script already ran createIndexes after insert.)

import Database from 'better-sqlite3'

import { connectMongo } from '@/infrastructure/persistence/mongo/connection'
import { buildModels, type MongoModels } from '@/infrastructure/persistence/mongo/models'

type Row = Record<string, unknown>

const COLLECTION_TABLE_PAIRS: Array<{ table: string; model: keyof MongoModels }> = [
  { table: 'worlds', model: 'World' },
  { table: 'turns', model: 'Turn' },
  { table: 'characters', model: 'Character' },
  { table: 'places', model: 'Place' },
  { table: 'scenes', model: 'Scene' },
  { table: 'npc_reveries', model: 'Reverie' },
  { table: 'npc_intents', model: 'NpcIntent' },
  { table: 'story_threads', model: 'StoryThread' },
  { table: 'story_clues', model: 'StoryClue' },
  { table: 'story_objectives', model: 'StoryObjective' },
  { table: 'story_resources', model: 'StoryResource' },
  { table: 'timeline_events', model: 'TimelineEvent' },
  { table: 'population_templates', model: 'PopulationTemplate' },
  { table: 'place_occupancy_snapshots', model: 'OccupancySnapshot' },
  { table: 'tts_audio_cache', model: 'TtsAudioCache' },
  { table: 'world_corrections', model: 'WorldCorrection' },
]

const mismatches: string[] = []
function fail(msg: string): void {
  mismatches.push(msg)
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(name),
  )
}

function sqliteCount(sqlite: Database.Database, table: string): number {
  if (!tableExists(sqlite, table)) return 0
  const row = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  return row.c
}

/** Deterministic-ish sample of up to n integer ids from an ordered list. */
function sampleIds(ids: number[], n: number): number[] {
  if (ids.length <= n) return ids
  const step = Math.floor(ids.length / n)
  const out: number[] = []
  for (let i = 0; i < ids.length && out.length < n; i += step) out.push(ids[i])
  return out
}

/** Canonical comparable shape for a turn (store-agnostic). */
function normTurn(t: {
  seq: number
  worldId: number
  role: string
  content: string
  sceneId: number | null
}): Row {
  return { seq: t.seq, worldId: t.worldId, role: t.role, content: t.content, sceneId: t.sceneId }
}

/** Canonical comparable shape for a character (store-agnostic, no timestamps). */
function normCharacter(c: {
  id: number
  worldId: number
  name: string
  isPlayer: boolean
  currentPlaceId: number | null
  status: string
  agencyLevel: string
  memorableFacts: string | null
}): Row {
  return {
    id: c.id,
    worldId: c.worldId,
    name: c.name,
    isPlayer: c.isPlayer,
    currentPlaceId: c.currentPlaceId,
    status: c.status,
    agencyLevel: c.agencyLevel,
    memorableFacts: c.memorableFacts ?? null,
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function main(): Promise<void> {
  const databasePath = process.env.DATABASE_PATH
  const databaseUrl = process.env.DATABASE_URL
  if (!databasePath) throw new Error('DATABASE_PATH (SQLite copy) is required')
  if (!databaseUrl) throw new Error('DATABASE_URL (Mongo) is required')

  const sampleN = Number(process.env.VERIFY_SAMPLE_N ?? process.argv[2] ?? 25)

  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true })
  const connection = await connectMongo(databaseUrl)
  const models = buildModels(connection)

  // 1) per-collection counts (exact — the union of model types makes the
  //    method unhelpfully typed, so go through a minimal countable surface).
  const countable = models as unknown as Record<
    keyof MongoModels,
    { countDocuments(): { exec(): Promise<number> } }
  >
  for (const { table, model } of COLLECTION_TABLE_PAIRS) {
    const sqliteN = sqliteCount(sqlite, table)
    const mongoN = await countable[model].countDocuments().exec()
    if (sqliteN !== mongoN) {
      fail(`count[${table}]: sqlite=${sqliteN} mongo=${mongoN}`)
    }
  }

  // 2) turn id/seq continuity + MAX parity ---------------------------------
  const sqliteTurnIds = (
    sqlite.prepare('SELECT id FROM turns ORDER BY id').all() as Array<{ id: number }>
  ).map((r) => r.id)
  const mongoTurnSeqs = (
    await models.Turn.find({}, { seq: 1, _id: 0 }).sort({ seq: 1 }).lean().exec()
  ).map((d) => (d as { seq: number }).seq)

  if (!deepEqual(sqliteTurnIds, mongoTurnSeqs)) {
    fail(
      `turn seq continuity: sqlite ids and mongo seqs diverge ` +
        `(sqlite n=${sqliteTurnIds.length}, mongo n=${mongoTurnSeqs.length})`,
    )
  }
  const sqliteMax = sqliteTurnIds.length ? sqliteTurnIds[sqliteTurnIds.length - 1] : 0
  const mongoMax = mongoTurnSeqs.length ? mongoTurnSeqs[mongoTurnSeqs.length - 1] : 0
  if (sqliteMax !== mongoMax) fail(`MAX(seq): sqlite=${sqliteMax} mongo=${mongoMax}`)

  const counterDoc = (await models.Counter.findOne({ _id: 'turnSeq' }).lean().exec()) as
    | { value: number }
    | null
  if (counterDoc && counterDoc.value < sqliteMax) {
    fail(`counters.turnSeq=${counterDoc.value} < MAX(turns.id)=${sqliteMax}`)
  }

  // 3) sampled deep-equal on turns -----------------------------------------
  for (const id of sampleIds(sqliteTurnIds, sampleN)) {
    const s = sqlite.prepare('SELECT * FROM turns WHERE id = ?').get(id) as Row | undefined
    const m = (await models.Turn.findOne({ seq: id }).lean().exec()) as Row | null
    if (!s || !m) {
      fail(`turn[${id}]: missing in ${!s ? 'sqlite' : 'mongo'}`)
      continue
    }
    const sn = normTurn({
      seq: Number(s.id),
      worldId: Number(s.world_id),
      role: String(s.role),
      content: String(s.content),
      sceneId: s.scene_id == null ? null : Number(s.scene_id),
    })
    const mn = normTurn({
      seq: Number(m.seq),
      worldId: Number(m.worldId),
      role: String(m.role),
      content: String(m.content),
      sceneId: m.sceneId == null ? null : Number(m.sceneId),
    })
    if (!deepEqual(sn, mn)) fail(`turn[${id}] deep-equal: ${JSON.stringify({ sn, mn })}`)
  }

  // 4) sampled deep-equal on characters ------------------------------------
  const sqliteCharIds = (
    sqlite.prepare('SELECT id FROM characters ORDER BY id').all() as Array<{ id: number }>
  ).map((r) => r.id)
  for (const id of sampleIds(sqliteCharIds, sampleN)) {
    const s = sqlite.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row | undefined
    const m = (await models.Character.findOne({ id }).lean().exec()) as Row | null
    if (!s || !m) {
      fail(`character[${id}]: missing in ${!s ? 'sqlite' : 'mongo'}`)
      continue
    }
    const sn = normCharacter({
      id: Number(s.id),
      worldId: Number(s.world_id),
      name: String(s.name),
      isPlayer: Number(s.is_player) === 1,
      currentPlaceId: s.current_place_id == null ? null : Number(s.current_place_id),
      status: String(s.status),
      agencyLevel: String(s.agency_level),
      memorableFacts: s.memorable_facts == null ? null : String(s.memorable_facts),
    })
    const mn = normCharacter({
      id: Number(m.id),
      worldId: Number(m.worldId),
      name: String(m.name),
      isPlayer: Boolean(m.isPlayer),
      currentPlaceId: m.currentPlaceId == null ? null : Number(m.currentPlaceId),
      status: String(m.status),
      agencyLevel: String(m.agencyLevel),
      memorableFacts: m.memorableFacts == null ? null : String(m.memorableFacts),
    })
    if (!deepEqual(sn, mn)) fail(`character[${id}] deep-equal: ${JSON.stringify({ sn, mn })}`)
  }

  // 5) full per-world state assembly from BOTH stores must match -----------
  //    (the getFullWorldState shape: worldTime/currentSceneId + ordered ids of
  //    characters/places/scenes/threads). Assembled store-agnostically so a
  //    SQLite-bound getFullWorldState isn't needed against the Mongo store.
  const worldIds = (
    sqlite.prepare('SELECT id FROM worlds ORDER BY id').all() as Array<{ id: number }>
  ).map((r) => r.id)

  for (const worldId of worldIds) {
    const sqliteAssembly = assembleSqliteWorld(sqlite, worldId)
    const mongoAssembly = await assembleMongoWorld(models, worldId)
    if (!deepEqual(sqliteAssembly, mongoAssembly)) {
      fail(
        `worldState[${worldId}] mismatch: ` +
          `${JSON.stringify({ sqliteAssembly, mongoAssembly })}`,
      )
    }
  }

  sqlite.close()
  await connection.close()

  if (mismatches.length === 0) {
    console.log(`PARITY PASS — counts, seq continuity, ${sampleN} sampled turns/chars, ` +
      `and ${worldIds.length} world-state assemblies match.`)
    process.exit(0)
  } else {
    console.error(`PARITY FAIL — ${mismatches.length} mismatch(es):`)
    for (const m of mismatches.slice(0, 50)) console.error(`  - ${m}`)
    if (mismatches.length > 50) console.error(`  ...and ${mismatches.length - 50} more`)
    process.exit(1)
  }
}

type WorldAssembly = {
  worldId: number
  worldTime: string | null
  currentSceneId: number | null
  characterIds: number[]
  placeIds: number[]
  sceneIds: number[]
  threadIds: number[]
}

function assembleSqliteWorld(sqlite: Database.Database, worldId: number): WorldAssembly {
  const cursor = sqlite
    .prepare('SELECT world_time, current_scene_id FROM worlds WHERE id = ?')
    .get(worldId) as { world_time: string | null; current_scene_id: number | null } | undefined
  const ids = (table: string): number[] =>
    (
      sqlite
        .prepare(`SELECT id FROM ${table} WHERE world_id = ? ORDER BY id`)
        .all(worldId) as Array<{ id: number }>
    ).map((r) => r.id)
  return {
    worldId,
    worldTime: cursor?.world_time ?? null,
    currentSceneId: cursor?.current_scene_id ?? null,
    characterIds: ids('characters'),
    placeIds: ids('places'),
    sceneIds: ids('scenes'),
    threadIds: ids('story_threads'),
  }
}

async function assembleMongoWorld(
  models: MongoModels,
  worldId: number,
): Promise<WorldAssembly> {
  const world = (await models.World.findOne({ id: worldId }).lean().exec()) as
    | { worldTime: string | null; currentSceneId: number | null }
    | null
  // The union of model types makes `.find` unhelpfully typed; go through a
  // minimal findable surface that returns the `{ id }` projection.
  const findable = models as unknown as Record<
    keyof MongoModels,
    {
      find(
        filter: Record<string, unknown>,
        projection: Record<string, number>,
      ): {
        sort(s: Record<string, number>): {
          lean(): { exec(): Promise<Array<{ id: number }>> }
        }
      }
    }
  >
  const ids = async (model: keyof MongoModels): Promise<number[]> =>
    (
      await findable[model].find({ worldId }, { id: 1, _id: 0 }).sort({ id: 1 }).lean().exec()
    ).map((d) => d.id)
  return {
    worldId,
    worldTime: world?.worldTime ?? null,
    currentSceneId: world?.currentSceneId ?? null,
    characterIds: await ids('Character'),
    placeIds: await ids('Place'),
    sceneIds: await ids('Scene'),
    threadIds: await ids('StoryThread'),
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

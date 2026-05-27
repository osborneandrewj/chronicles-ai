import Database from 'better-sqlite3'
import path from 'node:path'

import { runMigrations } from '@/lib/migrations'
import type { Character, Place, Scene } from '@/lib/world-state'

export type TurnRole = 'user' | 'assistant'

export type Turn = {
  id: number
  world_id: number
  role: TurnRole
  content: string
  scene_id: number | null
  created_at: string
}

export type TurnTimestamp = { id: number; created_at: string }

export type StoryThread = {
  id: number
  world_id: number
  title: string
  kind: 'quest' | 'mystery' | 'threat' | 'relationship' | 'background'
  status: 'active' | 'resolved' | 'failed' | 'dormant'
  summary: string | null
  stakes: string | null
  rewards: string | null
  consequences: string | null
  hidden: string | null
  source_turn_id: number | null
  resolved_turn_id: number | null
  created_at: string
  updated_at: string
}

export type StoryClue = {
  id: number
  world_id: number
  thread_id: number | null
  thread_title: string | null
  title: string
  detail: string | null
  implication: string | null
  status: 'open' | 'interpreted' | 'spent' | 'false_lead'
  source_turn_id: number | null
  created_at: string
  updated_at: string
}

export type StoryObjective = {
  id: number
  world_id: number
  thread_id: number | null
  thread_title: string | null
  title: string
  status: 'active' | 'blocked' | 'completed' | 'failed'
  detail: string | null
  blocker: string | null
  source_turn_id: number | null
  completed_turn_id: number | null
  created_at: string
  updated_at: string
}

export type StoryResource = {
  id: number
  world_id: number
  owner_character_id: number | null
  owner_name: string | null
  name: string
  kind: string | null
  status: string | null
  detail: string | null
  source_turn_id: number | null
  created_at: string
  updated_at: string
}

export type TimelineEvent = {
  id: number
  world_id: number
  turn_id: number | null
  thread_id: number | null
  thread_title: string | null
  world_time: string | null
  title: string
  summary: string
  importance: number
  created_at: string
}

export type StoryDossier = {
  threads: StoryThread[]
  clues: StoryClue[]
  objectives: StoryObjective[]
  resources: StoryResource[]
  timeline: TimelineEvent[]
}

type Globals = typeof globalThis & { __chroniclesDb?: Database.Database }
const g = globalThis as Globals

function open(): Database.Database {
  // Next.js's "collect page data" build phase imports every page, which
  // transitively opens this DB. On a mounted volume that produces SQLITE_BUSY
  // when build workers race for the lock. Build workers get an in-memory DB
  // (fresh per worker, no file, no locking); only runtime touches the real file.
  // DATABASE_PATH points at the mounted volume in prod (Railway). Dev falls
  // back to cwd/chronicles.sqlite so local workflows are unchanged.
  const isBuild = process.env.NEXT_PHASE === 'phase-production-build'
  const dbPath = isBuild
    ? ':memory:'
    : (process.env.DATABASE_PATH ?? path.join(process.cwd(), 'chronicles.sqlite'))
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export const db: Database.Database = g.__chroniclesDb ?? (g.__chroniclesDb = open())

const insertStmt = db.prepare<[number, TurnRole, string, number | null]>(
  `INSERT INTO turns (world_id, role, content, scene_id)
   VALUES (?, ?, ?, ?)
   RETURNING id, world_id, role, content, scene_id, created_at`,
)
const allStmt = db.prepare<[number]>(
  `SELECT id, world_id, role, content, scene_id, created_at
   FROM turns WHERE world_id = ? ORDER BY id ASC`,
)
const recentStmt = db.prepare<[number, number]>(
  `SELECT id, role, content FROM turns
   WHERE world_id = ? ORDER BY id DESC LIMIT ?`,
)
const latestUserContentStmt = db.prepare<[number]>(
  `SELECT content FROM turns
   WHERE world_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1`,
)
const latestTurnStmt = db.prepare<[number]>(
  `SELECT id, world_id, role, content, scene_id, created_at
   FROM turns WHERE world_id = ? ORDER BY id DESC LIMIT 1`,
)
const latestAssistantAfterLatestUserStmt = db.prepare<[number, number]>(
  `WITH latest_user AS (
     SELECT id FROM turns WHERE world_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1
   )
   SELECT a.id, a.world_id, a.role, a.content, a.scene_id, a.created_at
   FROM turns a, latest_user u
   WHERE a.world_id = ? AND a.role = 'assistant' AND a.id > u.id
   ORDER BY a.id DESC LIMIT 1`,
)
const userTurnCountStmt = db.prepare<[number]>(
  `SELECT COUNT(*) AS n FROM turns WHERE world_id = ? AND role = 'user'`,
)
// json_patch merges the supplied object into existing metadata so concurrent
// writers (archivist, tts char recorder) don't clobber each other's keys.
const updateMetadataStmt = db.prepare<[string, number]>(
  `UPDATE turns SET metadata = json_patch(COALESCE(metadata, '{}'), ?) WHERE id = ?`,
)
// Additive: sums into the existing $.tts.chars rather than overwriting it, so
// replaying an old turn N times grows that turn's recorded char count by the
// total replayed instead of clobbering the original stream's value. The
// world_id + role guard prevents a request for world A from crediting a turn
// that actually belongs to world B (or to a 'user' turn within world A).
const addTtsCharsStmt = db.prepare<[number, number, number]>(
  `UPDATE turns
   SET metadata = json_set(
     COALESCE(metadata, '{}'),
     '$.tts.chars',
     COALESCE(json_extract(metadata, '$.tts.chars'), 0) + ?
   )
   WHERE id = ? AND world_id = ? AND role = 'assistant'`,
)
const getTtsAudioCacheStmt = db.prepare<[number, number, string, string, string]>(
  `SELECT id, content_type, audio, byte_length
   FROM tts_audio_cache
   WHERE world_id = ? AND turn_id = ? AND model_key = ? AND voice_id = ? AND text_hash = ?
   ORDER BY id DESC
   LIMIT 1`,
)
const touchTtsAudioCacheStmt = db.prepare<[number]>(
  `UPDATE tts_audio_cache SET accessed_at = datetime('now') WHERE id = ?`,
)
const upsertTtsAudioCacheStmt = db.prepare<
  [number, string, string, string, string, Buffer, number, number, number]
>(
  `INSERT INTO tts_audio_cache (
     world_id, turn_id, model_key, voice_id, text_hash, content_type, audio, byte_length,
     created_at, accessed_at
   )
   SELECT ?, t.id, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
   FROM turns t
   WHERE t.id = ? AND t.world_id = ? AND t.role = 'assistant'
   ON CONFLICT (world_id, turn_id, model_key, voice_id, text_hash) DO UPDATE SET
     content_type = excluded.content_type,
     audio = excluded.audio,
     byte_length = excluded.byte_length,
     accessed_at = datetime('now')`,
)
const pruneTtsAudioCacheStmt = db.prepare<[number, number, number]>(
  `DELETE FROM tts_audio_cache
   WHERE world_id = ?
     AND id NOT IN (
       SELECT id FROM tts_audio_cache
       WHERE world_id = ?
       ORDER BY accessed_at DESC, id DESC
       LIMIT ?
     )`,
)
// Includes both the old `extractor` key (pre-v0.5) and the new `archivist` key
// in the sum so cost totals stay continuous across the v5 cutover.
const usageTotalsStmt = db.prepare<[number]>(`
  SELECT
    COUNT(metadata)                                              AS turns,
    COALESCE(SUM(json_extract(metadata, '$.narrator.usage.inputTokens')),  0) AS narratorInput,
    COALESCE(SUM(json_extract(metadata, '$.narrator.usage.outputTokens')), 0) AS narratorOutput,
    COALESCE(SUM(json_extract(metadata, '$.archivist.usage.inputTokens')),  0)
      + COALESCE(SUM(json_extract(metadata, '$.extractor.usage.inputTokens')),  0) AS archivistInput,
    COALESCE(SUM(json_extract(metadata, '$.archivist.usage.outputTokens')), 0)
      + COALESCE(SUM(json_extract(metadata, '$.extractor.usage.outputTokens')), 0) AS archivistOutput,
    COALESCE(SUM(json_extract(metadata, '$.npc_agent.usage.inputTokens')),  0) AS npcAgentInput,
    COALESCE(SUM(json_extract(metadata, '$.npc_agent.usage.outputTokens')), 0) AS npcAgentOutput
  FROM turns
  WHERE world_id = ? AND metadata IS NOT NULL
`)

// World-state readers (v0.5; v0.6.1 adds active_goal + current_attitude;
// v0.6.2 adds observations + agentic-NPC fields).
const CHARACTER_COLS = `id, world_id, name, description, is_player, current_place_id,
        memorable_facts, status, active_goal, current_attitude, observations,
        agency_level, personal_goals, current_focus, recent_activity, appearance_count,
        last_seen_turn_id, last_agent_tick_turn_id, player_notes, created_at, updated_at`
const charactersForWorldStmt = db.prepare<[number]>(
  `SELECT ${CHARACTER_COLS}
   FROM characters WHERE world_id = ? ORDER BY is_player DESC, id ASC`,
)
const charactersInPlaceStmt = db.prepare<[number, number]>(
  `SELECT ${CHARACTER_COLS}
   FROM characters WHERE world_id = ? AND current_place_id = ? ORDER BY id ASC`,
)
const placesForWorldStmt = db.prepare<[number]>(
  `SELECT id, world_id, name, description, kind, player_notes, created_at, updated_at FROM places
   WHERE world_id = ? ORDER BY id ASC`,
)
const placeByIdStmt = db.prepare<[number]>(
  'SELECT id, world_id, name, description, kind, player_notes, created_at, updated_at FROM places WHERE id = ?',
)
const scenesForWorldStmt = db.prepare<[number]>(
  `SELECT id, world_id, place_id, title, summary, scene_number, status,
          opened_at_turn, closed_at_turn, created_at, updated_at
   FROM scenes WHERE world_id = ? ORDER BY scene_number ASC`,
)
const activeSceneStmt = db.prepare<[number]>(
  `SELECT id, world_id, place_id, title, summary, scene_number, status,
          opened_at_turn, closed_at_turn, created_at, updated_at
   FROM scenes WHERE world_id = ? AND status = 'active'
   ORDER BY scene_number DESC LIMIT 1`,
)
const worldCursorStmt = db.prepare<[number]>(
  'SELECT world_time, current_scene_id FROM worlds WHERE id = ?',
)
const latestMetadataStmt = db.prepare<[number]>(
  `SELECT id, metadata FROM turns
   WHERE world_id = ? AND metadata IS NOT NULL ORDER BY id DESC LIMIT 1`,
)
const assistantMetadataStmt = db.prepare<[number]>(
  `SELECT id, metadata FROM turns
   WHERE world_id = ? AND role = 'assistant' AND metadata IS NOT NULL ORDER BY id ASC`,
)
// History pagination (v0.6.1). Both queries fetch turns DESC by id then the
// caller reverses to oldest-first for render order. SQLite has no efficient
// way to express "the latest N rows in ASC order" without this dance.
const latestTurnsStmt = db.prepare<[number, number]>(
  `SELECT id, world_id, role, content, scene_id, created_at FROM turns
   WHERE world_id = ? ORDER BY id DESC LIMIT ?`,
)
const turnsBeforeStmt = db.prepare<[number, number, number]>(
  `SELECT id, world_id, role, content, scene_id, created_at FROM turns
   WHERE world_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
)
const assistantMetadataSinceStmt = db.prepare<[number, number]>(
  `SELECT id, metadata FROM turns
   WHERE world_id = ? AND id >= ? AND role = 'assistant' AND metadata IS NOT NULL
   ORDER BY id ASC`,
)
const assistantMetadataInRangeStmt = db.prepare<[number, number, number]>(
  `SELECT id, metadata FROM turns
   WHERE world_id = ? AND id >= ? AND id < ? AND role = 'assistant' AND metadata IS NOT NULL
   ORDER BY id ASC`,
)
// Cheapest way to find out if a "Load older" click would surface anything.
const hasTurnBeforeStmt = db.prepare<[number, number]>(
  `SELECT 1 FROM turns WHERE world_id = ? AND id < ? LIMIT 1`,
)
const turnTimestampsForWorldStmt = db.prepare<[number]>(
  `SELECT id, created_at FROM turns WHERE world_id = ? ORDER BY id ASC`,
)
const storyThreadsForWorldStmt = db.prepare<[number]>(
  `SELECT id, world_id, title, kind, status, summary, stakes, rewards, consequences,
          hidden, source_turn_id, resolved_turn_id, created_at, updated_at
   FROM story_threads
   WHERE world_id = ?
   ORDER BY
     CASE status WHEN 'active' THEN 0 WHEN 'dormant' THEN 1 ELSE 2 END,
     CASE kind WHEN 'quest' THEN 0 WHEN 'mystery' THEN 1 WHEN 'threat' THEN 2 ELSE 3 END,
     updated_at DESC,
     id DESC`,
)
const storyCluesForWorldStmt = db.prepare<[number]>(
  `SELECT c.id, c.world_id, c.thread_id, t.title AS thread_title, c.title, c.detail,
          c.implication, c.status, c.source_turn_id, c.created_at, c.updated_at
   FROM story_clues c
   LEFT JOIN story_threads t ON t.id = c.thread_id
   WHERE c.world_id = ?
   ORDER BY
     CASE c.status WHEN 'open' THEN 0 WHEN 'interpreted' THEN 1 WHEN 'spent' THEN 2 ELSE 3 END,
     c.updated_at DESC,
     c.id DESC`,
)
const storyObjectivesForWorldStmt = db.prepare<[number]>(
  `SELECT o.id, o.world_id, o.thread_id, t.title AS thread_title, o.title, o.status,
          o.detail, o.blocker, o.source_turn_id, o.completed_turn_id, o.created_at, o.updated_at
   FROM story_objectives o
   LEFT JOIN story_threads t ON t.id = o.thread_id
   WHERE o.world_id = ?
   ORDER BY
     CASE o.status WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
     o.updated_at DESC,
     o.id DESC`,
)
const storyResourcesForWorldStmt = db.prepare<[number]>(
  `SELECT r.id, r.world_id, r.owner_character_id, c.name AS owner_name, r.name, r.kind,
          r.status, r.detail, r.source_turn_id, r.created_at, r.updated_at
   FROM story_resources r
   LEFT JOIN characters c ON c.id = r.owner_character_id
   WHERE r.world_id = ?
   ORDER BY r.updated_at DESC, r.id DESC`,
)
const timelineEventsForWorldStmt = db.prepare<[number]>(
  `SELECT e.id, e.world_id, e.turn_id, e.thread_id, t.title AS thread_title, e.world_time,
          e.title, e.summary, e.importance, e.created_at
   FROM timeline_events e
   LEFT JOIN story_threads t ON t.id = e.thread_id
   WHERE e.world_id = ?
   ORDER BY e.id DESC
   LIMIT 12`,
)

const insertWorldCorrectionStmt = db.prepare<
  [number, number | null, string, string, string]
>(
  `INSERT INTO world_corrections (world_id, turn_id, player_text, archivist_reply, applied_patch)
   VALUES (?, ?, ?, ?, ?)
   RETURNING id, world_id, turn_id, player_text, archivist_reply, applied_patch, created_at`,
)
// Scrollback for the inspector's Archivist tab. DESC by id so the newest row
// is first; the UI reverses for chronological rendering. Bounded to keep
// payloads small — older corrections are still in the table, just not
// surfaced.
const worldCorrectionsForWorldStmt = db.prepare<[number, number]>(
  `SELECT id, world_id, turn_id, player_text, archivist_reply, applied_patch, created_at
   FROM world_corrections
   WHERE world_id = ?
   ORDER BY id DESC
   LIMIT ?`,
)

export function insertTurn(
  worldId: number,
  role: TurnRole,
  content: string,
  sceneId: number | null = null,
): Turn {
  return insertStmt.get(worldId, role, content, sceneId) as Turn
}

export function allTurns(worldId: number): Turn[] {
  return allStmt.all(worldId) as Turn[]
}

export function recentTurns(
  worldId: number,
  limit: number,
): Array<Pick<Turn, 'id' | 'role' | 'content'>> {
  const rows = recentStmt.all(worldId, limit) as Array<Pick<Turn, 'id' | 'role' | 'content'>>
  return rows.reverse()
}

// History pagination. latestTurns is the initial page-render slice; turnsBefore
// powers the "Load older" affordance. Both return oldest-to-newest so the
// caller can render or prepend without re-sorting.
export function latestTurns(worldId: number, limit: number): Turn[] {
  const rows = latestTurnsStmt.all(worldId, limit) as Turn[]
  return rows.reverse()
}

export function turnsBefore(worldId: number, beforeId: number, limit: number): Turn[] {
  const rows = turnsBeforeStmt.all(worldId, beforeId, limit) as Turn[]
  return rows.reverse()
}

export function latestUserContent(worldId: number): string | null {
  const row = latestUserContentStmt.get(worldId) as { content: string } | undefined
  return row?.content ?? null
}

export function latestTurn(worldId: number): Turn | null {
  return (latestTurnStmt.get(worldId) as Turn | undefined) ?? null
}

export function latestAssistantAfterLatestUser(worldId: number): Turn | null {
  return (
    (latestAssistantAfterLatestUserStmt.get(worldId, worldId) as Turn | undefined) ?? null
  )
}

export function userTurnCount(worldId: number): number {
  const row = userTurnCountStmt.get(worldId) as { n: number }
  return row.n
}

const latestUserTurnIdStmt = db.prepare<[number]>(
  `SELECT id FROM turns WHERE world_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1`,
)
// Most recent player turn id in the world — used by the pre-narrator NPC
// agent for [t:N] provenance on activity_append lines, since the narrator
// turn doesn't exist yet at agent-call time.
export function latestUserTurnId(worldId: number): number | null {
  const row = latestUserTurnIdStmt.get(worldId) as { id: number } | undefined
  return row?.id ?? null
}

export function getCharactersForWorld(worldId: number): Character[] {
  return charactersForWorldStmt.all(worldId) as Character[]
}

export function getCharactersInPlace(worldId: number, placeId: number): Character[] {
  return charactersInPlaceStmt.all(worldId, placeId) as Character[]
}

export function getPlacesForWorld(worldId: number): Place[] {
  return placesForWorldStmt.all(worldId) as Place[]
}

export function getPlace(id: number): Place | null {
  return (placeByIdStmt.get(id) as Place | undefined) ?? null
}

export function getScenesForWorld(worldId: number): Scene[] {
  return scenesForWorldStmt.all(worldId) as Scene[]
}

export function getActiveSceneForWorld(worldId: number): Scene | null {
  return (activeSceneStmt.get(worldId) as Scene | undefined) ?? null
}

export type WorldCursor = { world_time: string | null; current_scene_id: number | null }

export function getWorldCursor(worldId: number): WorldCursor {
  const row = worldCursorStmt.get(worldId) as WorldCursor | undefined
  return row ?? { world_time: null, current_scene_id: null }
}

export function updateTurnMetadata(id: number, metadata: Record<string, unknown>): void {
  updateMetadataStmt.run(JSON.stringify(metadata), id)
}

export function addTtsChars(worldId: number, turnId: number, chars: number): void {
  addTtsCharsStmt.run(Math.max(0, Math.round(chars)), turnId, worldId)
}

export type CachedTtsAudio = {
  contentType: string
  audio: Buffer
  byteLength: number
}

export function getCachedTtsAudio(
  worldId: number,
  turnId: number,
  modelKey: string,
  voiceId: string,
  textHash: string,
): CachedTtsAudio | null {
  const row = getTtsAudioCacheStmt.get(worldId, turnId, modelKey, voiceId, textHash) as
    | { id: number; content_type: string; audio: Buffer; byte_length: number }
    | undefined
  if (!row) return null
  touchTtsAudioCacheStmt.run(row.id)
  return { contentType: row.content_type, audio: row.audio, byteLength: row.byte_length }
}

export function storeCachedTtsAudio({
  worldId,
  turnId,
  modelKey,
  voiceId,
  textHash,
  contentType,
  audio,
  maxPerWorld = 3,
}: {
  worldId: number
  turnId: number
  modelKey: string
  voiceId: string
  textHash: string
  contentType: string
  audio: Buffer
  maxPerWorld?: number
}): void {
  db.transaction(() => {
    upsertTtsAudioCacheStmt.run(
      worldId,
      modelKey,
      voiceId,
      textHash,
      contentType,
      audio,
      audio.byteLength,
      turnId,
      worldId,
    )
    pruneTtsAudioCacheStmt.run(worldId, worldId, maxPerWorld)
  })()
}

export type UsageTotals = {
  turns: number
  narratorInput: number
  narratorOutput: number
  archivistInput: number
  archivistOutput: number
  npcAgentInput: number
  npcAgentOutput: number
}

export function getUsageTotals(worldId: number): UsageTotals {
  return usageTotalsStmt.get(worldId) as UsageTotals
}

export function getLatestMetadata(
  worldId: number,
): { id: number; metadata: Record<string, unknown> } | null {
  const row = latestMetadataStmt.get(worldId) as { id: number; metadata: string } | undefined
  if (!row) return null
  try {
    return { id: row.id, metadata: JSON.parse(row.metadata) as Record<string, unknown> }
  } catch {
    return null
  }
}

export type AssistantTurnMetadata = { id: number; metadata: Record<string, unknown> }

function parseMetadataRows(
  rows: Array<{ id: number; metadata: string }>,
): AssistantTurnMetadata[] {
  return rows.flatMap((row) => {
    try {
      return [{ id: row.id, metadata: JSON.parse(row.metadata) as Record<string, unknown> }]
    } catch {
      return []
    }
  })
}

export function allAssistantMetadata(worldId: number): AssistantTurnMetadata[] {
  return parseMetadataRows(
    assistantMetadataStmt.all(worldId) as Array<{ id: number; metadata: string }>,
  )
}

// History pagination companions to latestTurns / turnsBefore. "Since" returns
// metadata for every assistant turn with id >= minId; "InRange" is bounded on
// both sides for the older slice.
export function assistantMetadataSince(
  worldId: number,
  minId: number,
): AssistantTurnMetadata[] {
  return parseMetadataRows(
    assistantMetadataSinceStmt.all(worldId, minId) as Array<{ id: number; metadata: string }>,
  )
}

export function assistantMetadataInRange(
  worldId: number,
  minId: number,
  maxIdExclusive: number,
): AssistantTurnMetadata[] {
  return parseMetadataRows(
    assistantMetadataInRangeStmt.all(worldId, minId, maxIdExclusive) as Array<{
      id: number
      metadata: string
    }>,
  )
}

export function hasTurnBefore(worldId: number, id: number): boolean {
  return hasTurnBeforeStmt.get(worldId, id) !== undefined
}

export function getTurnTimestampsForWorld(worldId: number): TurnTimestamp[] {
  return turnTimestampsForWorldStmt.all(worldId) as TurnTimestamp[]
}

export function getStoryDossierForWorld(worldId: number): StoryDossier {
  return {
    threads: storyThreadsForWorldStmt.all(worldId) as StoryThread[],
    clues: storyCluesForWorldStmt.all(worldId) as StoryClue[],
    objectives: storyObjectivesForWorldStmt.all(worldId) as StoryObjective[],
    resources: storyResourcesForWorldStmt.all(worldId) as StoryResource[],
    timeline: timelineEventsForWorldStmt.all(worldId) as TimelineEvent[],
  }
}

// v0.6.6 — player→archivist correction scrollback. Rows are inserted by the
// /api/world-correction route after the patch has been applied; read back by
// the inspector's Archivist tab for the in-tab scrollback. `applied_patch` is
// the serialized ArchivistPatch JSON so a row is self-describing without
// joining against the entity tables.
export type WorldCorrectionRow = {
  id: number
  world_id: number
  turn_id: number | null
  player_text: string
  archivist_reply: string
  applied_patch: string
  created_at: string
}

export function insertWorldCorrection(
  worldId: number,
  turnId: number | null,
  playerText: string,
  archivistReply: string,
  appliedPatch: unknown,
): WorldCorrectionRow {
  return insertWorldCorrectionStmt.get(
    worldId,
    turnId,
    playerText,
    archivistReply,
    JSON.stringify(appliedPatch),
  ) as WorldCorrectionRow
}

export function getWorldCorrectionsForWorld(
  worldId: number,
  limit = 50,
): WorldCorrectionRow[] {
  return worldCorrectionsForWorldStmt.all(worldId, Math.max(1, Math.min(200, limit))) as WorldCorrectionRow[]
}

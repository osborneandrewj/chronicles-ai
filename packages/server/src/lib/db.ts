import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runMigrations } from '@/lib/migrations'
// Row TYPE defs now live in `domain/entities/*` (spec §3.3). Imported here for
// local use in the repository functions, and re-exported (below) for back-compat
// with the many call sites that still import them from `db.ts`; those importers
// move off `db.ts` incrementally in P4/P5.
import type {
  AssistantTurnMetadata,
  CachedTtsAudio,
  Character,
  CharacterRelationship,
  OccupancySnapshotRow,
  Place,
  PlaceConnection,
  PlaceProfileRow,
  PopulationTemplateRow,
  Scene,
  StoryClue,
  StoryDossier,
  StoryObjective,
  StoryResource,
  StoryThread,
  TimelineEvent,
  Turn,
  TurnRole,
  TurnTimestamp,
  UsageTotals,
  WorldCorrectionRow,
} from '@/domain/entities'

// Re-export the row TYPE defs for back-compat with call sites that still import
// them from `db.ts`. Those importers move off `db.ts` incrementally in P4/P5.
export type {
  AssistantTurnMetadata,
  CachedTtsAudio,
  Character,
  OccupancySnapshotRow,
  Place,
  PlaceProfileRow,
  PopulationTemplateRow,
  Scene,
  StoryClue,
  StoryDossier,
  StoryObjective,
  StoryResource,
  StoryThread,
  TimelineEvent,
  Turn,
  TurnRole,
  TurnTimestamp,
  UsageTotals,
  WorldCorrectionRow,
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
  // Default DB path is resolved relative to this module (not process.cwd()) so
  // the process runs correctly regardless of which directory it starts from.
  // From packages/server/src/lib/db.ts the repo root is four levels up, which
  // is where chronicles.sqlite has always lived for local dev. DATABASE_PATH
  // (the Railway mounted volume) overrides this.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const defaultDbPath = path.resolve(moduleDir, '../../../..', 'chronicles.sqlite')
  const dbPath = isBuild
    ? ':memory:'
    : (process.env.DATABASE_PATH ?? defaultDbPath)
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
// Turn-based retention (v0.6.11): keep every cache row whose turn_id is among
// the newest N distinct turn_ids for the world, evict the rest. "Newest" is by
// turn_id (higher id = later turn), not accessed_at — so replaying an evicted
// old turn re-synthesizes and is immediately re-pruned rather than displacing a
// recent turn. Robust to v0.6.12's multi-chunk-per-turn caching: a turn with
// several entries never evicts its own earlier chunk, because retention counts
// distinct turns, not rows.
const pruneTtsAudioCacheStmt = db.prepare<[number, number, number]>(
  `DELETE FROM tts_audio_cache
   WHERE world_id = ?
     AND turn_id NOT IN (
       SELECT turn_id FROM (
         SELECT DISTINCT turn_id FROM tts_audio_cache
         WHERE world_id = ?
         ORDER BY turn_id DESC
         LIMIT ?
       )
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
        agency_level, personal_goals, current_focus, recent_activity,
        private_beliefs, reveries, relationship_to_player, long_term_agenda, tool_access, appearance_count,
        last_seen_turn_id, last_agent_tick_turn_id, player_notes,
        in_transit_to_place_id, arrival_world_time, last_known_situation,
        aliases, daily_loop,
        created_at, updated_at`
const charactersForWorldStmt = db.prepare<[number]>(
  `SELECT ${CHARACTER_COLS}
   FROM characters WHERE world_id = ? ORDER BY is_player DESC, id ASC`,
)
const charactersInPlaceStmt = db.prepare<[number, number]>(
  `SELECT ${CHARACTER_COLS}
   FROM characters WHERE world_id = ? AND current_place_id = ? ORDER BY id ASC`,
)
const placesForWorldStmt = db.prepare<[number]>(
  `SELECT id, world_id, name, description, kind, deck, layout_hint, player_notes,
          osm_display_name, osm_street, osm_neighborhood, osm_lat, osm_lng,
          geo_status, geo_resolved_at,
          created_at, updated_at FROM places
   WHERE world_id = ? ORDER BY id ASC`,
)
const placeByIdStmt = db.prepare<[number]>(
  `SELECT id, world_id, name, description, kind, deck, layout_hint, player_notes,
          osm_display_name, osm_street, osm_neighborhood, osm_lat, osm_lng,
          geo_status, geo_resolved_at,
          created_at, updated_at FROM places WHERE id = ?`,
)
const scenesForWorldStmt = db.prepare<[number]>(
  `SELECT id, world_id, place_id, title, summary, scene_number, status,
          scene_mood, pace, focus,
          opened_at_turn, closed_at_turn, created_at, updated_at
   FROM scenes WHERE world_id = ? ORDER BY scene_number ASC`,
)
const activeSceneStmt = db.prepare<[number]>(
  `SELECT id, world_id, place_id, title, summary, scene_number, status,
          scene_mood, pace, focus,
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
          hidden, relevance_tags_json, source_turn_id, resolved_turn_id, created_at, updated_at
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

// Bounded-world inserts (starship P1). The seeder writes its own rooms/crew, so
// these are plain parameterized inserts returning the new row id. Unlike the
// open-world place insert in worlds.ts, these carry deck + layout_hint (v26).
const insertBoundedPlaceStmt = db.prepare<
  [number, string, string | null, string | null, string | null, string | null]
>(
  `INSERT INTO places (world_id, name, description, kind, deck, layout_hint)
   VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
)

export function insertBoundedPlace(input: {
  world_id: number
  name: string
  description: string | null
  kind: string | null
  deck: string | null
  layout_hint: string | null
}): { id: number } {
  const row = insertBoundedPlaceStmt.get(
    input.world_id,
    input.name,
    input.description,
    input.kind,
    input.deck,
    input.layout_hint,
  ) as { id: number }
  return { id: row.id }
}

// Bounded-world character insert (starship P1). `role` has no dedicated column;
// the crew role is stored in `current_focus` (an existing field) per the P1 spec.
// daily_loop is JSON text written to the characters.daily_loop column (v24).
const insertBoundedCharacterStmt = db.prepare<
  [number, string, string | null, number, number | null, string | null, string | null, string | null]
>(
  `INSERT INTO characters
     (world_id, name, description, is_player, current_place_id,
      current_focus, active_goal, daily_loop)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
)

export function insertBoundedCharacter(input: {
  world_id: number
  name: string
  description: string | null
  is_player: number
  current_place_id: number | null
  role: string | null
  active_goal: string | null
  daily_loop: string | null
}): { id: number } {
  const row = insertBoundedCharacterStmt.get(
    input.world_id,
    input.name,
    input.description,
    input.is_player,
    input.current_place_id,
    input.role,
    input.active_goal,
    input.daily_loop,
  ) as { id: number }
  return { id: row.id }
}

// Bounded-world sim write (starship P2): move an NPC to a room (or clear it).
const setCharacterPlaceStmt = db.prepare<[number | null, number]>(
  'UPDATE characters SET current_place_id = ? WHERE id = ?',
)

export function setCharacterPlace(characterId: number, placeId: number | null): void {
  setCharacterPlaceStmt.run(placeId, characterId)
}

// --- place_connections (v26): bounded-world topology graph (starship P1) ---

const insertPlaceConnectionStmt = db.prepare<
  [number, number, number, string | null, number]
>(
  `INSERT INTO place_connections
     (world_id, from_place_id, to_place_id, kind, bidirectional, created_at)
   VALUES (?, ?, ?, ?, ?, datetime('now'))`,
)

const placeConnectionsForWorldStmt = db.prepare<[number]>(
  `SELECT id, world_id, from_place_id, to_place_id, kind, bidirectional, created_at
   FROM place_connections WHERE world_id = ? ORDER BY id ASC`,
)

export function insertPlaceConnection(input: {
  world_id: number
  from_place_id: number
  to_place_id: number
  kind: string | null
  bidirectional: number
}): void {
  insertPlaceConnectionStmt.run(
    input.world_id,
    input.from_place_id,
    input.to_place_id,
    input.kind,
    input.bidirectional,
  )
}

export function getPlaceConnectionsForWorld(worldId: number): PlaceConnection[] {
  return placeConnectionsForWorldStmt.all(worldId) as PlaceConnection[]
}

// --- timeline_events (v28): sim-provenance append (starship P3) ---

const insertTimelineEventStmt = db.prepare<
  [number, number | null, number | null, string | null, string, string, number, number | null, string]
>(
  `INSERT INTO timeline_events
     (world_id, turn_id, thread_id, world_time, title, summary, importance,
      sim_tick, provenance, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
)

export function insertTimelineEvent(input: {
  world_id: number
  turn_id: number | null
  thread_id: number | null
  world_time: string | null
  title: string
  summary: string
  importance: number
  sim_tick: number | null
  provenance: string
}): void {
  insertTimelineEventStmt.run(
    input.world_id,
    input.turn_id,
    input.thread_id,
    input.world_time,
    input.title,
    input.summary,
    input.importance,
    input.sim_tick,
    input.provenance,
  )
}

// --- character_relationships (v27): the relationship graph (starship P1) ---

const relationshipsForWorldStmt = db.prepare<[number]>(
  `SELECT id, world_id, from_character_id, to_character_id, kind, valence, note, updated_at
   FROM character_relationships WHERE world_id = ? ORDER BY id ASC`,
)

const findRelationshipStmt = db.prepare<[number, number, number]>(
  `SELECT id FROM character_relationships
   WHERE world_id = ? AND from_character_id = ? AND to_character_id = ?`,
)

const insertRelationshipStmt = db.prepare<
  [number, number, number, string | null, number, string | null]
>(
  `INSERT INTO character_relationships
     (world_id, from_character_id, to_character_id, kind, valence, note, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
)

const updateRelationshipStmt = db.prepare<
  [string | null, number, string | null, number]
>(
  `UPDATE character_relationships
   SET kind = ?, valence = ?, note = ?, updated_at = datetime('now')
   WHERE id = ?`,
)

const adjustRelationshipValenceStmt = db.prepare<[number, number]>(
  `UPDATE character_relationships
   SET valence = valence + ?, updated_at = datetime('now')
   WHERE id = ?`,
)

export function getRelationshipsForWorld(worldId: number): CharacterRelationship[] {
  return relationshipsForWorldStmt.all(worldId) as CharacterRelationship[]
}

// Upsert a (from,to) edge: replace kind/note and set valence on conflict,
// otherwise insert. Keyed on (world_id, from_character_id, to_character_id).
export function upsertRelationship(input: {
  world_id: number
  from_character_id: number
  to_character_id: number
  kind: string | null
  valence: number
  note: string | null
}): void {
  const existing = findRelationshipStmt.get(
    input.world_id,
    input.from_character_id,
    input.to_character_id,
  ) as { id: number } | undefined
  if (existing) {
    updateRelationshipStmt.run(input.kind, input.valence, input.note, existing.id)
  } else {
    insertRelationshipStmt.run(
      input.world_id,
      input.from_character_id,
      input.to_character_id,
      input.kind,
      input.valence,
      input.note,
    )
  }
}

export function adjustRelationshipValence(relationshipId: number, valence: number): void {
  adjustRelationshipValenceStmt.run(valence, relationshipId)
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
  turnsPerWorld = 2,
}: {
  worldId: number
  turnId: number
  modelKey: string
  voiceId: string
  textHash: string
  contentType: string
  audio: Buffer
  turnsPerWorld?: number
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
    pruneTtsAudioCacheStmt.run(worldId, worldId, turnsPerWorld)
  })()
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

const placeProfileByPlaceStmt = db.prepare<[number, number]>(
  `SELECT id, world_id, place_id, profile_kind, capacity_min, capacity_max,
          typical_roles_json, open_hours_json, traffic_level, ambience_tags_json,
          match_tags_json, encounter_rules_json, created_at, updated_at
   FROM place_profiles WHERE world_id = ? AND place_id = ?`,
)

const insertPlaceProfileStmt = db.prepare<
  [number, number, string, number, number, string, string, string]
>(
  `INSERT INTO place_profiles
     (world_id, place_id, profile_kind, capacity_min, capacity_max,
      typical_roles_json, match_tags_json, traffic_level)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(world_id, place_id) DO NOTHING`,
)

const populationTemplatesByKindStmt = db.prepare<[number, string]>(
  `SELECT id, world_id, place_profile_kind, role, label, description,
          behavior_tags_json, match_tags_json, seed_premise, promotable, weight,
          created_at, updated_at
   FROM population_templates
   WHERE world_id = ? AND (place_profile_kind = ? OR place_profile_kind IS NULL)
   ORDER BY id ASC`,
)

const insertOccupancySnapshotStmt = db.prepare<
  [number, number, number | null, number | null, string | null, string]
>(
  `INSERT INTO place_occupancy_snapshots
     (world_id, place_id, scene_id, source_turn_id, world_time, occupancy_json)
   VALUES (?, ?, ?, ?, ?, ?)`,
)

const latestOccupancySnapshotStmt = db.prepare<[number, number]>(
  `SELECT id, world_id, place_id, scene_id, source_turn_id, world_time,
          occupancy_json, created_at
   FROM place_occupancy_snapshots
   WHERE world_id = ? AND place_id = ?
   ORDER BY id DESC LIMIT 1`,
)

export function getPlaceProfileRow(worldId: number, placeId: number): PlaceProfileRow | null {
  return (placeProfileByPlaceStmt.get(worldId, placeId) as PlaceProfileRow | undefined) ?? null
}

export function insertPlaceProfile(input: {
  worldId: number
  placeId: number
  profileKind: string
  capacityMin: number
  capacityMax: number
  typicalRolesJson: string
  matchTagsJson: string
  trafficLevel: 'none' | 'low' | 'medium' | 'high' | 'surge'
}): void {
  insertPlaceProfileStmt.run(
    input.worldId,
    input.placeId,
    input.profileKind,
    input.capacityMin,
    input.capacityMax,
    input.typicalRolesJson,
    input.matchTagsJson,
    input.trafficLevel,
  )
}

export function getPopulationTemplatesForKind(
  worldId: number,
  profileKind: string,
): PopulationTemplateRow[] {
  return populationTemplatesByKindStmt.all(worldId, profileKind) as PopulationTemplateRow[]
}

export function insertOccupancySnapshot(input: {
  worldId: number
  placeId: number
  sceneId: number | null
  sourceTurnId: number | null
  worldTime: string | null
  occupancyJson: string
}): void {
  insertOccupancySnapshotStmt.run(
    input.worldId,
    input.placeId,
    input.sceneId,
    input.sourceTurnId,
    input.worldTime,
    input.occupancyJson,
  )
}

export function getLatestOccupancySnapshotRow(
  worldId: number,
  placeId: number,
): OccupancySnapshotRow | null {
  return (latestOccupancySnapshotStmt.get(worldId, placeId) as OccupancySnapshotRow | undefined) ?? null
}

// v0.6.6 — player→archivist correction scrollback. Rows are inserted by the
// /api/world-correction route after the patch has been applied; read back by
// the inspector's Archivist tab for the in-tab scrollback. `applied_patch` is
// the serialized ArchivistPatch JSON so a row is self-describing without
// joining against the entity tables. (The row TYPE def now lives in
// `domain/entities/correction.ts`.)
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

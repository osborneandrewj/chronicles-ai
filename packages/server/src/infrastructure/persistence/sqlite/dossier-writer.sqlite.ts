import 'server-only'

import { db } from '@/lib/db'
import type {
  DossierWriter,
  InsertStoryClueInput,
  InsertStoryObjectiveInput,
  InsertStoryResourceInput,
  InsertStoryThreadInput,
  StoryThreadLookupRow,
  UpdateStoryClueInput,
  UpdateStoryObjectiveInput,
  UpdateStoryResourceInput,
  UpdateStoryThreadInput,
} from '@/domain/ports/dossier-writer'

// SQLite adapter for DossierWriter (Phase 4). Each prepared statement below is a
// VERBATIM COPY of the matching statement in `lib/archivist.ts` (byte-identical:
// same columns, same COALESCE / datetime('now'), same WHERE) — temporary
// duplication that Phase 4b removes when the archivist adopts this port. Dumb
// CRUD: no upsert decision here; the use case decides which path to call.

const storyThreadByTitleStmt = db.prepare<[number, string]>(
  `SELECT id, title, kind, status, summary, stakes, rewards, consequences, hidden, relevance_tags_json
   FROM story_threads
   WHERE world_id = ? AND lower(title) = lower(?)`,
)
const insertStoryThreadStmt = db.prepare<
  [
    number,
    string,
    string,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string,
    number | null,
  ]
>(
  `INSERT INTO story_threads
     (world_id, title, kind, status, summary, stakes, rewards, consequences, hidden, relevance_tags_json, source_turn_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   RETURNING id`,
)
const updateStoryThreadStmt = db.prepare<
  [
    string,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string,
    number | null,
    number,
  ]
>(
  `UPDATE story_threads SET
     kind                = ?,
     status              = ?,
     summary             = COALESCE(?, summary),
     stakes              = COALESCE(?, stakes),
     rewards             = COALESCE(?, rewards),
     consequences        = COALESCE(?, consequences),
     hidden              = COALESCE(?, hidden),
     relevance_tags_json = ?,
     resolved_turn_id    = COALESCE(?, resolved_turn_id),
     updated_at          = datetime('now')
   WHERE id = ?`,
)
const storyClueByTitleStmt = db.prepare<[number, string]>(
  `SELECT id FROM story_clues WHERE world_id = ? AND lower(title) = lower(?)`,
)
const insertStoryClueStmt = db.prepare<
  [number, number | null, string, string | null, string | null, string, number | null]
>(
  `INSERT INTO story_clues (world_id, thread_id, title, detail, implication, status, source_turn_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const updateStoryClueStmt = db.prepare<
  [number | null, string | null, string | null, string, number]
>(
  `UPDATE story_clues SET
     thread_id   = COALESCE(?, thread_id),
     detail      = COALESCE(?, detail),
     implication = COALESCE(?, implication),
     status      = ?,
     updated_at  = datetime('now')
   WHERE id = ?`,
)
const storyObjectiveByTitleStmt = db.prepare<[number, string]>(
  `SELECT id FROM story_objectives WHERE world_id = ? AND lower(title) = lower(?)`,
)
const insertStoryObjectiveStmt = db.prepare<
  [number, number | null, string, string, string | null, string | null, number | null]
>(
  `INSERT INTO story_objectives (world_id, thread_id, title, status, detail, blocker, source_turn_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const updateStoryObjectiveStmt = db.prepare<
  [number | null, string, string | null, string | null, number | null, number]
>(
  `UPDATE story_objectives SET
     thread_id          = COALESCE(?, thread_id),
     status             = ?,
     detail             = COALESCE(?, detail),
     blocker            = COALESCE(?, blocker),
     completed_turn_id  = COALESCE(?, completed_turn_id),
     updated_at         = datetime('now')
   WHERE id = ?`,
)
const storyResourceByNameStmt = db.prepare<[number, string]>(
  `SELECT id FROM story_resources WHERE world_id = ? AND lower(name) = lower(?)`,
)
const insertStoryResourceStmt = db.prepare<
  [
    number,
    number | null,
    string,
    string | null,
    string | null,
    string | null,
    number | null,
    number | null,
    number,
    number | null,
  ]
>(
  `INSERT INTO story_resources
     (world_id, owner_character_id, name, kind, status, detail,
      held_by_character_id, location_place_id, salient, source_turn_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const updateStoryResourceStmt = db.prepare<
  [
    number | null,
    string | null,
    string | null,
    string | null,
    number | null,
    number | null,
    number | null,
    number,
  ]
>(
  `UPDATE story_resources SET
     owner_character_id   = COALESCE(?, owner_character_id),
     kind                 = COALESCE(?, kind),
     status               = COALESCE(?, status),
     detail               = COALESCE(?, detail),
     held_by_character_id = COALESCE(?, held_by_character_id),
     location_place_id    = COALESCE(?, location_place_id),
     salient              = COALESCE(?, salient),
     updated_at           = datetime('now')
   WHERE id = ?`,
)

export class SqliteDossierWriter implements DossierWriter {
  threadByTitle(worldId: number, title: string): Promise<StoryThreadLookupRow | null> {
    const row = storyThreadByTitleStmt.get(worldId, title) as StoryThreadLookupRow | undefined
    return Promise.resolve(row ?? null)
  }

  insertThread(input: InsertStoryThreadInput): Promise<{ id: number }> {
    const row = insertStoryThreadStmt.get(
      input.world_id,
      input.title,
      input.kind,
      input.status,
      input.summary,
      input.stakes,
      input.rewards,
      input.consequences,
      input.hidden,
      input.relevance_tags_json,
      input.source_turn_id,
    ) as { id: number }
    return Promise.resolve({ id: row.id })
  }

  updateThread(input: UpdateStoryThreadInput): Promise<void> {
    updateStoryThreadStmt.run(
      input.kind,
      input.status,
      input.summary,
      input.stakes,
      input.rewards,
      input.consequences,
      input.hidden,
      input.relevance_tags_json,
      input.resolved_turn_id,
      input.id,
    )
    return Promise.resolve()
  }

  clueByTitle(worldId: number, title: string): Promise<{ id: number } | null> {
    const row = storyClueByTitleStmt.get(worldId, title) as { id: number } | undefined
    return Promise.resolve(row ?? null)
  }

  insertClue(input: InsertStoryClueInput): Promise<{ id: number }> {
    const result = insertStoryClueStmt.run(
      input.world_id,
      input.thread_id,
      input.title,
      input.detail,
      input.implication,
      input.status,
      input.source_turn_id,
    )
    return Promise.resolve({ id: Number(result.lastInsertRowid) })
  }

  updateClue(input: UpdateStoryClueInput): Promise<void> {
    updateStoryClueStmt.run(
      input.thread_id,
      input.detail,
      input.implication,
      input.status,
      input.id,
    )
    return Promise.resolve()
  }

  objectiveByTitle(worldId: number, title: string): Promise<{ id: number } | null> {
    const row = storyObjectiveByTitleStmt.get(worldId, title) as { id: number } | undefined
    return Promise.resolve(row ?? null)
  }

  insertObjective(input: InsertStoryObjectiveInput): Promise<{ id: number }> {
    const result = insertStoryObjectiveStmt.run(
      input.world_id,
      input.thread_id,
      input.title,
      input.status,
      input.detail,
      input.blocker,
      input.source_turn_id,
    )
    return Promise.resolve({ id: Number(result.lastInsertRowid) })
  }

  updateObjective(input: UpdateStoryObjectiveInput): Promise<void> {
    updateStoryObjectiveStmt.run(
      input.thread_id,
      input.status,
      input.detail,
      input.blocker,
      input.completed_turn_id,
      input.id,
    )
    return Promise.resolve()
  }

  resourceByName(worldId: number, name: string): Promise<{ id: number } | null> {
    const row = storyResourceByNameStmt.get(worldId, name) as { id: number } | undefined
    return Promise.resolve(row ?? null)
  }

  insertResource(input: InsertStoryResourceInput): Promise<{ id: number }> {
    const result = insertStoryResourceStmt.run(
      input.world_id,
      input.owner_character_id,
      input.name,
      input.kind,
      input.status,
      input.detail,
      input.held_by_character_id,
      input.location_place_id,
      input.salient ? 1 : 0,
      input.source_turn_id,
    )
    return Promise.resolve({ id: Number(result.lastInsertRowid) })
  }

  updateResource(input: UpdateStoryResourceInput): Promise<void> {
    updateStoryResourceStmt.run(
      input.owner_character_id,
      input.kind,
      input.status,
      input.detail,
      input.held_by_character_id,
      input.location_place_id,
      input.salient === null || input.salient === undefined ? null : input.salient ? 1 : 0,
      input.id,
    )
    return Promise.resolve()
  }
}

import 'server-only'

import {
  db,
  getActiveSceneForWorld,
  getScenesForWorld,
  insertBoundedScene,
} from '@/lib/db'
import type { Scene } from '@/lib/world-state'
import type {
  SceneCloseInput,
  SceneContextInput,
  SceneInput,
  SceneInsertInput,
  SceneRepository,
} from '@/domain/ports/scene-repository'

// Archivist scene write/read statements (P4a). VERBATIM byte-for-byte copies of
// the prepared statements in lib/archivist.ts (closeSceneStmt, insertSceneStmt,
// updateSceneContextStmt, autoCloseSceneStmt, maxSceneNumberStmt,
// currentSceneIdStmt, currentScenePlaceIdStmt). The duplication is temporary —
// P4b deletes the archivist originals once the use case routes through this port.
const closeSceneStmt = db.prepare<[string, number, number]>(
  `UPDATE scenes SET status = 'completed', summary = ?, closed_at_turn = ?, updated_at = datetime('now')
   WHERE id = ?`,
)
const maxSceneNumberStmt = db.prepare<[number]>(
  'SELECT COALESCE(MAX(scene_number), 0) as n FROM scenes WHERE world_id = ?',
)
const insertSceneStmt = db.prepare<[number, number, string, number, number]>(
  `INSERT INTO scenes (world_id, place_id, title, scene_number, opened_at_turn, updated_at)
   VALUES (?, ?, ?, ?, ?, datetime('now')) RETURNING id`,
)
const updateSceneContextStmt = db.prepare<
  [string | null, string | null, string | null, number]
>(
  `UPDATE scenes SET
     scene_mood = COALESCE(?, scene_mood),
     pace       = COALESCE(?, pace),
     focus      = COALESCE(?, focus),
     updated_at = datetime('now')
   WHERE id = ?`,
)
const currentSceneIdStmt = db.prepare<[number]>(
  'SELECT current_scene_id FROM worlds WHERE id = ?',
)
const autoCloseSceneStmt = db.prepare<[number, number]>(
  `UPDATE scenes SET status = 'completed', closed_at_turn = ?, updated_at = datetime('now')
   WHERE id = ? AND status = 'active'`,
)
const currentScenePlaceIdStmt = db.prepare<[number]>(
  `SELECT s.place_id FROM worlds w JOIN scenes s ON s.id = w.current_scene_id WHERE w.id = ?`,
)

// SQLite adapter for SceneRepository (spec §5.1-P1). Dumb CRUD.
export class SqliteSceneRepository implements SceneRepository {
  forWorld(worldId: number): Promise<Scene[]> {
    return Promise.resolve(getScenesForWorld(worldId))
  }

  activeForWorld(worldId: number): Promise<Scene | null> {
    return Promise.resolve(getActiveSceneForWorld(worldId))
  }

  add(scene: SceneInput): Promise<{ id: number }> {
    return Promise.resolve(insertBoundedScene(scene))
  }

  close(input: SceneCloseInput): Promise<void> {
    closeSceneStmt.run(input.summary, input.closedAtTurn, input.id)
    return Promise.resolve()
  }

  insert(input: SceneInsertInput): Promise<{ id: number }> {
    const row = insertSceneStmt.get(
      input.world_id,
      input.place_id,
      input.title,
      input.scene_number,
      input.opened_at_turn,
    ) as { id: number }
    return Promise.resolve({ id: row.id })
  }

  updateContext(input: SceneContextInput): Promise<void> {
    updateSceneContextStmt.run(input.scene_mood, input.pace, input.focus, input.id)
    return Promise.resolve()
  }

  autoClose(closedAtTurn: number, id: number): Promise<void> {
    autoCloseSceneStmt.run(closedAtTurn, id)
    return Promise.resolve()
  }

  maxSceneNumber(worldId: number): Promise<number> {
    const row = maxSceneNumberStmt.get(worldId) as { n: number }
    return Promise.resolve(row.n)
  }

  currentSceneId(worldId: number): Promise<number | null> {
    const row = currentSceneIdStmt.get(worldId) as
      | { current_scene_id: number | null }
      | undefined
    return Promise.resolve(row?.current_scene_id ?? null)
  }

  currentScenePlaceId(worldId: number): Promise<number | null> {
    const row = currentScenePlaceIdStmt.get(worldId) as
      | { place_id: number | null }
      | undefined
    return Promise.resolve(row?.place_id ?? null)
  }
}

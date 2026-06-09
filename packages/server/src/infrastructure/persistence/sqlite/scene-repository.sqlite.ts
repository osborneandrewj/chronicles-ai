import 'server-only'

import {
  getActiveSceneForWorld,
  getScenesForWorld,
  insertBoundedScene,
} from '@/lib/db'
import type { Scene } from '@/lib/world-state'
import type { SceneInput, SceneRepository } from '@/domain/ports/scene-repository'

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
}

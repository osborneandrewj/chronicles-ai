import 'server-only'

import { getActiveSceneForWorld, getScenesForWorld } from '@/lib/db'
import type { Scene } from '@/lib/world-state'
import type { SceneRepository } from '@/domain/ports/scene-repository'

// SQLite adapter for SceneRepository (spec §5.1-P1). Dumb CRUD reads.
export class SqliteSceneRepository implements SceneRepository {
  forWorld(worldId: number): Promise<Scene[]> {
    return Promise.resolve(getScenesForWorld(worldId))
  }

  activeForWorld(worldId: number): Promise<Scene | null> {
    return Promise.resolve(getActiveSceneForWorld(worldId))
  }
}

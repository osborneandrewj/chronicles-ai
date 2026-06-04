import 'server-only'

import type { Scene } from '@/lib/world-state'
import type { SceneRepository } from '@/domain/ports/scene-repository'

import type { MongoContext } from '../mongo-context'
import { mapScene } from './mappers'

// Mongo SceneRepository (spec §4.2) — dumb CRUD reads over `scenes`. Scene
// open/close transition logic is deciding logic that stays out of the adapter
// (P4/P5).
export class MongoSceneRepository implements SceneRepository {
  constructor(private readonly ctx: MongoContext) {}

  async forWorld(worldId: number): Promise<Scene[]> {
    const docs = await this.ctx.models.Scene.find({ worldId })
      .sort({ sceneNumber: 1 })
      .lean()
    return docs.map(mapScene)
  }

  async activeForWorld(worldId: number): Promise<Scene | null> {
    const doc = await this.ctx.models.Scene.findOne({ worldId, status: 'active' })
      .sort({ sceneNumber: -1 })
      .lean()
    return doc ? mapScene(doc) : null
  }
}

import 'server-only'

import type { Scene } from '@/lib/world-state'
import type { SceneInput, SceneRepository } from '@/domain/ports/scene-repository'

import type { MongoContext } from '../mongo-context'
import { mapScene } from './mappers'

// Mongo SceneRepository (spec §4.2) — dumb CRUD over `scenes`. Scene open/close
// transition logic is deciding logic that stays out of the adapter (P4/P5);
// `add` is the bare insert the bounded-world join needs.
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

  async add(scene: SceneInput): Promise<{ id: number }> {
    const id = await this.ctx.nextSeq('sceneId')
    const now = new Date()
    await this.ctx.models.Scene.create(
      [
        {
          id,
          worldId: scene.world_id,
          placeId: scene.place_id,
          title: scene.title,
          summary: null,
          sceneNumber: scene.scene_number,
          status: scene.status as 'active' | 'completed',
          sceneMood: null,
          pace: null,
          focus: null,
          openedAtTurn: null,
          closedAtTurn: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session: this.ctx.currentSession ?? undefined },
    )
    return { id }
  }
}

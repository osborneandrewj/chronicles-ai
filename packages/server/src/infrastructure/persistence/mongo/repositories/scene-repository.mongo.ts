import 'server-only'

import type { Scene } from '@/lib/world-state'
import type {
  SceneCloseInput,
  SceneContextInput,
  SceneInput,
  SceneInsertInput,
  SceneRepository,
} from '@/domain/ports/scene-repository'

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
      .session(this.ctx.currentSession ?? null)
      .lean()
    return docs.map(mapScene)
  }

  async activeForWorld(worldId: number): Promise<Scene | null> {
    const doc = await this.ctx.models.Scene.findOne({ worldId, status: 'active' })
      .sort({ sceneNumber: -1 })
      .session(this.ctx.currentSession ?? null)
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

  // Archivist scene write/read surface (P4a, called in P4b). Equivalent
  // collection ops to the SQLite prepared statements: integer ids via nextSeq,
  // updatedAt stamped on every write (the datetime('now') analog), session
  // threaded so a UnitOfWork stays atomic.
  async close(input: SceneCloseInput): Promise<void> {
    await this.ctx.models.Scene.updateOne(
      { id: input.id },
      {
        $set: {
          status: 'completed',
          summary: input.summary,
          closedAtTurn: input.closedAtTurn,
          updatedAt: new Date(),
        },
      },
      { session: this.ctx.currentSession ?? undefined },
    )
  }

  async insert(input: SceneInsertInput): Promise<{ id: number }> {
    const id = await this.ctx.nextSeq('sceneId')
    const now = new Date()
    await this.ctx.models.Scene.create(
      [
        {
          id,
          worldId: input.world_id,
          placeId: input.place_id,
          title: input.title,
          summary: null,
          sceneNumber: input.scene_number,
          status: 'active',
          sceneMood: null,
          pace: null,
          focus: null,
          openedAtTurn: input.opened_at_turn,
          closedAtTurn: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session: this.ctx.currentSession ?? undefined },
    )
    return { id }
  }

  // COALESCE semantics: a null field leaves the stored value unchanged, a value
  // overwrites it — so only the supplied fields go into $set.
  async updateContext(input: SceneContextInput): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (input.scene_mood !== null) set.sceneMood = input.scene_mood
    if (input.pace !== null) set.pace = input.pace
    if (input.focus !== null) set.focus = input.focus
    await this.ctx.models.Scene.updateOne(
      { id: input.id },
      { $set: set },
      { session: this.ctx.currentSession ?? undefined },
    )
  }

  async autoClose(closedAtTurn: number, id: number): Promise<void> {
    await this.ctx.models.Scene.updateOne(
      { id, status: 'active' },
      { $set: { status: 'completed', closedAtTurn, updatedAt: new Date() } },
      { session: this.ctx.currentSession ?? undefined },
    )
  }

  async maxSceneNumber(worldId: number): Promise<number> {
    const doc = await this.ctx.models.Scene.findOne({ worldId })
      .sort({ sceneNumber: -1 })
      .select({ sceneNumber: 1 })
      .session(this.ctx.currentSession ?? null)
      .lean()
    return doc?.sceneNumber ?? 0
  }

  async currentSceneId(worldId: number): Promise<number | null> {
    const doc = await this.ctx.models.World.findOne({ id: worldId })
      .select({ currentSceneId: 1 })
      .session(this.ctx.currentSession ?? null)
      .lean()
    return doc?.currentSceneId ?? null
  }

  async currentScenePlaceId(worldId: number): Promise<number | null> {
    const world = await this.ctx.models.World.findOne({ id: worldId })
      .select({ currentSceneId: 1 })
      .session(this.ctx.currentSession ?? null)
      .lean()
    if (!world?.currentSceneId) return null
    const scene = await this.ctx.models.Scene.findOne({ id: world.currentSceneId })
      .select({ placeId: 1 })
      .session(this.ctx.currentSession ?? null)
      .lean()
    return scene?.placeId ?? null
  }
}

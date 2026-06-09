import 'server-only'

import type { World, WorldSummary } from '@/lib/worlds'
import type {
  CreateBoundedWorldInput,
  WorldRepository,
} from '@/domain/ports/world-repository'

import type { MongoContext } from '../mongo-context'
import { mapWorld, mapWorldSummary } from './mappers'

// Mongo WorldRepository (spec §4.2) — dumb CRUD over the `worlds` aggregate.
// `turn_count` for the summary list is a per-world count over the turns
// collection (the SQLite subquery analog). World creation (seeding) is deciding
// logic that stays in the use case (P4/P5).
export class MongoWorldRepository implements WorldRepository {
  constructor(private readonly ctx: MongoContext) {}

  async createBounded(input: CreateBoundedWorldInput): Promise<{ id: number }> {
    const id = await this.ctx.nextSeq('worldId')
    let initialState: Record<string, unknown> | null = null
    try {
      initialState = input.initialStateJson
        ? (JSON.parse(input.initialStateJson) as Record<string, unknown>)
        : null
    } catch {
      initialState = null
    }
    await this.ctx.models.World.create(
      [
        {
          id,
          name: input.name,
          premise: input.premise,
          initialState,
          settingRegion: null,
          spatialMode: 'bounded',
          templateId: input.templateId,
          worldTime: null,
          currentSceneId: null,
          archivedAt: null,
          createdAt: new Date(),
        },
      ],
      { session: this.ctx.currentSession ?? undefined },
    )
    return { id }
  }

  async getWorld(id: number): Promise<World | null> {
    const doc = await this.ctx.models.World.findOne({ id }).lean()
    return doc ? mapWorld(doc) : null
  }

  private async summaries(filter: Record<string, unknown>): Promise<WorldSummary[]> {
    const docs = await this.ctx.models.World.find(filter).sort({ id: -1 }).lean()
    const out: WorldSummary[] = []
    for (const d of docs) {
      const turnCount = await this.ctx.models.Turn.countDocuments({ worldId: d.id })
      out.push(mapWorldSummary(d, turnCount))
    }
    return out
  }

  listWorlds(): Promise<WorldSummary[]> {
    return this.summaries({ archivedAt: null })
  }

  listArchivedWorlds(): Promise<WorldSummary[]> {
    return this.summaries({ archivedAt: { $ne: null } })
  }

  async archiveWorld(id: number): Promise<void> {
    await this.ctx.models.World.updateOne(
      { id },
      { $set: { archivedAt: new Date() } },
      { session: this.ctx.currentSession ?? undefined },
    )
  }

  async unarchiveWorld(id: number): Promise<void> {
    await this.ctx.models.World.updateOne(
      { id },
      { $set: { archivedAt: null } },
      { session: this.ctx.currentSession ?? undefined },
    )
  }

  async cursor(
    worldId: number,
  ): Promise<{ world_time: string | null; current_scene_id: number | null }> {
    const doc = await this.ctx.models.World.findOne({ id: worldId })
      .select({ worldTime: 1, currentSceneId: 1 })
      .lean()
    return {
      world_time: doc?.worldTime ?? null,
      current_scene_id: doc?.currentSceneId ?? null,
    }
  }

  // Bounded-world sim write (starship P2): advance only worldTime, leaving the
  // scene cursor untouched (the player-less pre-sim has no active scene yet).
  async setWorldTime(worldId: number, worldTime: string): Promise<void> {
    await this.ctx.models.World.updateOne(
      { id: worldId },
      { $set: { worldTime } },
      { session: this.ctx.currentSession ?? undefined },
    )
  }
}

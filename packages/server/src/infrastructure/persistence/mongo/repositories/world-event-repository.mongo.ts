import 'server-only'

import type { WorldEvent, WorldEventInput } from '@/domain/entities'
import type { WorldEventRepository } from '@/domain/ports/world-event-repository'
import { WORLD_EVENT_RECENT_CAP } from '@/domain/ports/world-event-repository'

import type { MongoContext } from '../mongo-context'
import { mapWorldEvent } from './mappers'

export class MongoWorldEventRepository implements WorldEventRepository {
  constructor(private readonly ctx: MongoContext) {}

  async append(event: WorldEventInput): Promise<void> {
    const session = this.ctx.currentSession ?? undefined
    const id = await this.ctx.nextSeq('worldEventId')
    await this.ctx.models.WorldEvent.create(
      [
        {
          id,
          worldId: event.world_id,
          turnId: event.turn_id,
          worldTime: event.world_time,
          kind: event.kind,
          sourceAgent: event.source_agent,
          actorId: event.actor_id,
          threadId: event.thread_id,
          payload: event.payload ?? {},
          visibility: event.visibility,
          createdAt: new Date(),
        },
      ],
      { session },
    )
  }

  async recentForWorld(
    worldId: number,
    limit: number = WORLD_EVENT_RECENT_CAP,
  ): Promise<WorldEvent[]> {
    const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : WORLD_EVENT_RECENT_CAP
    const rows = await this.ctx.models.WorldEvent.find({ worldId })
      .sort({ id: -1 })
      .limit(cap)
      .session(this.ctx.currentSession)
      .lean()
    return rows.map(mapWorldEvent).filter((e): e is WorldEvent => e != null)
  }
}
import 'server-only'

import type { TimelineEvent } from '@/domain/entities'
import type { TimelineReader } from '@/domain/ports/timeline-reader'

import type { MongoContext } from '../mongo-context'
import { mapTimelineEvent } from './mappers'

// Mongo TimelineReader (starship P5). Dumb CRUD read over `timeline_events`,
// filtered to provenance='sim'. Mongo has no JOIN, so the `thread_title` the
// SQLite LEFT JOIN produces is resolved with an in-memory lookup over the events'
// thread ids. Ordering (id DESC) mirrors the SQLite read so the living tick sees
// the same newest-first window.
export class MongoTimelineReader implements TimelineReader {
  constructor(private readonly ctx: MongoContext) {}

  async recentSimEvents(worldId: number, limit: number): Promise<TimelineEvent[]> {
    const rows = await this.ctx.models.TimelineEvent.find({ worldId, provenance: 'sim' })
      .sort({ id: -1 })
      .limit(limit)
      .lean()

    const threadIds = rows
      .map((e) => e.threadId)
      .filter((x): x is number => x != null)
    const threadTitleById = new Map<number, string>()
    if (threadIds.length > 0) {
      const threads = await this.ctx.models.StoryThread.find({
        worldId,
        id: { $in: threadIds },
      })
        .select({ id: 1, title: 1 })
        .lean()
      for (const t of threads) threadTitleById.set(t.id, t.title)
    }

    return rows.map((e) =>
      mapTimelineEvent(e, e.threadId != null ? threadTitleById.get(e.threadId) ?? null : null),
    )
  }

  async maxSimTick(worldId: number): Promise<number | null> {
    const top = await this.ctx.models.TimelineEvent.findOne({
      worldId,
      provenance: 'sim',
      simTick: { $ne: null },
    })
      .sort({ simTick: -1 })
      .select({ simTick: 1 })
      .lean()
    return top?.simTick ?? null
  }
}

import 'server-only'

import type { TimelineEventInput, TimelineWriter } from '@/domain/ports/timeline-writer'

import type { MongoContext } from '../mongo-context'

// Mongo TimelineWriter (starship P3). Dumb CRUD append over `timeline_events`.
// The integer `id` comes from the shared counter (autoincrement-compatible with
// SQLite); `createdAt` is stamped here (the analog of datetime('now')). The
// caller sets provenance='sim' + sim_tick and leaves turnId null; deciding logic
// (gating, beat content) stays in the domain / drama port.
export class MongoTimelineWriter implements TimelineWriter {
  constructor(private readonly ctx: MongoContext) {}

  async append(event: TimelineEventInput): Promise<void> {
    const session = this.ctx.currentSession ?? undefined
    const id = await this.ctx.nextSeq('timelineEventId')
    await this.ctx.models.TimelineEvent.create(
      [
        {
          id,
          worldId: event.world_id,
          turnId: event.turn_id,
          threadId: event.thread_id,
          worldTime: event.world_time,
          title: event.title,
          summary: event.summary,
          importance: event.importance,
          simTick: event.sim_tick,
          provenance: event.provenance,
          createdAt: new Date(),
        },
      ],
      { session },
    )
  }
}

import 'server-only'

import { insertTimelineEvent } from '@/lib/db'
import type { TimelineEventInput, TimelineWriter } from '@/domain/ports/timeline-writer'

// SQLite adapter for TimelineWriter (starship P3). Dumb CRUD append over
// `timeline_events`. `created_at` is stamped with datetime('now') in the insert
// statement, consistent with the sibling write adapters. The caller (the sim
// use case) sets provenance='sim' + sim_tick and leaves turn_id null; the
// deciding logic (gating, beat content) stays in the domain / drama port.
export class SqliteTimelineWriter implements TimelineWriter {
  append(event: TimelineEventInput): Promise<void> {
    insertTimelineEvent(event)
    return Promise.resolve()
  }
}

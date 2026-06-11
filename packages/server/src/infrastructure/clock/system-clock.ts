import 'server-only'

import type { Clock } from '@/domain/ports/clock'

// System Clock adapter (spec §3.4). `today()` returns the UTC calendar day as
// `YYYY-MM-DD`, byte-identical to SQLite's `date('now')` (which is UTC), so the
// daily-cost-cap query keyed on this value matches the rows whose `created_at`
// was written with `datetime('now')`.
export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }

  today(): string {
    return new Date().toISOString().slice(0, 10)
  }
}

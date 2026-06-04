// Clock port (spec §3.4 ClockPort): replaces every `datetime('now')` / `new Date()`
// reach for a wall-clock at the application level. The SQLite adapter may still
// emit `datetime('now')` internally for row timestamps, but any application code
// that needs "now" or "today" reads it through this port so the seam exists for
// the Mongo/test fakes.
export interface Clock {
  /** ISO-ish wall-clock instant, UTC. */
  now(): Date
  /** UTC calendar day as `YYYY-MM-DD` (matches SQLite `date('now')`). */
  today(): string
}

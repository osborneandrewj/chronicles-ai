import type { UsageTotals } from '@/lib/db'

// UsageRepository (spec §3.4, §5.1-P1, §5.3) — token-accounting reads. The
// `SUM(json_extract(...))` cost aggregation lives inside the adapter; the
// application asks only for totals. `todaysTokenTotal(today)` takes the UTC day
// (from the Clock port) so the day boundary is decided in the application, not
// hardcoded as `date('now')` inside the SQL. Async by mandate (spec §5.3).
export interface UsageRepository {
  /** Per-agent input/output token totals for a world (cost footer). */
  totalsForWorld(worldId: number): Promise<UsageTotals>
  /**
   * Sum of all agents' input+output tokens across every world for the given
   * UTC calendar day (`YYYY-MM-DD`). Backs the daily cost cap.
   */
  todaysTokenTotal(today: string): Promise<number>
}

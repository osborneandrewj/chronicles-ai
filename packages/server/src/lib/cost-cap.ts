import { getContainer } from '@/composition/container'

const DEFAULT_DAILY_TOKEN_LIMIT = 200_000

// The daily token cap. The `SUM(json_extract(...))` aggregation that used to
// live here (raw `db` handle) now lives inside `UsageRepository` (spec
// §5.1-P1); this module is a thin policy wrapper that asks the repository for
// today's total — with the UTC day decided by the Clock port, not hardcoded as
// `date('now')` in SQL. The cap comparison itself becomes a pure domain service
// (`cost-policy.ts`) in P4; for P1 it stays here so behavior is unchanged.
export function todaysTokens(): Promise<number> {
  const { usage, clock } = getContainer()
  return usage.todaysTokenTotal(clock.today())
}

export function dailyTokenLimit(): number {
  const raw = process.env.DAILY_TOKEN_LIMIT
  if (!raw) return DEFAULT_DAILY_TOKEN_LIMIT
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_TOKEN_LIMIT
}

export async function isOverDailyLimit(): Promise<boolean> {
  return (await todaysTokens()) >= dailyTokenLimit()
}

import { db } from '@/lib/db'

const DEFAULT_DAILY_TOKEN_LIMIT = 200_000

// Sums every recorded narrator / archivist / extractor / classifier token
// (input + output) for the current UTC day. `archivist` is the post-v0.5 key;
// `extractor` is its pre-v0.5 name — both still appear in older rows and must
// be summed together so the daily cap doesn't silently undercount. Mirrors the
// key set in db.ts:77 (usageTotalsStmt). created_at is stored via
// datetime('now') (UTC), so date(created_at) = date('now') is a UTC-day match.
const todaysTokensStmt = db.prepare(`
  SELECT COALESCE(SUM(
    COALESCE(json_extract(metadata, '$.narrator.usage.inputTokens'),    0) +
    COALESCE(json_extract(metadata, '$.narrator.usage.outputTokens'),   0) +
    COALESCE(json_extract(metadata, '$.archivist.usage.inputTokens'),   0) +
    COALESCE(json_extract(metadata, '$.archivist.usage.outputTokens'),  0) +
    COALESCE(json_extract(metadata, '$.extractor.usage.inputTokens'),   0) +
    COALESCE(json_extract(metadata, '$.extractor.usage.outputTokens'),  0) +
    COALESCE(json_extract(metadata, '$.classifier.usage.inputTokens'),  0) +
    COALESCE(json_extract(metadata, '$.classifier.usage.outputTokens'), 0) +
    COALESCE(json_extract(metadata, '$.npc_agent.usage.inputTokens'),   0) +
    COALESCE(json_extract(metadata, '$.npc_agent.usage.outputTokens'),  0)
  ), 0) AS total
  FROM turns
  WHERE metadata IS NOT NULL
    AND date(created_at) = date('now')
`)

export function todaysTokens(): number {
  const row = todaysTokensStmt.get() as { total: number }
  return row.total
}

export function dailyTokenLimit(): number {
  const raw = process.env.DAILY_TOKEN_LIMIT
  if (!raw) return DEFAULT_DAILY_TOKEN_LIMIT
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_TOKEN_LIMIT
}

export function isOverDailyLimit(): boolean {
  return todaysTokens() >= dailyTokenLimit()
}

import { db } from '@/lib/db'

const DEFAULT_DAILY_TOKEN_LIMIT = 200_000

// Sums every recorded narrator / extractor / classifier token (input + output)
// for the current UTC day. Reads the existing turns.metadata shapes written by
// src/app/api/chat/route.ts onFinish — no new schema. created_at is stored via
// datetime('now') which is UTC, so date(created_at) = date('now') is a UTC-day
// match.
const todaysTokensStmt = db.prepare(`
  SELECT COALESCE(SUM(
    COALESCE(json_extract(metadata, '$.narrator.usage.inputTokens'),    0) +
    COALESCE(json_extract(metadata, '$.narrator.usage.outputTokens'),   0) +
    COALESCE(json_extract(metadata, '$.extractor.usage.inputTokens'),   0) +
    COALESCE(json_extract(metadata, '$.extractor.usage.outputTokens'),  0) +
    COALESCE(json_extract(metadata, '$.classifier.usage.inputTokens'),  0) +
    COALESCE(json_extract(metadata, '$.classifier.usage.outputTokens'), 0)
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

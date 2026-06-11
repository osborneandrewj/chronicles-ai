import 'server-only'

import { db, getUsageTotals, type UsageTotals } from '@/lib/db'
import type { UsageRepository } from '@/domain/ports/usage-repository'

// SQLite adapter for UsageRepository (spec §5.1-P1). The per-world cost-footer
// totals delegate to `getUsageTotals` in db.ts. The daily-cap aggregation
// (formerly inlined in `cost-cap.ts`) now lives here as a prepared statement
// parametrized on the UTC day supplied by the Clock port — so the SQL stops
// hardcoding `date('now')` and the day boundary is decided in the application.
//
// Key set mirrors `cost-cap.ts`: narrator + archivist + extractor (pre-v0.5)
// + classifier + npc_agent, input and output, so the cap never undercounts.
const todaysTokensStmt = db.prepare<[string]>(`
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
    AND date(created_at) = ?
`)

export class SqliteUsageRepository implements UsageRepository {
  totalsForWorld(worldId: number): Promise<UsageTotals> {
    return Promise.resolve(getUsageTotals(worldId))
  }

  todaysTokenTotal(today: string): Promise<number> {
    const row = todaysTokensStmt.get(today) as { total: number }
    return Promise.resolve(row.total)
  }
}

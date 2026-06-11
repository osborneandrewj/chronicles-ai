import 'server-only'

import type { UsageTotals } from '@/domain/entities'
import type { UsageRepository } from '@/domain/ports/usage-repository'

import type { MongoContext } from '../mongo-context'

// Mongo UsageRepository (spec §4.2, §5.1-P1). `metadata` is native BSON, so the
// SQLite `json_extract` SUMs become an in-JS reduction over the agent usage
// blocks. The key set mirrors the SQLite repos exactly (narrator + archivist +
// the legacy extractor key + classifier + npc_agent), so cost totals stay
// continuous across the v0.5 cutover and the daily cap never undercounts.

type AgentUsage = { usage?: { inputTokens?: number; outputTokens?: number } }

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function agentIn(meta: Record<string, unknown>, key: string): number {
  return n((meta[key] as AgentUsage | undefined)?.usage?.inputTokens)
}
function agentOut(meta: Record<string, unknown>, key: string): number {
  return n((meta[key] as AgentUsage | undefined)?.usage?.outputTokens)
}

export class MongoUsageRepository implements UsageRepository {
  constructor(private readonly ctx: MongoContext) {}

  async totalsForWorld(worldId: number): Promise<UsageTotals> {
    const docs = await this.ctx.models.Turn.find({ worldId })
      .select({ metadata: 1 })
      .lean()
    const totals: UsageTotals = {
      turns: 0,
      narratorInput: 0,
      narratorOutput: 0,
      archivistInput: 0,
      archivistOutput: 0,
      npcAgentInput: 0,
      npcAgentOutput: 0,
    }
    for (const d of docs) {
      const meta = (d.metadata ?? {}) as Record<string, unknown>
      if (Object.keys(meta).length === 0) continue
      totals.turns += 1
      totals.narratorInput += agentIn(meta, 'narrator')
      totals.narratorOutput += agentOut(meta, 'narrator')
      totals.archivistInput += agentIn(meta, 'archivist') + agentIn(meta, 'extractor')
      totals.archivistOutput += agentOut(meta, 'archivist') + agentOut(meta, 'extractor')
      totals.npcAgentInput += agentIn(meta, 'npc_agent')
      totals.npcAgentOutput += agentOut(meta, 'npc_agent')
    }
    return totals
  }

  async todaysTokenTotal(today: string): Promise<number> {
    // `today` is a UTC `YYYY-MM-DD` (from the Clock port). Build the UTC-day
    // bounds and reduce the usage keys that back the cap.
    const start = new Date(`${today}T00:00:00.000Z`)
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const docs = await this.ctx.models.Turn.find({
      createdAt: { $gte: start, $lt: end },
    })
      .select({ metadata: 1 })
      .lean()
    let total = 0
    for (const d of docs) {
      const meta = (d.metadata ?? {}) as Record<string, unknown>
      if (Object.keys(meta).length === 0) continue
      for (const key of ['narrator', 'archivist', 'extractor', 'classifier', 'npc_agent']) {
        total += agentIn(meta, key) + agentOut(meta, key)
      }
    }
    return total
  }
}

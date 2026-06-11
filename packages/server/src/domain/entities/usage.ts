// Aggregated per-world token usage totals across agents. Pure type declaration
// (spec §3.3). Sums include the legacy `extractor` key alongside `archivist` so
// totals stay continuous across the v0.5 cutover (see UsageRepository).

export type UsageTotals = {
  turns: number
  narratorInput: number
  narratorOutput: number
  archivistInput: number
  archivistOutput: number
  npcAgentInput: number
  npcAgentOutput: number
}

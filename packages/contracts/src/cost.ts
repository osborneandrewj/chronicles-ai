// Cost rollup DTOs. The server computes these (model IDs + per-token rates live
// in packages/server/src/infrastructure/llm/pricing.ts and MUST NOT ship in the
// client bundle). The client receives pre-computed numbers and only formats them
// (a presentation-only `formatUsd` helper, no rates).

export type AgentCostDTO = {
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cost: number
}

export type TtsCostDTO = {
  chars: number
  cost: number
}

export type TurnCostDTO = {
  id: number
  narrator?: AgentCostDTO
  archivist?: AgentCostDTO
  classifier?: AgentCostDTO
  npcAgent?: AgentCostDTO
  tts?: TtsCostDTO
  total: number
}

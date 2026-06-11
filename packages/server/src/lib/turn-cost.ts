import type { AgentCostDTO, TtsCostDTO, TurnCostDTO } from '@chronicles/contracts'

import { costForTts, costForUsage, type UsageLike } from '@/infrastructure/llm/pricing'

type AgentMeta = { model?: string; usage?: UsageLike } | undefined
type TtsMeta = { chars?: number } | undefined

// Server-side cost-rollup types ARE the wire DTOs (the server computes them and
// ships them straight to the client). Aliased so there is one shape, not two.
export type AgentCost = AgentCostDTO
export type TtsCost = TtsCostDTO
export type TurnCost = TurnCostDTO

function agentCost(meta: AgentMeta): AgentCost | undefined {
  if (!meta?.model || !meta.usage) return undefined
  const inputTokens = meta.usage.inputTokens ?? 0
  const outputTokens = meta.usage.outputTokens ?? 0
  const cachedInputTokens = meta.usage.cachedInputTokens ?? 0
  return {
    model: meta.model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cost: costForUsage(meta.model, meta.usage),
  }
}

function ttsCost(meta: TtsMeta): TtsCost | undefined {
  if (!meta || typeof meta.chars !== 'number' || meta.chars <= 0) return undefined
  return { chars: meta.chars, cost: costForTts(meta.chars) }
}

export function summarizeTurn(id: number, metadata: Record<string, unknown>): TurnCost {
  const narrator = agentCost(metadata.narrator as AgentMeta)
  // Read both keys so old turns (pre-v0.5 used `extractor`) keep their cost
  // attribution in the session totals during the cutover. New turns only ever
  // write to `archivist`.
  const archivist =
    agentCost(metadata.archivist as AgentMeta) ?? agentCost(metadata.extractor as AgentMeta)
  const classifier = agentCost(metadata.classifier as AgentMeta)
  const npcAgent = agentCost(metadata.npc_agent as AgentMeta)
  const tts = ttsCost(metadata.tts as TtsMeta)
  const total =
    (narrator?.cost ?? 0) +
    (archivist?.cost ?? 0) +
    (classifier?.cost ?? 0) +
    (npcAgent?.cost ?? 0) +
    (tts?.cost ?? 0)
  return { id, narrator, archivist, classifier, npcAgent, tts, total }
}

import { costForUsage, type UsageLike } from '@/lib/pricing'

type AgentMeta = { model?: string; usage?: UsageLike } | undefined

export type AgentCost = {
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cost: number
}

export type TurnCost = {
  id: number
  narrator?: AgentCost
  extractor?: AgentCost
  classifier?: AgentCost
  total: number
}

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

export function summarizeTurn(id: number, metadata: Record<string, unknown>): TurnCost {
  const narrator = agentCost(metadata.narrator as AgentMeta)
  const extractor = agentCost(metadata.extractor as AgentMeta)
  const classifier = agentCost(metadata.classifier as AgentMeta)
  const total = (narrator?.cost ?? 0) + (extractor?.cost ?? 0) + (classifier?.cost ?? 0)
  return { id, narrator, extractor, classifier, total }
}

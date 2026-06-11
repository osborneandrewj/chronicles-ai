import 'server-only'

import { HAIKU_MODEL, NARRATOR_MODEL } from '@/infrastructure/llm/model-registry'

// USD per million tokens. Update when provider prices change. Model IDs come
// from the registry so a model swap is a single edit. (CLAUDE.md: pricing lives
// in infrastructure only.) Cache-write surcharge is intentionally omitted —
// cost here is a signal, not an invoice.
type Rate = { input: number; cachedInput: number; output: number }

const RATES: Record<string, Rate> = {
  'claude-sonnet-4-6': { input: 3, cachedInput: 0.3, output: 15 },
  [HAIKU_MODEL]: { input: 1, cachedInput: 0.1, output: 5 },
  [NARRATOR_MODEL]: { input: 1.25, cachedInput: 0.2, output: 2.5 },
}

// USD per million characters synthesized. xAI Grok TTS is char-billed, not token-billed.
const TTS_RATE_PER_M_CHARS = 4.2

export function costForTts(chars: number): number {
  if (!chars || chars < 0) return 0
  return (chars * TTS_RATE_PER_M_CHARS) / 1_000_000
}

export type UsageLike = {
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
}

export function costForUsage(model: string, usage: UsageLike | undefined | null): number {
  const rate = RATES[model]
  if (!rate || !usage) return 0
  const input = usage.inputTokens ?? 0
  const cached = usage.cachedInputTokens ?? 0
  const fresh = Math.max(0, input - cached)
  const output = usage.outputTokens ?? 0
  return (fresh * rate.input + cached * rate.cachedInput + output * rate.output) / 1_000_000
}

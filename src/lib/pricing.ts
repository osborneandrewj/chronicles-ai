// USD per million tokens. Update if Anthropic prices change.
// Cache-write surcharge is intentionally omitted — cost here is a signal, not an invoice.
type Rate = { input: number; cachedInput: number; output: number }

const RATES: Record<string, Rate> = {
  'claude-sonnet-4-6': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, cachedInput: 0.1, output: 5 },
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

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  if (amount < 1) return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}

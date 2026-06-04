// Client-safe presentation helper. The cost math + model/TTS rate tables moved
// to infrastructure/llm/pricing.ts (server-only) in P4; only this pure formatter
// stays here because it ships in the client bundle (Chat.tsx). The full
// client/server pricing split lands in P6.
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  if (amount < 1) return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}

// Pure domain service (Phase A, A5) — budget-driven narrator history packing.
// The narrator's prior-turn history used a fixed split (keep the last 6 turns
// full, hard-truncate the rest to 320 chars), which starved the model of
// canonical narration. This packs full turns newest-first up to a token budget,
// prioritizing NARRATOR (assistant) turns over player turns when trimming —
// narration is canonical, so it survives compaction last — then compacts the
// overflow. No I/O; the adapter maps the result into model messages.

export type HistoryTurn = { role: 'user' | 'assistant'; content: string }

export type PackedHistoryTurn = {
  role: 'user' | 'assistant'
  // Full content when `compacted` is false; the truncated text when true.
  content: string
  compacted: boolean
}

export type PackOptions = {
  fullTokenBudget: number
  compactedChars: number
}

// ~4 chars per token is the standard rough estimate; deterministic and good
// enough for budgeting (the real tokenizer is not available in the domain).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function compact(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxChars) return collapsed
  return `${collapsed.slice(0, maxChars - 1).trimEnd()}…`
}

export function packNarratorHistory(
  history: HistoryTurn[],
  opts: PackOptions,
): PackedHistoryTurn[] {
  const keepFull = new Set<number>()
  let used = 0

  // Two passes, each newest-first, stopping the moment a turn would overflow so
  // the turns kept full are always the most recent. Assistant (narrator) turns
  // get first claim on the budget; player turns fill what remains.
  const claim = (wantRole: 'assistant' | 'user'): void => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (keepFull.has(i) || history[i].role !== wantRole) continue
      const cost = estimateTokens(history[i].content)
      if (used + cost > opts.fullTokenBudget) break
      used += cost
      keepFull.add(i)
    }
  }
  claim('assistant')
  claim('user')

  return history.map((turn, idx) =>
    keepFull.has(idx)
      ? { role: turn.role, content: turn.content, compacted: false }
      : { role: turn.role, content: compact(turn.content, opts.compactedChars), compacted: true },
  )
}

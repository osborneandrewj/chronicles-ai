import { describe, expect, it } from 'vitest'

import {
  estimateTokens,
  packNarratorHistory,
  type HistoryTurn,
} from '@/domain/services/history-packer'

const turn = (role: 'user' | 'assistant', content: string): HistoryTurn => ({ role, content })

describe('packNarratorHistory', () => {
  it('keeps every turn full when the budget is ample', () => {
    const history = [turn('user', 'a'), turn('assistant', 'b'), turn('user', 'c')]
    const packed = packNarratorHistory(history, { fullTokenBudget: 1000, compactedChars: 50 })
    expect(packed.every((p) => !p.compacted)).toBe(true)
    expect(packed.map((p) => p.content)).toEqual(['a', 'b', 'c'])
  })

  it('preserves chronological order', () => {
    const history = [turn('assistant', 'first'), turn('user', 'second'), turn('assistant', 'third')]
    const packed = packNarratorHistory(history, { fullTokenBudget: 1000, compactedChars: 50 })
    expect(packed.map((p) => p.role)).toEqual(['assistant', 'user', 'assistant'])
  })

  it('prioritizes narrator turns: a player turn is compacted before the recent narrator turn', () => {
    // Each block ~100 tokens (400 chars). Budget fits only ~1 full turn.
    const big = 'x'.repeat(400)
    const history = [
      turn('user', `${big} player-old`),
      turn('assistant', `${big} narrator-recent`),
    ]
    const packed = packNarratorHistory(history, { fullTokenBudget: 110, compactedChars: 30 })
    const narrator = packed[1]
    const player = packed[0]
    expect(narrator.compacted).toBe(false) // narration survives
    expect(player.compacted).toBe(true) // player turn yields the budget
  })

  it('keeps the most recent narrator turns full and compacts older ones', () => {
    const big = 'n'.repeat(400) // ~100 tokens each
    const history = [
      turn('assistant', `${big} oldest`),
      turn('assistant', `${big} middle`),
      turn('assistant', `${big} newest`),
    ]
    // Budget for ~2 full narrator turns.
    const packed = packNarratorHistory(history, { fullTokenBudget: 210, compactedChars: 20 })
    expect(packed[2].compacted).toBe(false) // newest full
    expect(packed[1].compacted).toBe(false) // middle full
    expect(packed[0].compacted).toBe(true) // oldest compacted
  })

  it('compacts overflow content to the char limit', () => {
    const packed = packNarratorHistory([turn('assistant', 'y'.repeat(500))], {
      fullTokenBudget: 1,
      compactedChars: 40,
    })
    expect(packed[0].compacted).toBe(true)
    expect(packed[0].content.length).toBeLessThanOrEqual(40)
  })
})

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('12345678')).toBe(2)
    expect(estimateTokens('')).toBe(0)
  })
})

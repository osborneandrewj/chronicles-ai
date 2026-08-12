import { describe, expect, it } from 'vitest'

import {
  ARCHIVIST_EXTRACT_WINDOW_ROLE_ROWS,
  assistantTurnsSinceLastSuccessfulArchivist,
  isSuccessfulArchivistMeta,
  selectArchivistExtractWindow,
  shouldRunArchivistLlmWithLag,
  type AssistantTurnForLag,
  type RoleTurn,
} from '@/domain/services/archivist-run-policy'

function turn(
  id: number,
  archivist?: Record<string, unknown>,
): AssistantTurnForLag {
  return {
    id,
    metadata: archivist ? { archivist } : {},
  }
}

describe('isSuccessfulArchivistMeta', () => {
  it('accepts LLM extract with patch and no skip/error', () => {
    expect(
      isSuccessfulArchivistMeta({
        model: 'claude-haiku-4-5-20251001',
        patch: { location: 'docks' },
      }),
    ).toBe(true)
  })

  it('accepts deterministic-archivist with patch', () => {
    expect(
      isSuccessfulArchivistMeta({
        model: 'deterministic-archivist',
        patch: { location: 'docks' },
      }),
    ).toBe(true)
  })

  it('rejects skipped blocks', () => {
    expect(
      isSuccessfulArchivistMeta({
        skipped: true,
        reason: 'no_state_change_signal',
      }),
    ).toBe(false)
  })

  it('rejects error-only blocks even without skipped', () => {
    expect(
      isSuccessfulArchivistMeta({
        model: 'claude-haiku',
        error: 'timeout',
      }),
    ).toBe(false)
  })

  it('rejects error + patch (failure does not reset lag)', () => {
    expect(
      isSuccessfulArchivistMeta({
        patch: { x: 1 },
        error: 'partial fail',
      }),
    ).toBe(false)
  })

  it('rejects missing patch', () => {
    expect(isSuccessfulArchivistMeta({ model: 'haiku' })).toBe(false)
    expect(isSuccessfulArchivistMeta(null)).toBe(false)
    expect(isSuccessfulArchivistMeta(undefined)).toBe(false)
  })
})

describe('assistantTurnsSinceLastSuccessfulArchivist', () => {
  it('returns lag 0 when the newest turn has a successful archivist', () => {
    const turns = [
      turn(1, { patch: { a: 1 } }),
      turn(2, { patch: { b: 2 } }),
    ]
    expect(assistantTurnsSinceLastSuccessfulArchivist(turns)).toEqual({
      lag: 0,
      lastSuccessTurnId: 2,
    })
  })

  it('counts skipped and missing metas toward lag', () => {
    const turns = [
      turn(1, { patch: { a: 1 } }),
      turn(2, { skipped: true, reason: 'no_state_change_signal' }),
      turn(3), // no archivist block yet
    ]
    expect(assistantTurnsSinceLastSuccessfulArchivist(turns)).toEqual({
      lag: 2,
      lastSuccessTurnId: 1,
    })
  })

  it('does not reset on error-only meta', () => {
    const turns = [
      turn(1, { patch: { a: 1 } }),
      turn(2, { error: 'boom' }),
      turn(3),
    ]
    expect(assistantTurnsSinceLastSuccessfulArchivist(turns)).toEqual({
      lag: 2,
      lastSuccessTurnId: 1,
    })
  })

  it('returns full window length when only skipped metas exist', () => {
    const turns = [
      turn(1, { skipped: true, reason: 'no_state_change_signal' }),
      turn(2, { skipped: true, reason: 'no_state_change_signal' }),
      turn(3),
    ]
    expect(assistantTurnsSinceLastSuccessfulArchivist(turns)).toEqual({
      lag: 3,
      lastSuccessTurnId: null,
    })
  })

  it('returns lag 0 and null lastSuccess on empty history', () => {
    expect(assistantTurnsSinceLastSuccessfulArchivist([])).toEqual({
      lag: 0,
      lastSuccessTurnId: null,
    })
  })

  it('resets lag at deterministic-archivist success', () => {
    const turns = [
      turn(1, { model: 'deterministic-archivist', patch: { loc: 'x' } }),
      turn(2),
    ]
    expect(assistantTurnsSinceLastSuccessfulArchivist(turns)).toEqual({
      lag: 1,
      lastSuccessTurnId: 1,
    })
  })
})

describe('shouldRunArchivistLlmWithLag', () => {
  it('runs with reason signal when signal is true, lag 0', () => {
    expect(shouldRunArchivistLlmWithLag({ signal: true, lag: 0 })).toEqual({
      run: true,
      reason: 'signal',
    })
  })

  it('skips when signal false and lag 0', () => {
    expect(shouldRunArchivistLlmWithLag({ signal: false, lag: 0 })).toEqual({
      run: false,
      reason: 'skip',
    })
  })

  it('skips when signal false and lag 1', () => {
    expect(shouldRunArchivistLlmWithLag({ signal: false, lag: 1 })).toEqual({
      run: false,
      reason: 'skip',
    })
  })

  it('runs with max_lag when lag is 2', () => {
    expect(shouldRunArchivistLlmWithLag({ signal: false, lag: 2 })).toEqual({
      run: true,
      reason: 'max_lag',
    })
  })

  it('runs with max_lag when lag is 3', () => {
    expect(shouldRunArchivistLlmWithLag({ signal: false, lag: 3 })).toEqual({
      run: true,
      reason: 'max_lag',
    })
  })

  it('prefers signal over max_lag when both apply', () => {
    expect(shouldRunArchivistLlmWithLag({ signal: true, lag: 5 })).toEqual({
      run: true,
      reason: 'signal',
    })
  })

  it('empty-history lag 0 stays skip (no force on open)', () => {
    expect(shouldRunArchivistLlmWithLag({ signal: false, lag: 0 })).toEqual({
      run: false,
      reason: 'skip',
    })
  })
})

describe('selectArchivistExtractWindow', () => {
  const rows = (n: number): RoleTurn[] =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `t${i + 1}`,
    }))

  it('falls back to last N when no last success id', () => {
    const recent = rows(10)
    const result = selectArchivistExtractWindow({
      recentTurns: recent,
      lastSuccessTurnId: null,
      cap: 4,
    })
    expect(result.window).toHaveLength(4)
    expect(result.window.map((w) => w.content)).toEqual(['t7', 't8', 't9', 't10'])
    expect(result.windowTruncated).toBe(true)
    expect(result.windowStartTurnId).toBe(7)
  })

  it('prefers turns after last successful archivist', () => {
    const recent = rows(8)
    const result = selectArchivistExtractWindow({
      recentTurns: recent,
      lastSuccessTurnId: 5,
      cap: 8,
    })
    expect(result.window.map((w) => w.content)).toEqual(['t6', 't7', 't8'])
    expect(result.windowTruncated).toBe(false)
    expect(result.windowStartTurnId).toBe(6)
    expect(result.lastSuccessTurnId).toBe(5)
  })

  it('stamps truncation when since-last-success exceeds cap', () => {
    const recent = rows(12)
    const result = selectArchivistExtractWindow({
      recentTurns: recent,
      lastSuccessTurnId: 1,
      cap: ARCHIVIST_EXTRACT_WINDOW_ROLE_ROWS,
    })
    expect(result.window).toHaveLength(ARCHIVIST_EXTRACT_WINDOW_ROLE_ROWS)
    expect(result.windowTruncated).toBe(true)
    expect(result.windowStartTurnId).toBe(12 - ARCHIVIST_EXTRACT_WINDOW_ROLE_ROWS + 1)
  })

  it('falls back to recent when after-success is empty', () => {
    const recent = rows(4)
    const result = selectArchivistExtractWindow({
      recentTurns: recent,
      lastSuccessTurnId: 99,
      cap: 4,
    })
    expect(result.window).toHaveLength(4)
    expect(result.windowTruncated).toBe(false)
  })
})

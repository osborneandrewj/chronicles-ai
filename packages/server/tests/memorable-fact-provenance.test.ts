import { describe, expect, it } from 'vitest'

import {
  MAX_MEMORABLE_FACT_LINES,
  appendFactWithProvenance,
  stripFactProvenance,
} from '@/domain/services/memorable-fact-provenance'

describe('appendFactWithProvenance', () => {
  it('annotates the first fact with its source turn', () => {
    expect(appendFactWithProvenance(null, 'Elena keeps a photograph', 5)).toBe(
      'Elena keeps a photograph [t:5]',
    )
  })

  it('appends a distinct fact on a new line', () => {
    const after = appendFactWithProvenance('Elena keeps a photograph [t:5]', 'The chronometer is frozen', 6)
    expect(after).toBe('Elena keeps a photograph [t:5]\nThe chronometer is frozen [t:6]')
  })

  it('returns the block unchanged when the append is empty (no clobber)', () => {
    const existing = 'Elena keeps a photograph [t:5]'
    expect(appendFactWithProvenance(existing, undefined, 9)).toBe(existing)
    expect(appendFactWithProvenance(existing, '   ', 9)).toBe(existing)
    expect(appendFactWithProvenance(null, undefined, 9)).toBeNull()
  })

  it('skips a verbatim duplicate that differs only by provenance suffix', () => {
    const existing = 'Elena keeps a photograph [t:5]'
    expect(appendFactWithProvenance(existing, 'Elena keeps a photograph', 8)).toBe(existing)
  })

  it('skips a case/punctuation-insensitive duplicate', () => {
    const existing = 'Elena keeps a photograph [t:5]'
    expect(appendFactWithProvenance(existing, 'elena KEEPS a photograph!', 8)).toBe(existing)
  })

  it('skips a near-duplicate by heavy token overlap', () => {
    const existing = 'Elena keeps a photograph in her pocket [t:5]'
    expect(
      appendFactWithProvenance(existing, 'Elena keeps the photograph in her pocket', 8),
    ).toBe(existing)
  })

  it('still appends a genuinely different fact', () => {
    const existing = 'Elena keeps a photograph [t:5]'
    const after = appendFactWithProvenance(existing, 'Torres carries a data pad', 8)
    expect(after).toContain('Torres carries a data pad [t:8]')
    expect(after?.split('\n')).toHaveLength(2)
  })

  it('caps the block to the most-recent N lines', () => {
    let block: string | null = null
    for (let i = 1; i <= MAX_MEMORABLE_FACT_LINES + 5; i++) {
      block = appendFactWithProvenance(block, `fact number ${i}`, i)
    }
    const lines = (block ?? '').split('\n')
    expect(lines).toHaveLength(MAX_MEMORABLE_FACT_LINES)
    // Oldest evicted, newest retained.
    expect(block).not.toContain('fact number 1 [t:1]')
    expect(block).toContain(`fact number ${MAX_MEMORABLE_FACT_LINES + 5} [t:${MAX_MEMORABLE_FACT_LINES + 5}]`)
  })
})

describe('stripFactProvenance', () => {
  it('removes the [t:N] suffix from every line', () => {
    expect(stripFactProvenance('a [t:1]\nb [t:2]')).toBe('a\nb')
  })
})

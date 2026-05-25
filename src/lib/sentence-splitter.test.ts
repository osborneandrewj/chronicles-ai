import { describe, expect, it } from 'vitest'

import { splitNewChunks, splitNewSentences } from './sentence-splitter'

describe('splitNewChunks', () => {
  it('splits on paragraph boundaries and waits for the next blank line', () => {
    const text = 'First paragraph sentence one. Sentence two.\n\nSecond paragraph still arriving'
    const { chunks, cursor } = splitNewChunks(text, 0, { flush: false })
    expect(chunks).toEqual(['First paragraph sentence one. Sentence two.'])
    // Cursor advances past the \n\n; the trailing paragraph stays buffered.
    expect(text.slice(cursor)).toBe('Second paragraph still arriving')
  })

  it('falls back to sentence boundaries when a paragraph exceeds the soft cap', () => {
    // Build a single paragraph well over 600 chars made of distinct sentences,
    // then flush so the whole thing is emitted. Every chunk must end at a
    // sentence boundary and stay under the cap.
    const sentence = 'The narrator paced the dim corridor, weighing each footfall against the lantern flame. '
    const paragraph = sentence.repeat(12).trim() // ~12 * 88 = ~1050 chars
    const { chunks, cursor } = splitNewChunks(paragraph, 0, { flush: true })

    expect(chunks.length).toBeGreaterThan(1)
    expect(cursor).toBe(paragraph.length)
    for (const c of chunks.slice(0, -1)) {
      // Soft cap honoured for every chunk except possibly the tail.
      expect(c.length).toBeLessThanOrEqual(600)
      // Each interior chunk ends on a sentence terminator.
      expect(c).toMatch(/[.!?]["')\]”’]*$/)
    }
    // Round-trips back to the original (joined with a single space).
    expect(chunks.join(' ')).toBe(paragraph)
  })

  it('flushes a mid-paragraph tail on stream end', () => {
    const text = 'A complete paragraph here.\n\nA half-written second one without'
    // Stream-in-progress: only the first paragraph emits, second one waits.
    const mid = splitNewChunks(text, 0, { flush: false })
    expect(mid.chunks).toEqual(['A complete paragraph here.'])

    // Stream ends with the same text: the remaining tail flushes as one chunk.
    const end = splitNewChunks(text, mid.cursor, { flush: true })
    expect(end.chunks).toEqual(['A half-written second one without'])
    expect(end.cursor).toBe(text.length)
  })
})

describe('splitNewSentences (deprecated alias)', () => {
  it('returns the chunks under the legacy field name', () => {
    const { sentences, cursor } = splitNewSentences('One paragraph.\n\nTwo.', 0, { flush: true })
    expect(sentences).toEqual(['One paragraph.', 'Two.'])
    expect(cursor).toBe('One paragraph.\n\nTwo.'.length)
  })
})

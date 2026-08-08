import { describe, expect, it } from 'vitest'

import { splitNewChunks, splitNewSentences } from '../src/lib/sentence-splitter'

describe('splitNewChunks (legacy multi-chunk mode, no minChars)', () => {
  it('splits on paragraph boundaries and waits for the next blank line', () => {
    const text = 'First paragraph sentence one. Sentence two.\n\nSecond paragraph still arriving'
    const { chunks, cursor } = splitNewChunks(text, 0, { flush: false })
    expect(chunks).toEqual(['First paragraph sentence one. Sentence two.'])
    // Cursor advances past the \n\n; the trailing paragraph stays buffered.
    expect(text.slice(cursor)).toBe('Second paragraph still arriving')
  })

  it('falls back to sentence boundaries when a paragraph exceeds the soft cap', () => {
    const sentence = 'The narrator paced the dim corridor, weighing each footfall against the lantern flame. '
    const paragraph = sentence.repeat(12).trim() // ~12 * 88 = ~1050 chars
    const { chunks, cursor } = splitNewChunks(paragraph, 0, { flush: true })

    expect(chunks.length).toBeGreaterThan(1)
    expect(cursor).toBe(paragraph.length)
    for (const c of chunks.slice(0, -1)) {
      expect(c.length).toBeLessThanOrEqual(600)
      expect(c).toMatch(/[.!?]["')\]”’]*$/)
    }
    expect(chunks.join(' ')).toBe(paragraph)
  })

  it('flushes a mid-paragraph tail on stream end', () => {
    const text = 'A complete paragraph here.\n\nA half-written second one without'
    const mid = splitNewChunks(text, 0, { flush: false })
    expect(mid.chunks).toEqual(['A complete paragraph here.'])

    const end = splitNewChunks(text, mid.cursor, { flush: true })
    expect(end.chunks).toEqual(['A half-written second one without'])
    expect(end.cursor).toBe(text.length)
  })
})

describe('splitNewChunks (minChars first-chunk overlap mode)', () => {
  const fullTurn =
    'Short open.\n\n' +
    'This is the second paragraph that pushes us across the minimum character floor.\n\n' +
    'Third paragraph tail one.\n\n' +
    'Fourth paragraph tail two.'
  const chunk1 =
    'Short open.\n\n' +
    'This is the second paragraph that pushes us across the minimum character floor.'
  const tail = 'Third paragraph tail one.\n\nFourth paragraph tail two.'

  it('coalesces leading sub-minChars paragraphs into the first chunk', () => {
    const { chunks, cursor } = splitNewChunks(fullTurn, 0, { minChars: 30 })
    expect(chunks).toEqual([chunk1])
    // Cursor lands at the start of the remainder, past the consumed boundary.
    expect(fullTurn.slice(cursor)).toBe(tail)
  })

  it('emits at most one chunk during streaming, leaving later paragraphs buffered', () => {
    const { chunks } = splitNewChunks(fullTurn, 0, { minChars: 30 })
    expect(chunks).toHaveLength(1)
  })

  it('emits the first paragraph alone when it already clears minChars', () => {
    const text = 'A first paragraph already long enough to clear the floor on its own.\n\nSecond.'
    const { chunks, cursor } = splitNewChunks(text, 0, { minChars: 30 })
    expect(chunks).toEqual(['A first paragraph already long enough to clear the floor on its own.'])
    expect(text.slice(cursor)).toBe('Second.')
  })

  it('falls back to a sentence boundary when no paragraph break has cleared minChars', () => {
    // Long single paragraph with sentence ends but no blank line — common
    // narrator shape. Must fire mid-stream so TTS can overlap generation.
    const s1 =
      'The corridor smelled of ozone and cold metal, every footfall ringing off the bulkheads. '
    const s2 = 'Ahead, a red status light blinked once and held. '
    const s3 = 'She checked the seal on her gauntlet and kept moving.'
    const runOn = s1 + s2 + s3
    const { chunks, cursor } = splitNewChunks(runOn, 0, { minChars: 140 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.length).toBeGreaterThanOrEqual(140)
    expect(chunks[0]).toMatch(/[.!?]["')\]”’]*$/)
    // Remainder starts after the chosen sentence boundary.
    expect(runOn.slice(cursor).length).toBeLessThan(runOn.length)
    expect(chunks[0]! + ' ' + runOn.slice(cursor).trim()).toContain('gauntlet')
  })

  it('waits when neither a paragraph nor sentence boundary has cleared minChars', () => {
    const short = 'Still building the first clause without end'
    const { chunks, cursor } = splitNewChunks(short, 0, { minChars: 140 })
    expect(chunks).toEqual([])
    expect(cursor).toBe(0)
  })

  it('reproduces the same sentence-fallback cut on partial stream and full-text replay', () => {
    const full =
      'First long enough sentence about the empty hall and the distant drums. ' +
      'Second sentence continues the beat of the scene without a blank line. ' +
      'Third closes the thought for the tail.'
    const live = splitNewChunks(full.slice(0, 200), 0, { minChars: 100 })
    const replay = splitNewChunks(full, 0, { minChars: 100 })
    expect(live.chunks).toEqual(replay.chunks)
    expect(live.cursor).toBe(replay.cursor)
  })

  it('flush+minChars emits the entire remainder as a single chunk (no soft-cap subdivision)', () => {
    const longTail = 'A long sentence that runs well past the soft cap. '.repeat(20).trim() // >600 chars
    const { chunks, cursor } = splitNewChunks(longTail, 0, { minChars: 280, flush: true })
    expect(chunks).toEqual([longTail])
    expect(cursor).toBe(longTail.length)
  })

  it('treats a short single-paragraph turn as one chunk on flush (back-compat with single-hash cache)', () => {
    const short = 'A tiny turn with no blank line.'
    // Mid-stream: nothing fires (no qualifying boundary).
    expect(splitNewChunks(short, 0, { minChars: 280 }).chunks).toEqual([])
    // On flush: the whole thing is one chunk.
    const end = splitNewChunks(short, 0, { minChars: 280, flush: true })
    expect(end.chunks).toEqual([short])
    expect(end.cursor).toBe(short.length)
  })

  it('reproduces the identical [chunk1, tail] split live (partial text) and on replay (full text)', () => {
    // Live: chunk1 is decided the moment para 2 closes, before paras 3-4 stream in.
    const partialAtChunk1 = fullTurn.slice(0, chunk1.length + 2 + 'Third par'.length)
    const live1 = splitNewChunks(partialAtChunk1, 0, { minChars: 30 })
    expect(live1.chunks).toEqual([chunk1])

    // On flush the live tail is the remainder from the chunk1 cursor.
    const liveTail = splitNewChunks(fullTurn, live1.cursor, { minChars: 30, flush: true })
    expect(liveTail.chunks).toEqual([tail])

    // Replay: same split, computed from the full text in one pass.
    const replay1 = splitNewChunks(fullTurn, 0, { minChars: 30 })
    const replayTail = splitNewChunks(fullTurn, replay1.cursor, { minChars: 30, flush: true })
    expect(replay1.chunks).toEqual([chunk1])
    expect(replayTail.chunks).toEqual([tail])

    // The two paths must agree exactly — this is what makes replay a cache hit.
    expect(live1.chunks).toEqual(replay1.chunks)
    expect(liveTail.chunks).toEqual(replayTail.chunks)
  })
})

describe('splitNewSentences (deprecated alias)', () => {
  it('returns the chunks under the legacy field name', () => {
    const { sentences, cursor } = splitNewSentences('One paragraph.\n\nTwo.', 0, { flush: true })
    expect(sentences).toEqual(['One paragraph.', 'Two.'])
    expect(cursor).toBe('One paragraph.\n\nTwo.'.length)
  })
})

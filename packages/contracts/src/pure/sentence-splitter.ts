// Incremental chunker for streaming narrator text. Pure, no deps.
// Boundary rule: paragraph break (\n{2,}). When a paragraph exceeds the soft
// cap, fall back to sentence boundaries inside it. On stream end, flush the
// remaining tail. The cap also kicks in pre-flush so audio doesn't stall on a
// run-on paragraph before its closing blank line arrives.

const SOFT_CAP_CHARS = 600
const PARAGRAPH_BOUNDARY = /\n{2,}/
const SENTENCE_BOUNDARY = /[.!?]+(["')\]”’]*)\s+/g

export interface SplitResult {
  chunks: string[]
  cursor: number
}

export interface SplitOptions {
  flush?: boolean
  // First-chunk overlap mode. When set, splitNewChunks emits AT MOST ONE chunk:
  // the text up to the first paragraph boundary whose accumulated content
  // reaches `minChars` (leading sub-minChars paragraphs are coalesced into it).
  // If no paragraph break has arrived but a sentence boundary at/after minChars
  // exists, cut there so long single-paragraph turns still start TTS mid-stream.
  // The boundary decision is deterministic across partial-stream and full-text
  // replay so cache hashes match. On flush, the entire remainder is emitted as
  // a single chunk (the prosodically-whole tail).
  minChars?: number
}

export function splitNewChunks(
  text: string,
  cursor: number,
  options: SplitOptions = {},
): SplitResult {
  const flush = options.flush ?? false

  if (options.minChars !== undefined) {
    return splitFirstChunk(text, cursor, options.minChars, flush)
  }

  const chunks: string[] = []
  let pos = cursor

  while (pos < text.length) {
    const tail = text.slice(pos)
    const boundary = tail.match(PARAGRAPH_BOUNDARY)

    if (boundary && boundary.index !== undefined) {
      const piece = tail.slice(0, boundary.index).trim()
      if (piece) emitWithSoftCap(piece, chunks)
      pos += boundary.index + boundary[0].length
      continue
    }

    if (flush) {
      const piece = tail.trim()
      if (piece) emitWithSoftCap(piece, chunks)
      pos = text.length
      break
    }

    // No paragraph boundary yet. If buffered text already exceeds the soft cap,
    // ship a sub-chunk at the last sentence boundary inside the window so we
    // don't sit on a run-on paragraph waiting for its closing blank line.
    if (tail.length >= SOFT_CAP_CHARS) {
      const cut = sentenceBoundaryBefore(tail, SOFT_CAP_CHARS)
      const piece = tail.slice(0, cut).trim()
      if (piece) chunks.push(piece)
      pos += cut
      continue
    }

    break
  }

  return { chunks, cursor: pos }
}

// First-chunk overlap extractor (see SplitOptions.minChars). On flush, returns
// the whole remainder as one chunk. Otherwise prefers the first paragraph
// boundary at/after minChars; falls back to a sentence boundary at/after
// minChars so single-paragraph narration still overlaps with generation.
function splitFirstChunk(
  text: string,
  cursor: number,
  minChars: number,
  flush: boolean,
): SplitResult {
  if (flush) {
    const piece = text.slice(cursor).trim()
    return { chunks: piece ? [piece] : [], cursor: text.length }
  }

  const re = new RegExp(PARAGRAPH_BOUNDARY.source, 'g')
  re.lastIndex = cursor
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const piece = text.slice(cursor, m.index).trim()
    if (piece.length >= minChars) {
      return { chunks: [piece], cursor: m.index + m[0].length }
    }
  }

  // No qualifying paragraph break yet. Prefer a sentence cut once we have
  // enough text — same cut on partial stream and full-text replay because we
  // take the *first* sentence end at/after minChars (deterministic).
  const fromCursor = text.slice(cursor)
  if (fromCursor.trim().length >= minChars) {
    const absCut = firstSentenceEndAtOrAfter(text, cursor, minChars)
    if (absCut != null) {
      const piece = text.slice(cursor, absCut).trim()
      if (piece.length >= minChars) {
        return { chunks: [piece], cursor: absCut }
      }
    }
  }

  return { chunks: [], cursor }
}

// Absolute index of the first sentence-ending match whose accumulated content
// from `cursor` is at least `minChars`. Returns null when none is available yet.
// Accepts either "punct + whitespace" (mid-paragraph) or "punct at end of
// available text" so a completed final sentence still fires mid-stream.
function firstSentenceEndAtOrAfter(
  text: string,
  cursor: number,
  minChars: number,
): number | null {
  const window = text.slice(cursor)
  const endBoundary = /[.!?]+(["')\]”’]*)(?:\s+|$)/g
  let m: RegExpExecArray | null
  while ((m = endBoundary.exec(window)) !== null) {
    const end = m.index + m[0].length
    const piece = window.slice(0, end).trim()
    if (piece.length >= minChars) {
      return cursor + end
    }
  }
  return null
}

// Subdivide a paragraph that exceeds the soft cap into sentence-bounded
// sub-chunks. The final tail (whatever is left under the cap) is emitted as-is.
function emitWithSoftCap(piece: string, out: string[]): void {
  let remaining = piece
  while (remaining.length > SOFT_CAP_CHARS) {
    const cut = sentenceBoundaryBefore(remaining, SOFT_CAP_CHARS)
    const sub = remaining.slice(0, cut).trim()
    if (sub) out.push(sub)
    remaining = remaining.slice(cut)
  }
  const tail = remaining.trim()
  if (tail) out.push(tail)
}

// Find the latest sentence boundary within text[0..limit]. Falls back to the
// last whitespace, then to a hard cut at limit, so we always make progress.
function sentenceBoundaryBefore(text: string, limit: number): number {
  const window = text.slice(0, limit)
  let lastEnd = -1
  SENTENCE_BOUNDARY.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SENTENCE_BOUNDARY.exec(window)) !== null) {
    lastEnd = m.index + m[0].length
  }
  if (lastEnd > 0) return lastEnd
  const lastSpace = window.lastIndexOf(' ')
  if (lastSpace > 0) return lastSpace + 1
  return limit
}

/**
 * @deprecated Use splitNewChunks. Kept for back-compat; remove in v0.6.
 */
export function splitNewSentences(
  text: string,
  cursor: number,
  options: SplitOptions = {},
): { sentences: string[]; cursor: number } {
  const { chunks, cursor: next } = splitNewChunks(text, cursor, options)
  return { sentences: chunks, cursor: next }
}

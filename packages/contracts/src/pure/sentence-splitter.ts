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
  // There is deliberately NO soft-cap forced cut in this mode, so the chunk-1
  // boundary is identical whether computed from a partial stream or the full
  // text on replay — which is what makes replay a cache hit. On flush, the
  // entire remainder is emitted as a single chunk (the prosodically-whole tail).
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
// the whole remainder as one chunk. Otherwise returns the slice up to the first
// paragraph boundary at/after `minChars`, or nothing if no such boundary has
// arrived yet. No soft-cap subdivision: the boundary must be a real paragraph
// break so the decision is deterministic across partial-stream and full-text.
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

  return { chunks: [], cursor }
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

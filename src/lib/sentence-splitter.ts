// Incremental sentence splitter for streaming narrator text. Pure, no deps.
// Boundary rule: [.!?]+ (optionally followed by closing quotes/brackets) + whitespace.
// Fallback: when no boundary appears within MAX_BUFFER_CHARS, break at the last
// whitespace in the buffered window so audio doesn't stall on a long quoted speech.

const MAX_BUFFER_CHARS = 200

export interface SplitResult {
  sentences: string[]
  cursor: number
}

export interface SplitOptions {
  flush?: boolean
}

export function splitNewSentences(
  text: string,
  cursor: number,
  options: SplitOptions = {},
): SplitResult {
  const flush = options.flush ?? false
  const sentences: string[] = []
  let pos = cursor

  while (pos < text.length) {
    const tail = text.slice(pos)
    const match = tail.match(/[.!?]+(["')\]”’]*)\s+/)

    if (match && match.index !== undefined) {
      const endIdx = match.index + match[0].length
      const piece = tail.slice(0, endIdx).trim()
      if (piece) sentences.push(piece)
      pos += endIdx
      continue
    }

    if (flush) {
      const piece = tail.trim()
      if (piece) sentences.push(piece)
      pos = text.length
      break
    }

    if (tail.length >= MAX_BUFFER_CHARS) {
      const window = tail.slice(0, MAX_BUFFER_CHARS)
      const lastSpace = window.lastIndexOf(' ')
      const cut = lastSpace > 0 ? lastSpace + 1 : MAX_BUFFER_CHARS
      const piece = window.slice(0, cut).trim()
      if (piece) sentences.push(piece)
      pos += cut
      continue
    }

    break
  }

  return { sentences, cursor: pos }
}

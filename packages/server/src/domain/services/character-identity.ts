// Pure name-identity helpers (P4/A0). No I/O. Used by character-dedup and
// archivist merge paths to distinguish descriptor placeholders from proper names
// and to build loose comparison keys for near-duplicate detection.

// Descriptor/title placeholders the archivist mints for unnamed figures always
// lead with an article ("The Attendant at the Gates", "the bartender", "A Man in
// a High-Vis Vest"). Proper names ("Jérôme Moreau") and mononyms ("Marcus") do
// not. Leading-article detection is high-precision for that generated pattern.
const ARTICLE_RE = /^(the|a|an)\s+/i

export function isDescriptorName(name: string): boolean {
  return ARTICLE_RE.test(name.trim())
}

// Loose comparison key: lowercase, drop punctuation and stop-words, collapse
// whitespace. Used to spot near-identical names. (Note: keeps non-ASCII letters
// so accented names stay distinct.)
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\b(the|a|an|of|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

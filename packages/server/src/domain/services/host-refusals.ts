// Pure: parse authored refusals and drop director mustStage lines that name a
// present host and reuse that host's refusal tokens. Bind to the authored
// strings — do not regex the player line for mood or genre.

const STOP = new Set([
  'will',
  'not',
  'never',
  'dont',
  'do',
  'the',
  'and',
  'for',
  'from',
  'with',
  'that',
  'this',
  'into',
  'onto',
  'during',
  'while',
  'their',
  'them',
  'they',
  'her',
  'his',
  'she',
  'him',
  'a',
  'an',
  'to',
  'of',
  'in',
  'on',
  'at',
  'as',
  'or',
  'nor',
  'but',
])

export function parseRefusals(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  } catch {
    return []
  }
}

export function serializeRefusals(refusals: string[]): string {
  return JSON.stringify(refusals.map((item) => item.trim()).filter(Boolean))
}

export type HostRefusalCarrier = {
  name: string
  refusals?: string[]
}

export function mustStageContradictsRefusal(
  line: string,
  hostName: string,
  refusals: string[],
): boolean {
  if (!line.trim() || refusals.length === 0) return false
  if (!lineNamesHost(line, hostName)) return false
  const haystack = line.toLowerCase()
  return refusals.some((refusal) => {
    const tokens = distinctiveTokens(refusal)
    return tokens.some((token) => haystack.includes(token))
  })
}

export function filterMustStageAgainstRefusals(
  lines: string[],
  present: HostRefusalCarrier[],
): string[] {
  const hosts = present.filter((c) => (c.refusals?.length ?? 0) > 0 && c.name.trim())
  if (hosts.length === 0) return lines
  return lines.filter(
    (line) =>
      !hosts.some((host) => mustStageContradictsRefusal(line, host.name, host.refusals ?? [])),
  )
}

function lineNamesHost(line: string, hostName: string): boolean {
  const haystack = line.toLowerCase()
  const full = hostName.trim().toLowerCase()
  if (full && haystack.includes(full)) return true
  const first = full.split(/\s+/)[0] ?? ''
  return first.length >= 3 && haystack.includes(first)
}

function distinctiveTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !STOP.has(token))
}

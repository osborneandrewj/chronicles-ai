import type {
  PlayerProfileEntryDTO,
  PlayerProfileGroupDTO,
  PlayerProfileGroupKey,
} from '@chronicles/contracts'

// The grouped-profile shape is the wire DTO — the server runs
// organizePlayerProfileFacts and ships groups in the WorldStateDTO so the client
// renders them with no domain logic (spec §2.4).
export type { PlayerProfileGroupKey }
export type PlayerProfileEntry = PlayerProfileEntryDTO
export type PlayerProfileGroup = PlayerProfileGroupDTO

const GROUP_LABELS: Record<PlayerProfileGroupKey, string> = {
  profile: 'Profile',
  gear: 'Gear',
  condition: 'Condition',
  people: 'People',
  work: 'Work',
  business: 'Business',
  discoveries: 'Discoveries',
  commitments: 'Commitments',
  other: 'Other',
}

const GROUP_ORDER: PlayerProfileGroupKey[] = [
  'profile',
  'gear',
  'condition',
  'people',
  'work',
  'business',
  'discoveries',
  'commitments',
  'other',
]

export function organizePlayerProfileFacts(value: string | null): PlayerProfileGroup[] {
  const entries = (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({
      line,
      text: stripTurnProvenance(line),
    }))

  const byKey = new Map<string, PlayerProfileEntry>()

  for (const entry of entries) {
    const key = semanticFactKey(entry.text)
    const existing = byKey.get(key)
    if (!existing || factQuality(entry.text) >= factQuality(existing.text)) {
      byKey.set(key, entry)
    }
  }

  const grouped = new Map<PlayerProfileGroupKey, PlayerProfileEntry[]>()
  for (const entry of byKey.values()) {
    const group = classifyPlayerFact(entry.text)
    grouped.set(group, [...(grouped.get(group) ?? []), entry])
  }

  return GROUP_ORDER.flatMap((key) => {
    const groupEntries = grouped.get(key)
    if (!groupEntries || groupEntries.length === 0) return []
    return [{ key, label: GROUP_LABELS[key], entries: groupEntries }]
  })
}

function classifyPlayerFact(text: string): PlayerProfileGroupKey {
  const compact = text.toLowerCase()

  if (/\b(t-?shirt|jeans|jacket|coat|uniform|wears?|dressed|hair|eyes|scar)\b/.test(compact)) {
    return 'profile'
  }
  if (/\b(wound|injur|hurt|bleed|blood|burn|bruise|scar|mark|marks|exhaust|sick|poison|drugged|restrained)\b/.test(compact)) {
    return 'condition'
  }
  if (/\b(committed|commit|deadline|ultimatum|promised|promise|chose to|must|by end of day|by 5 pm|by 5)\b/.test(compact)) {
    return 'commitments'
  }
  if (/\b(usace|linda|haft|code review|contract|contracting officer|project review|sync)\b/.test(compact)) {
    return 'work'
  }
  if (/\b(big guns|deodorant|bulk order|sample|customer|label|labels|supplier|shop|business|coffee)\b/.test(compact)) {
    return 'business'
  }
  if (/\b(discovered|found|learned|realized|vision|inscription|latin|minerva|caesar|senate|black cloak|black cloaks|forumwatch|evidence|clue)\b/.test(compact)) {
    return 'discoveries'
  }
  if (/\b(carries|carry|carrying|wears|has|keeps|pistol|gun|bracelet|phone|kia|sportage|vehicle|knife|weapon)\b/.test(compact)) {
    return 'gear'
  }
  if (/\b(maya|andy|andrew|alex|jordana|elara|texted|invited|told|alienated|relationship|brother|sister|wife|husband|friend)\b/.test(compact)) {
    return 'people'
  }
  if (/\b(package|received|signed|box|delivery|delivered)\b/.test(compact)) {
    return 'business'
  }
  return 'other'
}

function semanticFactKey(text: string): string {
  const compact = normalizeFactText(text)

  if (/\breturn when the senate falls\b/.test(compact)) return 'discovery:senate-falls'
  if (/\bminerva\b/.test(compact) && /\bcaesar\b/.test(compact)) return 'discovery:minerva-caesar'
  if (/\bpistol\b|\bgun\b/.test(compact)) return 'gear:pistol'
  if (/\bbracelet\b/.test(compact) && /\b(?:gaulish|silver|elara)\b/.test(compact)) {
    if (/\bmark|marks|exertion\b/.test(compact)) return 'condition:bracelet-marks'
    return 'gear:gaulish-bracelet'
  }
  if (/\bmaya\b/.test(compact) && /\blunch\b/.test(compact)) return 'people:maya-lunch'
  if (/\blinda\b|\bhaft\b|\busace\b/.test(compact)) return `work:${compact.slice(0, 80)}`
  if (/\bbig guns\b|\bdeodorant\b/.test(compact)) return `business:${compact.slice(0, 80)}`

  return `exact:${compact}`
}

function normalizeFactText(text: string): string {
  return stripTurnProvenance(text)
    .toLowerCase()
    .replace(/[“”'".,;:!?()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTurnProvenance(text: string): string {
  return text.replace(/\s*\[t:\d+\]\s*$/, '').trim()
}

function factQuality(text: string): number {
  const compact = stripTurnProvenance(text)
  let score = compact.length
  if (/\bloaded\b/i.test(compact)) score += 20
  if (/\bpressed into\b|\bElara\b|\bLatin\b|\binscription\b/i.test(compact)) score += 15
  return score
}

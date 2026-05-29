import type { PopulationTemplateRow, StoryThread } from '@/lib/db'

// ---------------------------------------------------------------------------
// Public types. occupancy is persisted as JSON and fed (compactly) to the
// narrator; match-tags live only in code/templates and are never persisted on
// the occupancy object.
// ---------------------------------------------------------------------------

export type OccupancyDensity = 'empty' | 'sparse' | 'moderate' | 'busy' | 'packed'
export type OccupantVisibility = 'background' | 'available' | 'foreground'
export type HookStrength = 'ambient' | 'strong'

export type OccupancyGroup = {
  id: string
  label: string
  role: string
  count: number
  visibility: OccupantVisibility
  behavior: string
  promotable: boolean
  template_id: number | null
}

export type EncounterHook = {
  id: string
  kind: 'continuation' | 'seed'
  occupant_id: string | null
  thread_id?: number
  thread_ref?: string
  premise?: string
  strength: HookStrength
  narrator_cue: string
}

export type OccupancyTraffic = {
  vehicles: string
  pedestrians: string
  notable_motion: string | null
}

export type PlaceOccupancy = {
  density: OccupancyDensity
  seed: string
  groups: OccupancyGroup[]
  traffic: OccupancyTraffic | null
  encounter_hooks: EncounterHook[]
}

export type PopulationTemplate = {
  id: number | null
  role: string
  label: string
  description: string | null
  behavior_tags: string[]
  match_tags: string[]
  seed_premise: string | null
  promotable: boolean
  weight: number
}

export type InferredProfile = {
  profileKind: string
  capacityMin: number
  capacityMax: number
  typicalRoles: string[]
  trafficLevel: 'none' | 'low' | 'medium' | 'high' | 'surge'
  matchTags: string[]
  hasTraffic: boolean
}

// ---------------------------------------------------------------------------
// Deterministic PRNG. hashSeed (cyrb53-lite) maps a stable key string to a
// 32-bit seed; mulberry32 turns that seed into a [0,1) generator. Pure — no
// Date.now/Math.random — so the same scene reproduces the same room.
// ---------------------------------------------------------------------------

export function hashSeed(key: string): number {
  let h = 1779033703 ^ key.length
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Profile inference. Existing places have no profile row; infer one from kind
// + name keywords. Inferred profiles can be persisted by the builder so the
// room is stable on return.
// ---------------------------------------------------------------------------

type ProfileDef = Omit<InferredProfile, 'profileKind'>

const PROFILE_DEFS: Record<string, ProfileDef> = {
  bar: { capacityMin: 3, capacityMax: 12, typicalRoles: ['staff', 'patrons', 'regulars'], trafficLevel: 'medium', matchTags: ['bar', 'nightlife', 'drink', 'social', 'rumor'], hasTraffic: false },
  restaurant: { capacityMin: 4, capacityMax: 16, typicalRoles: ['staff', 'diners'], trafficLevel: 'medium', matchTags: ['restaurant', 'food', 'service', 'social'], hasTraffic: false },
  cafe: { capacityMin: 2, capacityMax: 10, typicalRoles: ['staff', 'patrons'], trafficLevel: 'low', matchTags: ['cafe', 'coffee', 'quiet', 'work'], hasTraffic: false },
  hospital: { capacityMin: 4, capacityMax: 14, typicalRoles: ['staff', 'patients', 'visitors'], trafficLevel: 'high', matchTags: ['hospital', 'medical', 'sick', 'records', 'authority'], hasTraffic: false },
  office: { capacityMin: 2, capacityMax: 12, typicalRoles: ['staff', 'visitors'], trafficLevel: 'medium', matchTags: ['office', 'work', 'corporate', 'records'], hasTraffic: false },
  market: { capacityMin: 5, capacityMax: 20, typicalRoles: ['vendors', 'shoppers'], trafficLevel: 'high', matchTags: ['market', 'trade', 'goods', 'crowd', 'rumor'], hasTraffic: false },
  road: { capacityMin: 0, capacityMax: 6, typicalRoles: ['drivers', 'pedestrians'], trafficLevel: 'medium', matchTags: ['road', 'travel', 'transit', 'vehicle'], hasTraffic: true },
  transit: { capacityMin: 3, capacityMax: 18, typicalRoles: ['commuters', 'staff'], trafficLevel: 'high', matchTags: ['transit', 'travel', 'crowd', 'commute'], hasTraffic: true },
  park: { capacityMin: 0, capacityMax: 10, typicalRoles: ['visitors'], trafficLevel: 'low', matchTags: ['park', 'outdoor', 'leisure'], hasTraffic: false },
  generic: { capacityMin: 0, capacityMax: 6, typicalRoles: ['bystanders'], trafficLevel: 'low', matchTags: ['public'], hasTraffic: false },
}

const KIND_ALIASES: Record<string, string> = {
  bar: 'bar', pub: 'bar', tavern: 'bar', saloon: 'bar', nightclub: 'bar',
  restaurant: 'restaurant', diner: 'restaurant', eatery: 'restaurant',
  cafe: 'cafe', coffee: 'cafe', coffeehouse: 'cafe',
  hospital: 'hospital', clinic: 'hospital', ward: 'hospital', infirmary: 'hospital',
  office: 'office', workplace: 'office', bureau: 'office',
  market: 'market', bazaar: 'market', shop: 'market', store: 'market',
  road: 'road', street: 'road', highway: 'road', freeway: 'road', alley: 'road',
  transit: 'transit', station: 'transit', terminal: 'transit', platform: 'transit',
  park: 'park', garden: 'park', plaza: 'park', square: 'park',
}

function classify(name: string, kind: string | null): string {
  const words = `${kind ?? ''} ${name}`.toLowerCase().split(/\W+/)
  const wordSet = new Set(words)
  for (const [keyword, profileKind] of Object.entries(KIND_ALIASES)) {
    if (wordSet.has(keyword)) return profileKind
  }
  return 'generic'
}

export function inferPlaceProfile(place: { name: string; kind: string | null }): InferredProfile {
  const profileKind = classify(place.name, place.kind)
  return { profileKind, ...PROFILE_DEFS[profileKind] }
}

// Built-in templates keyed by profile kind. Used when a world has no DB-defined
// population_templates for that kind, so occupancy works out of the box and is
// deterministically testable. seed_premise !== null marks a SEED-hook carrier.
const DEFAULT_TEMPLATES: Record<string, PopulationTemplate[]> = {
  bar: [
    { id: null, role: 'staff', label: 'a bartender working the rail', description: null, behavior_tags: ['attentive'], match_tags: ['bar', 'rumor', 'social'], seed_premise: 'The bartender quietly brokers introductions for the right customer.', promotable: true, weight: 3 },
    { id: null, role: 'patrons', label: 'a clutch of off-shift workers', description: null, behavior_tags: ['loud'], match_tags: ['bar', 'social'], seed_premise: null, promotable: false, weight: 4 },
    { id: null, role: 'regulars', label: 'a lone regular nursing a drink', description: null, behavior_tags: ['watchful'], match_tags: ['bar', 'rumor'], seed_premise: 'The regular has been waiting for someone to ask the right question.', promotable: true, weight: 2 },
  ],
  restaurant: [
    { id: null, role: 'staff', label: 'a harried server', description: null, behavior_tags: ['busy'], match_tags: ['restaurant', 'service'], seed_premise: null, promotable: true, weight: 3 },
    { id: null, role: 'diners', label: 'a table of diners mid-meal', description: null, behavior_tags: ['absorbed'], match_tags: ['restaurant', 'social'], seed_premise: null, promotable: false, weight: 4 },
  ],
  cafe: [
    { id: null, role: 'staff', label: 'a barista at the machine', description: null, behavior_tags: ['steady'], match_tags: ['cafe', 'coffee'], seed_premise: null, promotable: true, weight: 3 },
    { id: null, role: 'patrons', label: 'a laptop worker in the corner', description: null, behavior_tags: ['absorbed'], match_tags: ['cafe', 'work'], seed_premise: null, promotable: false, weight: 3 },
  ],
  hospital: [
    { id: null, role: 'staff', label: 'a charge nurse at the station', description: null, behavior_tags: ['guarded'], match_tags: ['hospital', 'records', 'authority'], seed_premise: 'The nurse knows which charts are missing and why.', promotable: true, weight: 3 },
    { id: null, role: 'patients', label: 'patients waiting on hard chairs', description: null, behavior_tags: ['anxious'], match_tags: ['hospital', 'sick'], seed_premise: null, promotable: false, weight: 3 },
    { id: null, role: 'visitors', label: 'a visitor pacing the corridor', description: null, behavior_tags: ['restless'], match_tags: ['hospital'], seed_premise: null, promotable: false, weight: 2 },
  ],
  office: [
    { id: null, role: 'staff', label: 'a receptionist screening arrivals', description: null, behavior_tags: ['formal'], match_tags: ['office', 'records'], seed_premise: 'The receptionist controls who gets past the front desk.', promotable: true, weight: 3 },
    { id: null, role: 'visitors', label: 'a courier waiting for a signature', description: null, behavior_tags: ['impatient'], match_tags: ['office'], seed_premise: null, promotable: false, weight: 2 },
  ],
  market: [
    { id: null, role: 'vendors', label: 'a vendor calling prices', description: null, behavior_tags: ['loud'], match_tags: ['market', 'trade', 'rumor'], seed_premise: 'The vendor trades gossip as readily as goods.', promotable: true, weight: 3 },
    { id: null, role: 'shoppers', label: 'shoppers haggling at the stalls', description: null, behavior_tags: ['busy'], match_tags: ['market', 'crowd'], seed_premise: null, promotable: false, weight: 4 },
  ],
  road: [
    { id: null, role: 'drivers', label: 'passing drivers behind glass', description: null, behavior_tags: ['transient'], match_tags: ['road', 'vehicle'], seed_premise: null, promotable: false, weight: 4 },
    { id: null, role: 'pedestrians', label: 'a pedestrian waiting to cross', description: null, behavior_tags: ['hurried'], match_tags: ['road', 'travel'], seed_premise: null, promotable: false, weight: 2 },
  ],
  transit: [
    { id: null, role: 'commuters', label: 'commuters checking the board', description: null, behavior_tags: ['impatient'], match_tags: ['transit', 'commute', 'crowd'], seed_premise: null, promotable: false, weight: 4 },
    { id: null, role: 'staff', label: 'an attendant near the gates', description: null, behavior_tags: ['watchful'], match_tags: ['transit', 'authority'], seed_premise: null, promotable: true, weight: 2 },
  ],
  park: [
    { id: null, role: 'visitors', label: 'a dog-walker on the path', description: null, behavior_tags: ['relaxed'], match_tags: ['park', 'outdoor'], seed_premise: null, promotable: false, weight: 3 },
  ],
  generic: [
    { id: null, role: 'bystanders', label: 'a few unremarkable bystanders', description: null, behavior_tags: ['incidental'], match_tags: ['public'], seed_premise: null, promotable: false, weight: 3 },
  ],
}

function parseTags(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

// DB-defined templates for the world override built-ins of the same kind;
// otherwise fall back to the built-in set. Always returns at least one.
export function resolveTemplates(
  rows: PopulationTemplateRow[],
  profileKind: string,
): PopulationTemplate[] {
  if (rows.length > 0) {
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      label: r.label,
      description: r.description,
      behavior_tags: parseTags(r.behavior_tags_json),
      match_tags: parseTags(r.match_tags_json),
      seed_premise: r.seed_premise,
      promotable: r.promotable === 1,
      weight: r.weight,
    }))
  }
  return DEFAULT_TEMPLATES[profileKind] ?? DEFAULT_TEMPLATES.generic
}

const TRAFFIC_TARGET: Record<InferredProfile['trafficLevel'], number> = {
  none: 0,
  low: 2,
  medium: 4,
  high: 7,
  surge: 11,
}

export function densityForCount(count: number, capacityMax: number): OccupancyDensity {
  if (count <= 0) return 'empty'
  const ratio = capacityMax > 0 ? count / capacityMax : 0
  if (ratio < 0.25) return 'sparse'
  if (ratio < 0.5) return 'moderate'
  if (ratio < 0.85) return 'busy'
  return 'packed'
}

function weightedPick(
  templates: PopulationTemplate[],
  rng: () => number,
): PopulationTemplate {
  const total = templates.reduce((n, t) => n + Math.max(1, t.weight), 0)
  let r = rng() * total
  for (const t of templates) {
    r -= Math.max(1, t.weight)
    if (r <= 0) return t
  }
  return templates[templates.length - 1]
}

export type GroupSource = { groupId: string; template: PopulationTemplate }

// Build bounded occupancy groups. Each iteration picks a template (weighted),
// emits one group with a small count, and stops at the capacity target or 6
// groups. Returns the parallel template sources so the hook matcher can read
// each present occupant's match-tags without persisting them.
export function buildGroups(
  profile: InferredProfile,
  templates: PopulationTemplate[],
  rng: () => number,
): { groups: OccupancyGroup[]; sources: GroupSource[]; total: number } {
  const target = Math.min(
    Math.max(TRAFFIC_TARGET[profile.trafficLevel], profile.capacityMin),
    profile.capacityMax,
  )
  const groups: OccupancyGroup[] = []
  const sources: GroupSource[] = []
  let placed = 0
  let i = 0
  while (placed < target && groups.length < 6 && templates.length > 0) {
    const template = weightedPick(templates, rng)
    const remaining = target - placed
    const rawCount = Math.max(1, Math.min(remaining, 1 + Math.floor(rng() * 3)))
    const isSingular = /^(a|an|the)\s/i.test(template.label)
    const count = isSingular ? 1 : rawCount
    const groupId = `occ_${i + 1}`
    const visibility: OccupantVisibility = template.promotable ? 'available' : 'background'
    groups.push({
      id: groupId,
      label: template.label,
      role: template.role,
      count,
      visibility,
      behavior: template.behavior_tags[0] ?? 'present',
      promotable: template.promotable,
      template_id: template.id,
    })
    sources.push({ groupId, template })
    placed += count
    i++
  }
  return { groups, sources, total: placed }
}

const MAX_HOOKS = 3

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

const CONTINUATION_CUES: Array<(label: string) => string> = [
  (label) => `${capitalize(label)} keeps half an eye on you, the way someone does when a name they've heard lately walks in.`,
  (label) => `${capitalize(label)} pauses a beat too long as you pass, as if placing you against something half-remembered.`,
  (label) => `${capitalize(label)} watches you with the wary interest of someone who knows more than they let on.`,
]

function overlapCount(a: string[], b: string[]): number {
  const setB = new Set(b)
  let n = 0
  for (const tag of a) if (setB.has(tag)) n++
  return n
}

function firstPromotable(sources: GroupSource[]): GroupSource | null {
  return sources.find((s) => s.template.promotable) ?? null
}

// Pick the promotable occupant whose template tags best overlap a tag set;
// fall back to the first promotable, else null (place-level hook).
function bestCarrier(sources: GroupSource[], tags: string[]): GroupSource | null {
  let best: GroupSource | null = null
  let bestScore = -1
  for (const s of sources) {
    if (!s.template.promotable) continue
    const score = overlapCount(s.template.match_tags, tags)
    if (score > bestScore) {
      best = s
      bestScore = score
    }
  }
  return best ?? firstPromotable(sources)
}

export function buildHooks(
  profile: InferredProfile,
  groups: OccupancyGroup[],
  sources: GroupSource[],
  activeThreads: StoryThread[],
  rng: () => number,
): EncounterHook[] {
  const hooks: EncounterHook[] = []

  // --- Continuation hooks: active threads whose relevance tags overlap the
  //     place tags ∪ a present promotable occupant's tags. Highest overlap wins.
  const scored = activeThreads
    .map((t) => {
      const tags = parseTags(t.relevance_tags_json)
      const carrier = bestCarrier(sources, tags)
      const carrierTags = carrier ? carrier.template.match_tags : []
      const score = overlapCount(tags, profile.matchTags) + overlapCount(tags, carrierTags)
      return { thread: t, carrier, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.thread.id - b.thread.id)

  for (const s of scored) {
    if (hooks.length >= MAX_HOOKS) break
    const occupantId = s.carrier ? s.carrier.groupId : null
    const occupantLabel = s.carrier
      ? groups.find((g) => g.id === s.carrier!.groupId)?.label ?? 'someone here'
      : 'someone here'
    hooks.push({
      id: `hook_${hooks.length + 1}`,
      kind: 'continuation',
      occupant_id: occupantId,
      thread_id: s.thread.id,
      thread_ref: s.thread.title,
      strength: s.score >= 2 ? 'strong' : 'ambient',
      narrator_cue: CONTINUATION_CUES[hooks.length % CONTINUATION_CUES.length](occupantLabel),
    })
  }

  // --- Seed hook: only when continuation hooks are sparse. Draw one promotable
  //     occupant whose template carries a seed_premise, weighted/seeded.
  if (hooks.length < 1) {
    const carriers = sources.filter((s) => s.template.promotable && s.template.seed_premise)
    if (carriers.length > 0) {
      const chosen = carriers[Math.floor(rng() * carriers.length)]
      const label = groups.find((g) => g.id === chosen.groupId)?.label ?? 'someone here'
      hooks.push({
        id: `hook_${hooks.length + 1}`,
        kind: 'seed',
        occupant_id: chosen.groupId,
        premise: chosen.template.seed_premise ?? undefined,
        strength: 'ambient',
        narrator_cue: `${capitalize(label)} catches your eye, weighing whether to say something.`,
      })
    }
  }

  return hooks.slice(0, MAX_HOOKS)
}


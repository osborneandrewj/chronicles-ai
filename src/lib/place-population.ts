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

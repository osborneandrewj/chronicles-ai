// Story-dossier entities (threads / clues / objectives / resources / timeline)
// + the aggregate StoryDossier. Pure type declarations (spec §3.3).

export type StoryThread = {
  id: number
  world_id: number
  title: string
  kind: 'quest' | 'mystery' | 'threat' | 'relationship' | 'background'
  status: 'active' | 'resolved' | 'failed' | 'dormant'
  summary: string | null
  stakes: string | null
  rewards: string | null
  consequences: string | null
  hidden: string | null
  relevance_tags_json: string
  source_turn_id: number | null
  resolved_turn_id: number | null
  created_at: string
  updated_at: string
}

export type StoryClue = {
  id: number
  world_id: number
  thread_id: number | null
  thread_title: string | null
  title: string
  detail: string | null
  implication: string | null
  status: 'open' | 'interpreted' | 'spent' | 'false_lead'
  source_turn_id: number | null
  created_at: string
  updated_at: string
}

export type StoryObjective = {
  id: number
  world_id: number
  thread_id: number | null
  thread_title: string | null
  title: string
  status: 'active' | 'blocked' | 'completed' | 'failed'
  detail: string | null
  blocker: string | null
  source_turn_id: number | null
  completed_turn_id: number | null
  created_at: string
  updated_at: string
}

export type StoryResource = {
  id: number
  world_id: number
  owner_character_id: number | null
  owner_name: string | null
  name: string
  kind: string | null
  status: string | null
  detail: string | null
  // Phase A (A4) — the tracked-object ledger. `held_by_character_id` is who
  // currently carries the object (NULL = world-level / not on a person);
  // `location_place_id` is where it rests when not held (NULL = on a person);
  // `salient` marks load-bearing objects the narrator must honour (a tracked
  // weapon, a stolen photograph) vs. ambient set-dressing.
  held_by_character_id: number | null
  location_place_id: number | null
  salient: number
  source_turn_id: number | null
  created_at: string
  updated_at: string
}

export type TimelineProvenance = 'turn' | 'sim'

export type TimelineEvent = {
  id: number
  world_id: number
  turn_id: number | null
  thread_id: number | null
  thread_title: string | null
  world_time: string | null
  title: string
  summary: string
  importance: number
  sim_tick: number | null
  provenance: TimelineProvenance
  created_at: string
}

export type StoryDossier = {
  threads: StoryThread[]
  clues: StoryClue[]
  objectives: StoryObjective[]
  resources: StoryResource[]
  timeline: TimelineEvent[]
}

// Hub simulation ops entities — compact intel artifacts and antagonist pressure.
// Pure type declarations; no I/O.

import type { ClearanceLevel } from './character'

export type SimRunStatus =
  | 'completed'
  | 'aborted'
  | 'death_exit'
  | 'awakening_exit'
  | 'ongoing'

export type SimRunReport = {
  id: number
  hub_world_id: number
  subworld_id: number
  codename: string
  genre_tags: string[]
  status: SimRunStatus
  headline: string
  summary: string
  outcomes: string[]
  anomalies: string[]
  persons_of_interest: string[]
  min_clearance: ClearanceLevel
  source_turn_id: number | null
  created_at: string
}

/** Input for upsert (store assigns id / may preserve created_at). */
export type SimRunReportUpsert = {
  hub_world_id: number
  subworld_id: number
  codename: string
  genre_tags: string[]
  status: SimRunStatus
  headline: string
  summary: string
  outcomes: string[]
  anomalies: string[]
  persons_of_interest: string[]
  min_clearance: ClearanceLevel
  source_turn_id: number | null
}

export type PlayerModel = {
  hub_world_id: number
  tactics: string[]
  soft_spots: string[]
  tells: string[]
  open_goals: string[]
  stance_toward_program: string
  antagonist_beliefs: string[]
  updated_at: string
}

export type InfluencePacket = {
  hub_world_id: number
  target_subworld_id: number | null
  plan_summary: string
  vessel: {
    role: string
    name_hint: string | null
    public_goal: string
    hidden_goal: string
  } | null
  pressure_tags: string[]
  bleed_motif_ids: string[]
}

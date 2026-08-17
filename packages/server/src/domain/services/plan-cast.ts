// Plan-eligible cast selection (Track B3 + director CAST). Cap Haiku NPC
// agent payload to the NPCs that matter this turn. When the director assigned
// slots, fill those only (plus a pending open-order target). Rest are scenic.
// Pure.

import type { DirectorCastRole } from '@/domain/entities'
import { isPlanEligible, isTransientServiceNpc } from '@/domain/services/npc-promotion'

export const PLAN_ELIGIBLE_CAST_CAP = 4

export type PlanCastCandidate = {
  id: number
  name: string
  description: string | null
  agency_level: string
  present_with_protagonist: boolean
  active_goal?: string | null
  personal_goals?: string | null
  current_focus?: string | null
  in_transit_to_place_id?: number | null
  /** Soft: mentioned on foreground director thread. */
  foregroundCast?: boolean
}

export type DirectorCastHint = {
  characterId: number
  role: DirectorCastRole
}

export type SelectPlanCastArgs = {
  candidates: PlanCastCandidate[]
  openOrderTargetId?: number | null
  directorCast?: DirectorCastHint[]
  cap?: number
}

/**
 * Select up to `cap` NPCs for the NPC agent planning prompt.
 * When director CAST has initiate/react/arrive slots, those (plus an open-order
 * target) are the set — background is scenic. Otherwise fall back to:
 * open-order target → present non-transient → en-route → foreground → agency.
 */
export function selectPlanEligibleCast(args: SelectPlanCastArgs): PlanCastCandidate[] {
  const cap = args.cap ?? PLAN_ELIGIBLE_CAST_CAP
  const openId = args.openOrderTargetId ?? null

  const eligible = args.candidates.filter((c) => {
    const transient = isTransientServiceNpc({
      name: c.name,
      description: c.description,
      active_goal: c.active_goal,
      personal_goals: c.personal_goals,
      current_focus: c.current_focus,
    })
    return isPlanEligible({
      agency_level: c.agency_level,
      present_with_protagonist: c.present_with_protagonist,
      is_transient_service: transient,
      openOrderTargetId: openId,
      characterId: c.id,
    })
  })

  const directed = pickDirectorSlots(eligible, args.directorCast ?? [], openId)
  const pool = directed ?? eligible
  const scored = pool.map((c) => ({
    c,
    score: scoreCast(c, openId, args.directorCast),
  }))
  scored.sort((a, b) => b.score - a.score || a.c.id - b.c.id)
  return scored.slice(0, Math.max(0, cap)).map((s) => s.c)
}

function pickDirectorSlots(
  eligible: PlanCastCandidate[],
  directorCast: DirectorCastHint[],
  openId: number | null,
): PlanCastCandidate[] | null {
  const roleById = new Map(directorCast.map((s) => [s.characterId, s.role]))
  const hasActionSlot = [...roleById.values()].some((r) => r !== 'background')
  if (!hasActionSlot) return null

  const picked = eligible.filter((c) => {
    if (openId != null && c.id === openId) return true
    const role = roleById.get(c.id)
    return role === 'initiate' || role === 'react' || role === 'arrive'
  })
  return picked.length > 0 ? picked : null
}

function scoreCast(
  c: PlanCastCandidate,
  openId: number | null,
  directorCast?: DirectorCastHint[],
): number {
  let s = 0
  const role = directorCast?.find((slot) => slot.characterId === c.id)?.role
  if (role === 'initiate') s += 2000
  else if (role === 'react') s += 1500
  else if (role === 'arrive') s += 1200
  if (openId != null && c.id === openId) s += 1000
  if (c.present_with_protagonist) s += 500
  if (c.in_transit_to_place_id != null && openId != null && c.id === openId) s += 200
  if (c.foregroundCast) s += 150
  s += agencyScore(c.agency_level)
  return s
}

function agencyScore(level: string): number {
  switch (level) {
    case 'local':
    case 'agent':
      return 40
    case 'nearby':
      return 25
    case 'distant':
      return 10
    case 'dormant':
      return 5
    default:
      return 0
  }
}

/**
 * Soft project continuity for Director / STATE: higher when personal_goals or
 * long_term_agenda is non-empty (Track B1).
 */
export function projectContinuityScore(c: {
  personal_goals?: string | null
  long_term_agenda?: string | null
  active_goal?: string | null
}): number {
  let s = 0
  if (c.personal_goals && c.personal_goals.trim()) s += 2
  if (c.long_term_agenda && c.long_term_agenda.trim()) s += 2
  if (c.active_goal && c.active_goal.trim()) s += 1
  return s
}

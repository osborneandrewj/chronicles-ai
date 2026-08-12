import { describe, expect, it } from 'vitest'

import {
  PLAN_ELIGIBLE_CAST_CAP,
  projectContinuityScore,
  selectPlanEligibleCast,
} from '@/domain/services/plan-cast'

describe('selectPlanEligibleCast', () => {
  it('caps at PLAN_ELIGIBLE_CAST_CAP', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `Agent ${i}`,
      description: 'crew',
      agency_level: 'local',
      present_with_protagonist: true,
    }))
    const picked = selectPlanEligibleCast({ candidates })
    expect(picked).toHaveLength(PLAN_ELIGIBLE_CAST_CAP)
  })

  it('prefers open-order target even when off-scene', () => {
    const candidates = [
      {
        id: 1,
        name: 'Present A',
        description: null,
        agency_level: 'local',
        present_with_protagonist: true,
      },
      {
        id: 2,
        name: 'Reyes',
        description: null,
        agency_level: 'npc',
        present_with_protagonist: false,
        in_transit_to_place_id: 9,
      },
    ]
    const picked = selectPlanEligibleCast({
      candidates,
      openOrderTargetId: 2,
    })
    expect(picked[0]!.id).toBe(2)
  })
})

describe('projectContinuityScore', () => {
  it('scores durable project fields', () => {
    expect(projectContinuityScore({})).toBe(0)
    expect(
      projectContinuityScore({
        personal_goals: 'reach the vault',
        long_term_agenda: 'expose Voss',
        active_goal: 'walk',
      }),
    ).toBe(5)
  })
})

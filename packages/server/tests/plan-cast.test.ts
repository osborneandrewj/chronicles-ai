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

  it('fills director initiate/react/arrive only and drops background', () => {
    const candidates = [
      {
        id: 1,
        name: 'Setnakht',
        description: null,
        agency_level: 'local',
        present_with_protagonist: true,
      },
      {
        id: 2,
        name: 'Porter',
        description: null,
        agency_level: 'local',
        present_with_protagonist: true,
      },
      {
        id: 3,
        name: 'Scribe',
        description: null,
        agency_level: 'local',
        present_with_protagonist: true,
      },
      {
        id: 4,
        name: 'Guard',
        description: null,
        agency_level: 'local',
        present_with_protagonist: true,
      },
    ]
    const picked = selectPlanEligibleCast({
      candidates,
      directorCast: [
        { characterId: 1, role: 'initiate' },
        { characterId: 2, role: 'react' },
        { characterId: 3, role: 'background' },
        { characterId: 4, role: 'background' },
      ],
    })
    expect(picked.map((c) => c.id)).toEqual([1, 2])
  })

  it('still includes an open-order target alongside director slots', () => {
    const candidates = [
      {
        id: 1,
        name: 'Present',
        description: null,
        agency_level: 'local',
        present_with_protagonist: true,
      },
      {
        id: 9,
        name: 'Reyes',
        description: null,
        agency_level: 'npc',
        present_with_protagonist: false,
        in_transit_to_place_id: 3,
      },
    ]
    const picked = selectPlanEligibleCast({
      candidates,
      openOrderTargetId: 9,
      directorCast: [{ characterId: 1, role: 'initiate' }],
    })
    expect(picked.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 9])
    expect(picked[0]!.id).toBe(1)
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

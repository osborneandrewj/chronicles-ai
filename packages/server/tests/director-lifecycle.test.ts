import { describe, expect, it } from 'vitest'

import { decideDirectorCloses } from '@/domain/services/director-lifecycle'

const thread = (id: number, title: string, status: 'active' | 'resolved' = 'active') => ({
  id,
  title,
  status,
})

const objective = (
  id: number,
  title: string,
  status: 'active' | 'completed' | 'blocked' = 'active',
) => ({ id, title, status })

describe('decideDirectorCloses', () => {
  it('returns empty when the director did not ask to close', () => {
    expect(
      decideDirectorCloses({
        beatKind: 'pressure',
        foregroundThreadId: 1,
        suggestResolveThreadIds: [],
        suggestCompleteObjectiveIds: [],
        threads: [thread(1, 'The Heist')],
        objectives: [objective(2, 'Crack the vault')],
        playerText: 'I wait',
        narratorText: 'The room holds.',
        reconcileConfirmed: false,
      }),
    ).toEqual({ threads: [], objectives: [] })
  })

  it('returns empty when asked but nothing confirmed', () => {
    expect(
      decideDirectorCloses({
        beatKind: 'close',
        foregroundThreadId: 1,
        suggestResolveThreadIds: [1],
        suggestCompleteObjectiveIds: [2],
        threads: [thread(1, 'The Heist')],
        objectives: [objective(2, 'Crack the vault')],
        playerText: 'I look around',
        narratorText: 'Morning light on the floor.',
        reconcileConfirmed: false,
      }),
    ).toEqual({ threads: [], objectives: [] })
  })

  it('closes suggested active rows when prose confirms', () => {
    const plan = decideDirectorCloses({
      beatKind: 'close',
      foregroundThreadId: 1,
      suggestResolveThreadIds: [1],
      suggestCompleteObjectiveIds: [2],
      threads: [thread(1, 'The Heist'), thread(9, 'Side job', 'resolved')],
      objectives: [objective(2, 'Crack the vault'), objective(3, 'Already done', 'completed')],
      playerText: 'I deliver the manifests',
      narratorText: 'The job is done. Case closed.',
      reconcileConfirmed: false,
    })
    expect(plan.threads).toEqual([{ id: 1, title: 'The Heist', status: 'resolved' }])
    expect(plan.objectives).toEqual([{ id: 2, title: 'Crack the vault', status: 'completed' }])
  })

  it('confirms a close beat from staged NPC plans without resolution verbs', () => {
    const plan = decideDirectorCloses({
      beatKind: 'close',
      foregroundThreadId: 1,
      suggestResolveThreadIds: [],
      suggestCompleteObjectiveIds: [],
      threads: [thread(1, 'The Sealed Papyrus')],
      objectives: [],
      playerText: 'I nod',
      narratorText: 'Setnakht takes the letter and walks into the dark.',
      reconcileConfirmed: true,
    })
    expect(plan.threads).toEqual([
      { id: 1, title: 'The Sealed Papyrus', status: 'resolved' },
    ])
  })

  it('marks failure language as failed', () => {
    const plan = decideDirectorCloses({
      beatKind: 'close',
      foregroundThreadId: 1,
      suggestResolveThreadIds: [1],
      suggestCompleteObjectiveIds: [2],
      threads: [thread(1, 'The Heist')],
      objectives: [objective(2, 'Beat the clock')],
      playerText: 'I run',
      narratorText: 'You missed the deadline; the deal collapses.',
      reconcileConfirmed: false,
    })
    expect(plan.threads[0]?.status).toBe('failed')
    expect(plan.objectives[0]?.status).toBe('failed')
  })
})

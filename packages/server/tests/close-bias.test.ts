import { describe, expect, it } from 'vitest'

import {
  patchClosesSomething,
  shouldRunCloseBiasPass,
} from '@/domain/services/close-bias'

describe('shouldRunCloseBiasPass', () => {
  it('runs when resolution language + active dossier + main did not close', () => {
    expect(
      shouldRunCloseBiasPass({
        playerText: 'I finished the job',
        narratorText: 'The mission is complete; the debt is paid in full.',
        activeDossierCount: 3,
        mainPatchClosedSomething: false,
      }),
    ).toBe(true)
  })

  it('skips when main patch already closed', () => {
    expect(
      shouldRunCloseBiasPass({
        playerText: 'done',
        narratorText: 'The quest is resolved.',
        activeDossierCount: 2,
        mainPatchClosedSomething: true,
      }),
    ).toBe(false)
  })

  it('skips empty dossier', () => {
    expect(
      shouldRunCloseBiasPass({
        playerText: 'mission complete',
        narratorText: 'You win.',
        activeDossierCount: 0,
        mainPatchClosedSomething: false,
      }),
    ).toBe(false)
  })

  it('runs on director soft suggest even without strong resolution words', () => {
    expect(
      shouldRunCloseBiasPass({
        playerText: 'I nod',
        narratorText: 'Quiet moment.',
        activeDossierCount: 2,
        mainPatchClosedSomething: false,
        directorSuggestsClose: true,
      }),
    ).toBe(true)
  })
})

describe('patchClosesSomething', () => {
  it('detects thread and objective closes', () => {
    expect(patchClosesSomething({ story_threads: [{ status: 'resolved' }] })).toBe(true)
    expect(patchClosesSomething({ story_objectives: [{ status: 'completed' }] })).toBe(true)
    expect(patchClosesSomething({ story_threads: [{ status: 'active' }] })).toBe(false)
  })
})

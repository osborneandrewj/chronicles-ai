import { describe, expect, it } from 'vitest'

import {
  hasResolutionStorySignal,
  hasRichStorySignal,
  shouldRunArchivistLlm,
} from '@/domain/services/story-signal'

describe('hasRichStorySignal', () => {
  it('fires on discovery/danger language', () => {
    expect(
      hasRichStorySignal(
        'I hurl my javelin at the scout',
        'The scout dies, an ambush map in his pouch',
      ),
    ).toBe(true)
  })

  it('is quiet on routine continuation', () => {
    expect(hasRichStorySignal('we continue', 'You walk on beneath the canopy.')).toBe(false)
  })
})

describe('hasResolutionStorySignal', () => {
  it('fires on completion / mission-complete language', () => {
    expect(hasResolutionStorySignal('I hand over the manifests', 'The job is done.')).toBe(true)
    expect(hasResolutionStorySignal('', 'Case closed. The captain nods.')).toBe(true)
    expect(hasResolutionStorySignal('', 'Mission complete — you are dismissed.')).toBe(true)
  })

  it('fires on failure / missed deadline language', () => {
    expect(hasResolutionStorySignal('', 'You missed the deadline; the deal collapses.')).toBe(true)
    expect(hasResolutionStorySignal('', 'The attempt fails in the rain.')).toBe(true)
  })

  it('fires on debt-paid style phrases', () => {
    expect(hasResolutionStorySignal('', 'The debt is paid in full at last.')).toBe(true)
  })

  it('stays quiet on ambient prose without outcome language', () => {
    expect(hasResolutionStorySignal('I look around', 'Morning light spills across the plaza.')).toBe(
      false,
    )
    expect(hasResolutionStorySignal('we walk on', 'Rain ticks on the leaves.')).toBe(false)
  })

  it('does not fire on bare ambient uses of clear / pay alone', () => {
    expect(hasResolutionStorySignal('', 'She smiles to clear the tension.')).toBe(false)
    expect(hasResolutionStorySignal('', 'Pay attention to the wind.')).toBe(false)
  })
})

describe('shouldRunArchivistLlm', () => {
  it('runs on rich story signal regardless of dossier', () => {
    expect(
      shouldRunArchivistLlm('I discover a clue', 'A map falls from the pouch.', false, 0),
    ).toBe(true)
  })

  it('runs on resolution language when active dossier rows exist', () => {
    expect(
      shouldRunArchivistLlm('I deliver the manifests', 'The job is done.', false, 2),
    ).toBe(true)
  })

  it('does not run on resolution language alone when dossier is empty', () => {
    expect(
      shouldRunArchivistLlm('I deliver the manifests', 'The job is done.', false, 0),
    ).toBe(false)
  })

  it('stays quiet on ambient prose with no signal', () => {
    expect(
      shouldRunArchivistLlm('we continue', 'You walk on beneath the canopy.', false, 3),
    ).toBe(false)
  })

  it('runs travel language when no deterministic patch', () => {
    expect(shouldRunArchivistLlm('I leave for the docks', 'You go to the quay.', false, 0)).toBe(
      true,
    )
  })
})

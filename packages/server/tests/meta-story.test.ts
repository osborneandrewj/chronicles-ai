import { describe, expect, it } from 'vitest'

import { ARC_ENGINES, getArcEngine, pickArcEngine } from '@/domain/services/arc-engines'
import { selectBleedThreads } from '@/domain/services/select-bleed-threads'
import { StubMetaStoryGenerator } from '@/infrastructure/world-gen/stub-meta-story-generator'

describe('arc engines', () => {
  it('offers several distinct techno-thriller spines', () => {
    expect(ARC_ENGINES.length).toBeGreaterThanOrEqual(5)
    expect(new Set(ARC_ENGINES.map((a) => a.id)).size).toBe(ARC_ENGINES.length)
  })

  it('picks deterministically under a seed and always returns a real engine', () => {
    expect(pickArcEngine(3).id).toBe(pickArcEngine(3).id)
    for (let s = 0; s < 10; s++) {
      expect(getArcEngine(pickArcEngine(s).id)).toBeTruthy()
    }
  })
})

describe('StubMetaStoryGenerator', () => {
  it('builds a coherent bible: ascending acts, bleed motifs, 4-way endgame fork', async () => {
    const gen = new StubMetaStoryGenerator()
    const arcEngine = pickArcEngine(1)
    const bible = await gen.generate({
      hubName: 'The Lighthouse',
      hubPremise: 'a remote signal station',
      arcEngine,
      genreLabels: ['Ancient Rome', 'The Viking Age'],
      seed: 1,
    })
    expect(bible.arcEngineId).toBe(arcEngine.id)
    expect(bible.acts.length).toBeGreaterThanOrEqual(5)
    // Escalation ladder thresholds are non-decreasing.
    const thresholds = bible.acts.map((a) => a.lucidityThreshold)
    expect([...thresholds].sort((x, y) => x - y)).toEqual(thresholds)
    expect(bible.bleedMotifs.length).toBeGreaterThanOrEqual(1)
    expect(bible.endgameFork.length).toBe(4)
  })
})

describe('selectBleedThreads', () => {
  it('returns up to max motifs, deterministically', () => {
    const motifs = ['a recurring face', 'a phrase that triggers a blackout', 'an impossible object', 'a hum']
    const a = selectBleedThreads(motifs, { max: 2, seed: 7 })
    const b = selectBleedThreads(motifs, { max: 2, seed: 7 })
    expect(a).toEqual(b)
    expect(a).toHaveLength(2)
    a.forEach((m) => expect(motifs).toContain(m))
  })

  it('returns the whole pool when it is at or below max', () => {
    expect(selectBleedThreads(['one'], { max: 3 })).toEqual(['one'])
    expect(selectBleedThreads([], { max: 3 })).toEqual([])
  })
})

import { afterEach, describe, expect, it } from 'vitest'

import { __resetContainerForTests, getContainer } from '@/composition/container'
import { StubTimePassageEstimator } from '@/infrastructure/world-gen/stub-time-passage-estimator'

// Unit tests for the deterministic StubTimePassageEstimator (starship P6) plus a
// wiring check that the container exposes a TimePassageEstimator. The stub backs
// tests + the offline scripts: it returns a fixed, modest non-zero span per beat
// so the prose-driven ship-clock advances predictably with no LLM spend.

describe('StubTimePassageEstimator', () => {
  it('returns a fixed, modest non-zero elapsed span', async () => {
    const estimate = await new StubTimePassageEstimator().estimate({
      narration: 'Rook nodded to the captain and crossed to the viewport.',
      priorWorldTime: 'Day 3 — early morning (~06:30)',
    })

    expect(estimate.elapsedMinutes).toBeGreaterThan(0)
    expect(estimate.elapsedMinutes).toBe(5)
  })

  it('is deterministic regardless of the narration length', async () => {
    const stub = new StubTimePassageEstimator()
    const short = await stub.estimate({ narration: 'A nod.', priorWorldTime: null })
    const long = await stub.estimate({
      narration: 'A '.repeat(500) + 'long, sprawling watch of work.',
      priorWorldTime: 'Day 1 — midday (~12:00)',
    })

    expect(short.elapsedMinutes).toBe(long.elapsedMinutes)
  })
})

describe('container wiring', () => {
  afterEach(() => {
    __resetContainerForTests()
  })

  it('exposes a TimePassageEstimator on the SQLite container', () => {
    const { timePassage } = getContainer()
    expect(timePassage).toBeDefined()
    expect(typeof timePassage.estimate).toBe('function')
  })
})

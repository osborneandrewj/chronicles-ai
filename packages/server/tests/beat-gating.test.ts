import { describe, expect, it } from 'vitest'

import type { CharacterRelationship } from '@/domain/entities'
import { groupMaxTension, isHighStakesBeat, shouldEmitBeat } from '@/domain/services/beat-gating'

// Pure gate authorizing an LLM beat for a co-located group of NPCs. A beat fires
// only when (a) the cooldown has elapsed since the last beat AND (b) some
// relationship among the group carries enough |valence| (tension or strong bond)
// to be worth spending an LLM call on. Deterministic; the only thing that
// authorizes LLM spend in the forward sim.

function rel(
  from_character_id: number,
  to_character_id: number,
  valence: number,
): CharacterRelationship {
  return {
    id: from_character_id * 1000 + to_character_id,
    world_id: 1,
    from_character_id,
    to_character_id,
    kind: null,
    valence,
    note: null,
    updated_at: null,
  }
}

describe('shouldEmitBeat', () => {
  it('emits when cooldown elapsed and a relationship clears the tension threshold', () => {
    expect(
      shouldEmitBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 2, 0.8)],
        currentTick: 10,
        lastBeatTick: 5,
        cooldownTicks: 3,
        tensionThreshold: 0.5,
      }),
    ).toBe(true)
  })

  it('emits on a strong negative bond (rivalry) — |valence| is what matters', () => {
    expect(
      shouldEmitBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 2, -0.7)],
        currentTick: 10,
        lastBeatTick: 5,
        cooldownTicks: 3,
        tensionThreshold: 0.5,
      }),
    ).toBe(true)
  })

  it('blocks when the cooldown has not elapsed, even with high tension', () => {
    expect(
      shouldEmitBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 2, 0.9)],
        currentTick: 7,
        lastBeatTick: 5,
        cooldownTicks: 3,
        tensionThreshold: 0.5,
      }),
    ).toBe(false)
  })

  it('blocks when every relationship is below the tension threshold', () => {
    expect(
      shouldEmitBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 2, 0.2)],
        currentTick: 10,
        lastBeatTick: 5,
        cooldownTicks: 3,
        tensionThreshold: 0.5,
      }),
    ).toBe(false)
  })

  it('never emits for a group with no relationship among its members', () => {
    expect(
      shouldEmitBeat({
        characterIds: [1, 2],
        relationships: [rel(3, 4, 0.9)],
        currentTick: 10,
        lastBeatTick: null,
        cooldownTicks: 3,
        tensionThreshold: 0.5,
      }),
    ).toBe(false)
  })

  it('emits on the first beat (lastBeatTick null) when tension clears the threshold', () => {
    expect(
      shouldEmitBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 2, 0.6)],
        currentTick: 0,
        lastBeatTick: null,
        cooldownTicks: 3,
        tensionThreshold: 0.5,
      }),
    ).toBe(true)
  })

  it('emits exactly when the cooldown boundary is reached (>=)', () => {
    expect(
      shouldEmitBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 2, 0.9)],
        currentTick: 8,
        lastBeatTick: 5,
        cooldownTicks: 3,
        tensionThreshold: 0.5,
      }),
    ).toBe(true)
  })

  it('treats a relationship at the threshold as sufficient (>=)', () => {
    expect(
      shouldEmitBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 2, 0.5)],
        currentTick: 10,
        lastBeatTick: 5,
        cooldownTicks: 3,
        tensionThreshold: 0.5,
      }),
    ).toBe(true)
  })

  it('ignores relationships that touch a non-member of the group', () => {
    expect(
      shouldEmitBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 9, 0.95)],
        currentTick: 10,
        lastBeatTick: 5,
        cooldownTicks: 3,
        tensionThreshold: 0.5,
      }),
    ).toBe(false)
  })

  it('never emits for a solo group (no pair can carry a relationship)', () => {
    expect(
      shouldEmitBeat({
        characterIds: [1],
        relationships: [rel(1, 2, 0.9)],
        currentTick: 10,
        lastBeatTick: null,
        cooldownTicks: 3,
        tensionThreshold: 0.5,
      }),
    ).toBe(false)
  })
})

describe('groupMaxTension', () => {
  it('returns the maximum |valence| among group-internal edges', () => {
    expect(
      groupMaxTension({
        characterIds: [1, 2, 3],
        relationships: [rel(1, 2, -0.8), rel(2, 3, 0.4), rel(1, 3, 0.6)],
        highStakesThreshold: 0.7,
      }),
    ).toBeCloseTo(0.8, 6)
  })

  it('returns 0 when no relationships exist within the group', () => {
    expect(
      groupMaxTension({
        characterIds: [1, 2],
        relationships: [rel(3, 4, 0.9)],
        highStakesThreshold: 0.7,
      }),
    ).toBe(0)
  })

  it('ignores relationships that touch a non-member', () => {
    expect(
      groupMaxTension({
        characterIds: [1, 2],
        relationships: [rel(1, 9, 0.95), rel(1, 2, 0.3)],
        highStakesThreshold: 0.7,
      }),
    ).toBeCloseTo(0.3, 6)
  })
})

describe('isHighStakesBeat', () => {
  it('returns true when peak tension clears the high-stakes threshold', () => {
    expect(
      isHighStakesBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 2, -0.9)],
        highStakesThreshold: 0.7,
      }),
    ).toBe(true)
  })

  it('returns true at exactly the threshold (>=)', () => {
    expect(
      isHighStakesBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 2, 0.7)],
        highStakesThreshold: 0.7,
      }),
    ).toBe(true)
  })

  it('returns false when peak tension is below the threshold', () => {
    expect(
      isHighStakesBeat({
        characterIds: [1, 2],
        relationships: [rel(1, 2, 0.5)],
        highStakesThreshold: 0.7,
      }),
    ).toBe(false)
  })

  it('returns false when no group-internal relationships exist', () => {
    expect(
      isHighStakesBeat({
        characterIds: [1, 2],
        relationships: [rel(3, 4, 0.99)],
        highStakesThreshold: 0.7,
      }),
    ).toBe(false)
  })
})

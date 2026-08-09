import { describe, expect, it } from 'vitest'

import {
  estimateTurnMinutes,
  hasExplicitTimeJump,
  mergeElapsedMinutes,
  minutesToWorldTime,
  resolveClockMinutes,
  tryParseWorldTime,
  worldTimeToMinutes,
} from '@/domain/services/narrative-clock'
import { worldTimeBand } from '@/domain/services/world-clock'

describe('minutesToWorldTime', () => {
  it('renders Day 1 at the baseline (00:00) as late night with clock token', () => {
    const { worldTime, band } = minutesToWorldTime(0)
    expect(worldTime).toBe('Day 1 — late night (~00:00)')
    expect(band).toBe('night')
  })

  it('renders band-only phrase when clock token is omitted (open worlds)', () => {
    const minutes = 2 * 1440 + 19 * 60
    const { worldTime, band } = minutesToWorldTime(minutes, { includeClockToken: false })
    expect(worldTime).toBe('Day 3 — evening')
    expect(band).toBe('evening')
    expect(worldTime).not.toMatch(/~/)
  })

  it('rolls the day over every 1440 minutes', () => {
    const minutes = 2 * 1440 + 6 * 60 + 30
    const { worldTime, band } = minutesToWorldTime(minutes)
    expect(worldTime).toBe('Day 3 — early morning (~06:30)')
    expect(band).toBe('morning')
  })

  it('round-trips every rendered phrase through worldTimeBand to the same band', () => {
    for (let minutes = 0; minutes < 1440; minutes += 15) {
      const { worldTime, band } = minutesToWorldTime(minutes)
      expect(worldTimeBand(worldTime)).toBe(band)
    }
  })
})

describe('tryParseWorldTime / resolveClockMinutes', () => {
  it('parses Day N with clock token', () => {
    const r = tryParseWorldTime('Day 3 — early morning (~06:30)')
    expect(r).toEqual({ ok: true, minutes: 2 * 1440 + 6 * 60 + 30 })
  })

  it('parses Day 1, morning (Cluster Psi-1 seed)', () => {
    const r = tryParseWorldTime('Day 1, morning')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.minutes).toBe(8 * 60)
  })

  it('reports unparseable free text instead of inventing Day 1 midday', () => {
    expect(tryParseWorldTime('just after the market opens')).toEqual({
      ok: false,
      reason: 'unparseable',
    })
  })

  it('resolveClockMinutes prefers stored counter', () => {
    expect(
      resolveClockMinutes({
        storedMinutes: 500,
        worldTime: 'Day 9 — morning',
      }),
    ).toBe(500)
  })

  it('resolveClockMinutes backfills from parseable world_time', () => {
    expect(
      resolveClockMinutes({
        storedMinutes: null,
        worldTime: 'Day 2 — morning',
      }),
    ).toBe(1440 + 8 * 60)
  })

  it('resolveClockMinutes holds on unparseable (does not jump to Day 1 midday)', () => {
    expect(
      resolveClockMinutes({
        storedMinutes: null,
        worldTime: 'just after the market opens',
        holdMinutes: 400,
      }),
    ).toBe(400)
  })

  it('worldTimeToMinutes still defaults empty to midday for legacy callers', () => {
    expect(worldTimeToMinutes(null)).toBe(12 * 60)
  })
})

describe('estimateTurnMinutes', () => {
  it('idle/observe is 2–5 minutes', () => {
    expect(
      estimateTurnMinutes({
        stance: 'observe',
        sceneChanged: false,
        travelled: false,
        narrationLength: 100,
      }),
    ).toBe(2)
    expect(
      estimateTurnMinutes({
        stance: 'observe',
        sceneChanged: false,
        travelled: false,
        narrationLength: 2000,
      }),
    ).toBe(5)
  })

  it('dialogue/interaction is 10–20 minutes', () => {
    expect(
      estimateTurnMinutes({
        stance: 'say',
        sceneChanged: false,
        travelled: false,
        narrationLength: 100,
      }),
    ).toBe(10)
    expect(
      estimateTurnMinutes({
        stance: 'act',
        sceneChanged: false,
        travelled: false,
        narrationLength: 2000,
      }),
    ).toBe(20)
  })

  it('travel / scene change is 30–90 minutes', () => {
    expect(
      estimateTurnMinutes({
        stance: 'act',
        sceneChanged: true,
        travelled: true,
        narrationLength: 100,
      }),
    ).toBe(30)
    expect(
      estimateTurnMinutes({
        stance: 'act',
        sceneChanged: true,
        travelled: true,
        narrationLength: 2000,
      }),
    ).toBe(90)
  })
})

describe('hasExplicitTimeJump / mergeElapsedMinutes', () => {
  it('gates LLM on jump language', () => {
    expect(hasExplicitTimeJump('the next morning you wake')).toBe(true)
    expect(hasExplicitTimeJump('hours pass in silence')).toBe(true)
    expect(hasExplicitTimeJump('by nightfall the gates close')).toBe(true)
    expect(hasExplicitTimeJump('you nod once and wait')).toBe(false)
  })

  it('merge is max, never sum', () => {
    expect(mergeElapsedMinutes(30, 480)).toBe(480)
    expect(mergeElapsedMinutes(30, 5)).toBe(30)
    expect(mergeElapsedMinutes(30, null)).toBe(30)
  })
})

import { describe, expect, it } from 'vitest'

import { detectSubworldExit } from '@/domain/services/detect-subworld-exit'

describe('detectSubworldExit', () => {
  it('detects death from the narration', () => {
    expect(detectSubworldExit('', 'The blade finds your heart and you die.')?.kind).toBe('death')
    expect(detectSubworldExit('', 'You bleed out on the cold stone.')?.kind).toBe('death')
  })

  it('detects literary death the narrator actually writes', () => {
    // Verbatim-style lines from the Iteration Cradle playthrough.
    expect(
      detectSubworldExit('', 'a single clean shock that stills the frantic beat of your pulse.')?.kind,
    ).toBe('death')
    expect(detectSubworldExit('', 'You lie motionless on the Via Sacra.')?.kind).toBe('death')
    expect(
      detectSubworldExit('', 'the wound in your chest having already stilled every sense.')?.kind,
    ).toBe('death')
  })

  it('does not fire on a non-fatal wound', () => {
    expect(detectSubworldExit('', 'The blade opens a shallow line across your forearm.')).toBeNull()
    expect(detectSubworldExit('', 'His thrust bites into the meat of your side; you stagger.')).toBeNull()
  })

  it('detects awakening from the simulation', () => {
    expect(
      detectSubworldExit('', 'You gasp awake in the tank, fluid draining around you.')?.kind,
    ).toBe('awakening')
    expect(detectSubworldExit('', 'The simulation collapses around you.')?.kind).toBe('awakening')
    expect(
      detectSubworldExit('I tear the wires free', 'You are wrenched out of the cradle.')?.kind,
    ).toBe('awakening')
  })

  it('prefers awakening when death and awakening co-occur (the surfacing moment)', () => {
    expect(
      detectSubworldExit('', 'You die — and wake inside the tank, lungs burning.')?.kind,
    ).toBe('awakening')
  })

  it('does not fire on ordinary sleep, injury, or mention of a simulation', () => {
    expect(detectSubworldExit('', 'You wake at dawn, stiff from the cold ground.')).toBeNull()
    expect(detectSubworldExit('', 'The wound is deep but you press on.')).toBeNull()
    expect(detectSubworldExit('', 'The simulation has run for three days now.')).toBeNull()
    expect(detectSubworldExit('I go to sleep', 'You close your eyes.')).toBeNull()
  })
})

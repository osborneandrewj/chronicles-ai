import { describe, expect, it } from 'vitest'

import {
  detectSubworldExit,
  stripQuotedDialogue,
} from '@/domain/services/detect-subworld-exit'

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

  it('does not fire on NPC threat-speech inside curly quotes (Sequence Vigil / Meridian)', () => {
    // Verbatim shape from Sequence Vigil seq 891 — Merit dialogue, not player death.
    const prose = [
      'Merit-who-tends twists her grip tighter across your chest.',
      'Her voice drops to a raw whisper, southern accent thick with fear.',
      '',
      '“The Pharaoh is dying. That is why the letter came. That is why the binding woke.',
      'You confess to the palace now, you die with him—the oath will not let you speak',
      'a name the court needs kept silent. I will not watch it unmake you on the palace steps.”',
      '',
      'Merit’s frame stays locked over yours, her demand clear in the unrelenting hold.',
    ].join('\n')
    expect(detectSubworldExit('No, not a scribe, the Pharaoh himself must be told.', prose)).toBeNull()
  })

  it('does not fire on straight-quoted conditional death threats', () => {
    expect(
      detectSubworldExit(
        '',
        'She leans in. "Cross me and you die with the rest of them." You hold still.',
      ),
    ).toBeNull()
  })

  it('still detects unquoted terminal death after dialogue was stripped', () => {
    expect(
      detectSubworldExit(
        '',
        'She whispers, "run." The blade finds your heart and you die.',
      )?.kind,
    ).toBe('death')
  })
})

describe('stripQuotedDialogue', () => {
  it('removes curly and straight quoted spans', () => {
    expect(stripQuotedDialogue('A “you die with him” B').replace(/\s+/g, ' ').trim()).toBe('A B')
    expect(stripQuotedDialogue('A "you die" B').replace(/\s+/g, ' ').trim()).toBe('A B')
  })
})

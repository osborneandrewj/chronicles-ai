import { describe, expect, it } from 'vitest'

import { formatNarratorTurnGuidance } from '@/lib/narrator-guidance'

function ctx(overrides: Partial<Parameters<typeof formatNarratorTurnGuidance>[0]> = {}) {
  return {
    stance: 'observe',
    inputMode: 'in-character',
    playerText: 'I look around',
    recentTurns: [],
    presentNpcCount: 1,
    plannedActionCount: 0,
    ...overrides,
  }
}

describe('narrator momentum ladder', () => {
  it('fires the L2 "world acts" cue after the idle threshold of passive moves', () => {
    const recentTurns = [
      { role: 'user' as const, content: 'I look around' },
      { role: 'assistant' as const, content: 'The camp stirs.' },
      { role: 'user' as const, content: 'we continue' },
      { role: 'assistant' as const, content: 'You march on.' },
    ]
    const out = formatNarratorTurnGuidance(ctx({ playerText: 'I wait', recentTurns }))
    expect(out.toLowerCase()).toContain('world acts')
  })

  it('does not fire L2 when the player is actively driving', () => {
    const recentTurns = [
      { role: 'user' as const, content: 'I hurl my javelin at the scout' },
      { role: 'assistant' as const, content: 'It strikes home.' },
    ]
    const out = formatNarratorTurnGuidance(
      ctx({ stance: 'do', playerText: 'I charge the line', recentTurns }),
    )
    expect(out.toLowerCase()).not.toContain('world acts')
  })

  it('names an active threat thread as the pressure source when one exists', () => {
    const recentTurns = [
      { role: 'user' as const, content: 'I look around' },
      { role: 'assistant' as const, content: 'Quiet.' },
      { role: 'user' as const, content: 'I wait' },
      { role: 'assistant' as const, content: 'Quiet.' },
    ]
    const out = formatNarratorTurnGuidance(
      ctx({ playerText: 'I wait', recentTurns, activeThreatTitles: ['Ambush at the bend'] }),
    )
    expect(out).toContain('Ambush at the bend')
  })
})

describe('formatNarratorTurnGuidance', () => {
  it('pushes spoken answers instead of summarized replies on say turns', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'say',
      inputMode: 'in-character',
      playerText: 'I ask in Russian, "Is this Beluga vodka?"',
      recentTurns: [],
      presentNpcCount: 1,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('Let audible dialogue be audible')
    expect(guidance).toContain('answer')
    expect(guidance).toContain('branch the player can pursue')
  })

  it('nudges marked foreign-language dialogue toward romanized texture', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'say',
      inputMode: 'in-character',
      playerText:
        'I look at Alexei and speak in Russian, "Alexei, my friend. Your father fought honorably in Chechnya."',
      recentTurns: [],
      presentNpcCount: 2,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('marked their speech as Russian')
    expect(guidance).toContain('light romanized touch')
    expect(guidance).toContain('meaning stays clear in English')
  })

  it('detects observe-only moves and asks for new scene information', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'observe',
      inputMode: 'in-character',
      playerText: 'I look at them',
      recentTurns: [],
      presentNpcCount: 2,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('Observation should reveal a new handle')
    expect(guidance).toContain('detail, offer, threat')
  })

  it('pushes investigative tool commands toward results instead of processing beats', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'say',
      inputMode: 'in-character',
      playerText: '"Vox, pattern match, now."',
      recentTurns: [],
      presentNpcCount: 0,
      plannedActionCount: 0,
      activeObjectiveTitles: ['Identify the relay fragment'],
      openClueTitles: ['Stygies VIII batch mark'],
    })

    expect(guidance).toContain('trying to learn something')
    expect(guidance).toContain('concrete result')
    expect(guidance).toContain('new lead')
    expect(guidance).toContain('Identify the relay fragment')
    expect(guidance).toContain('Stygies VIII batch mark')
    expect(guidance).toContain('branch the player can pursue')
  })

  it('forces time-bearing devices to match the world clock', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'observe',
      inputMode: 'in-character',
      playerText: 'I look at the time on my watch.',
      recentTurns: [],
      presentNpcCount: 0,
      plannedActionCount: 0,
      worldTime: 'Tuesday, 8:17 AM',
    })

    expect(guidance).toContain('time-bearing device')
    expect(guidance).toContain('Tuesday, 8:17 AM')
    expect(guidance).toContain('authoritative world clock exactly')
  })

  it('treats public feeds and screens as wider-world surfaces', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'observe',
      inputMode: 'in-character',
      playerText: 'I open up X',
      recentTurns: [],
      presentNpcCount: 0,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('public information surface')
    expect(guidance).toContain('specific diegetic content')
    expect(guidance).toContain('could recur')
  })

  it('flags recent reaction-only narration loops', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'say',
      inputMode: 'in-character',
      playerText: 'I ask for a bottle of vodka.',
      recentTurns: [
        {
          role: 'assistant',
          content:
            'The bartender pauses mid-pour, while the two men at the nearest table turn their heads. One of them sets his fork down slowly.',
        },
        {
          role: 'user',
          content: 'I look at them',
        },
        {
          role: 'assistant',
          content:
            'The bartender holds the glass at an angle, his eyes narrowed on you, while the nearer of the two men leans back and the other keeps his fork on the plate.',
        },
      ],
      presentNpcCount: 3,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('repeating its architecture')
    expect(guidance).toContain('Change the shape')
  })

  it('flags repeated short tool-response structure on movement beats', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'do',
      inputMode: 'in-character',
      playerText: 'I make my way into the city',
      recentTurns: [
        {
          role: 'assistant',
          content:
            'You turn toward Vox and issue the order to trace the blast origin.\n\nVox extends its auspex-range across the pad, mapping residue before settling its beam on the crater.',
        },
        {
          role: 'user',
          content: 'I go to the crater',
        },
        {
          role: 'assistant',
          content:
            "You cross the slick concrete to the crater at the blast wall's base.\n\nVox pivots its auspex-beam to track your movement, then swivels back to pulse-query the lander.",
        },
      ],
      presentNpcCount: 0,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('Let the beat breathe')
    expect(guidance).toContain('repeating its architecture')
    expect(guidance).toContain('arrival')
  })

  it('flags repeated ambient closers', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'say',
      inputMode: 'in-character',
      playerText: '"Vox, what did you find?"',
      recentTurns: [
        {
          role: 'assistant',
          content:
            'Vox lowers its beam over the fragment. The grain continues its slow, independent sway around your boots.',
        },
        {
          role: 'user',
          content: '"Vox, pattern match, now."',
        },
        {
          role: 'assistant',
          content:
            'Vox returns a partial match and clicks once. The wheat sways around your boots, the bell drifting from the spire.',
        },
      ],
      presentNpcCount: 0,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('ambient closer')
    expect(guidance).toContain('wheat')
    expect(guidance).toContain('only if it changes')
  })

  it('expands charged interior recognition beats instead of summarizing them', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'think',
      inputMode: 'in-character',
      playerText:
        "I listen for the sounds of approaching officers and take stock of my situation. I don't feel alarmed or stressed which is strange. I feel great actually. I look around for the gun, but then stop realizing that I don't need it. I am a weapon.",
      recentTurns: [],
      presentNpcCount: 2,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('charged recognition beat')
    expect(guidance).toContain('novelistic weight')
    expect(guidance).toContain('object losing meaning')
  })

  it('expands cinematic spectacle and repeated power actions', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'do',
      inputMode: 'in-character',
      playerText: 'I do the same to the other squad cars and watch them crumple and burn.',
      recentTurns: [],
      presentNpcCount: 3,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('This is spectacle')
    expect(guidance).toContain('unfold as a sequence')
    expect(guidance).toContain('vary or escalate')
  })

  it('expands charged confrontations beyond line-reaction-closer shape', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'say',
      inputMode: 'in-character',
      playerText:
        '"Kyle!" I smile and approach him. "Something tells me you are not being honest with me."',
      recentTurns: [],
      presentNpcCount: 2,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('charged confrontation')
    expect(guidance).toContain('spacing, witnesses, silence')
    expect(guidance).toContain('carry the pressure')
  })

  it('keeps meta guidance from advancing fiction', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'meta',
      inputMode: 'ooc',
      playerText: '(ooc) pause',
      recentTurns: [],
      presentNpcCount: 1,
      plannedActionCount: 0,
    })

    expect(guidance).toContain('keep the fiction in place')
    expect(guidance).not.toContain('branch the player can pursue')
  })
})

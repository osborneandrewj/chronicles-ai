import { describe, expect, it } from 'vitest'

import { formatNarratorTurnGuidance } from '@/lib/narrator-guidance'

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

    expect(guidance).toContain('render their actual spoken words')
    expect(guidance).toContain('answer specifically')
    expect(guidance).toContain('branch the player can pursue')
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

    expect(guidance).toContain('reveal something new')
    expect(guidance).toContain('Do not only list who looks back')
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
    expect(guidance).toContain('do not spend the turn only showing scanning')
    expect(guidance).toContain('Identify the relay fragment')
    expect(guidance).toContain('Stygies VIII batch mark')
    expect(guidance).toContain('branch the player can pursue')
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

    expect(guidance).toContain('repeated short architecture')
    expect(guidance).toContain('Break the shape')
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

    expect(guidance).toContain('movement, transition, danger')
    expect(guidance).toContain('repeated short architecture')
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
    expect(guidance).toContain('materially changes')
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

    expect(guidance).toContain('do not advance the fiction')
    expect(guidance).not.toContain('branch the player can pursue')
  })
})

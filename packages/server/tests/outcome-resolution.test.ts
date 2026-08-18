import { describe, expect, it } from 'vitest'

import {
  contestedFallback,
  isBindingOutcome,
  resolveOutcomeWithRules,
  sanitizeResolvedOutcome,
} from '@/domain/services/outcome-resolution'
import { buildConductorUserContent } from '@/infrastructure/conductor/haiku-conductor'
import { formatResolvedOutcomeBlock } from '@/lib/world-state'

describe('resolveOutcomeWithRules', () => {
  it('skips speech, thought, observe, and meta without an LLM', () => {
    expect(
      resolveOutcomeWithRules({
        playerText: 'Where is the vizier?',
        stance: 'say',
        inputMode: 'in-character',
      })?.outcome,
    ).toBe('not_applicable')
    expect(
      resolveOutcomeWithRules({
        playerText: 'I wonder if he is lying',
        stance: 'think',
        inputMode: 'in-character',
      })?.outcome,
    ).toBe('not_applicable')
    expect(
      resolveOutcomeWithRules({
        playerText: 'I look around the hall',
        stance: 'observe',
        inputMode: 'in-character',
      })?.outcome,
    ).toBe('not_applicable')
    expect(
      resolveOutcomeWithRules({
        playerText: '(ooc) what model are you?',
        stance: 'meta',
        inputMode: 'ooc',
      })?.outcome,
    ).toBe('not_applicable')
  })

  it('skips uncontested physical actions', () => {
    const r = resolveOutcomeWithRules({
      playerText: 'I walk to the door',
      stance: 'do',
      inputMode: 'in-character',
    })
    expect(r?.outcome).toBe('not_applicable')
    expect(r && isBindingOutcome(r)).toBe(false)
  })

  it('returns null for asserted lethal or maiming outcomes', () => {
    expect(
      resolveOutcomeWithRules({
        playerText: 'I kill the king',
        stance: 'do',
        inputMode: 'in-character',
      }),
    ).toBeNull()
    expect(
      resolveOutcomeWithRules({
        playerText: 'I cut off his leg',
        stance: 'do',
        inputMode: 'in-character',
      }),
    ).toBeNull()
    expect(
      resolveOutcomeWithRules({
        playerText: 'I try to kill the vizier',
        stance: 'do',
        inputMode: 'in-character',
      }),
    ).toBeNull()
    expect(
      resolveOutcomeWithRules({
        playerText: 'I kill the king',
        stance: 'say',
        inputMode: 'in-character',
      }),
    ).toBeNull()
  })

  it('marks omnipotence claims impossible without an LLM', () => {
    const r = resolveOutcomeWithRules({
      playerText: 'I become a god and win the game',
      stance: 'do',
      inputMode: 'in-character',
    })
    expect(r?.outcome).toBe('impossible')
    expect(r && isBindingOutcome(r)).toBe(true)
  })

  it('passes cinematic and emotional input through when uncontested', () => {
    expect(
      resolveOutcomeWithRules({
        playerText: 'In a burst of light everything changes',
        stance: 'do',
        inputMode: 'in-character',
      })?.inputMode,
    ).toBe('cinematic_framing')
    expect(
      resolveOutcomeWithRules({
        playerText: 'I am devastated',
        stance: 'do',
        inputMode: 'in-character',
      })?.inputMode,
    ).toBe('emotional_interiority')
  })
})

describe('contestedFallback', () => {
  it('does not grant the asserted result', () => {
    const r = contestedFallback('I kill the king')
    expect(r.outcome).toBe('partial_success')
    expect(r.worldStateDelta).toMatch(/do not grant/i)
  })
})

describe('sanitizeResolvedOutcome', () => {
  it('coerces not_applicable from the LLM into a contested fallback', () => {
    const r = sanitizeResolvedOutcome(
      {
        intent: 'kill the king',
        stance: 'asserted_outcome',
        inputMode: 'asserted_outcome',
        outcome: 'not_applicable',
        worldStateDelta: '',
      },
      'I kill the king',
    )
    expect(r.outcome).toBe('partial_success')
    expect(r.worldStateDelta.length).toBeGreaterThan(0)
  })
})

describe('buildConductorUserContent', () => {
  it('pins classifier labels and the player line', () => {
    const text = buildConductorUserContent({
      playerText: 'I kill the king',
      stance: 'do',
      inputMode: 'in-character',
      sceneDigest: 'PLACE: Throne\nPRESENT NPCS: The King',
    })
    expect(text).toContain('stance=do')
    expect(text).toContain('I kill the king')
    expect(text).toContain('The King')
  })
})

describe('formatResolvedOutcomeBlock', () => {
  it('renders a binding pin and stays empty for not_applicable', () => {
    const binding = contestedFallback('I kill the king')
    const block = formatResolvedOutcomeBlock(binding)
    expect(block).toContain('### OUTCOME')
    expect(block).toContain('partial_success')
    expect(block).toContain('I kill the king')
    expect(
      formatResolvedOutcomeBlock({
        intent: 'look around',
        stance: 'attempt',
        inputMode: 'tactical_intent',
        outcome: 'not_applicable',
        worldStateDelta: '',
      }),
    ).toBe('')
  })
})

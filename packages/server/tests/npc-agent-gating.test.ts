import { describe, expect, it } from 'vitest'

import { shouldTickNpcAgent } from '@/domain/services/npc-agent-gating'

const npc = (over: Partial<{ is_player: number; status: 'active' | 'inactive' | 'dead' }> = {}) => ({
  is_player: 0,
  status: 'active' as const,
  ...over,
})

describe('shouldTickNpcAgent', () => {
  it('never ticks out-of-character / meta / pure-thought turns', () => {
    expect(
      shouldTickNpcAgent({ stance: 'say', inputMode: 'ooc', presentCharacters: [npc()] }),
    ).toBe(false)
    expect(
      shouldTickNpcAgent({ stance: 'meta', inputMode: 'in-character', presentCharacters: [npc()] }),
    ).toBe(false)
    expect(
      shouldTickNpcAgent({ stance: 'think', inputMode: 'in-character', presentCharacters: [npc()] }),
    ).toBe(false)
  })

  it('always ticks a scene-driving move, even with no present NPC', () => {
    expect(
      shouldTickNpcAgent({ stance: 'do', inputMode: 'in-character', presentCharacters: [] }),
    ).toBe(true)
    expect(
      shouldTickNpcAgent({ stance: 'say', inputMode: 'in-character', presentCharacters: [] }),
    ).toBe(true)
  })

  it('ticks a passive/observe turn when any present living non-player NPC exists', () => {
    expect(
      shouldTickNpcAgent({
        stance: 'observe',
        inputMode: 'in-character',
        presentCharacters: [npc({ is_player: 1 }), npc()],
      }),
    ).toBe(true)
  })

  it('does NOT require an already-promoted local/nearby NPC (the cold-open fix)', () => {
    // A freshly-met co-located NPC (agency_level would be "npc") still ticks —
    // the gate only checks presence + living + non-player.
    expect(
      shouldTickNpcAgent({
        stance: 'observe',
        inputMode: 'in-character',
        presentCharacters: [npc()],
      }),
    ).toBe(true)
  })

  it('does not tick a passive turn with only the player present', () => {
    expect(
      shouldTickNpcAgent({
        stance: 'observe',
        inputMode: 'in-character',
        presentCharacters: [npc({ is_player: 1 })],
      }),
    ).toBe(false)
  })

  it('ignores a dead co-located NPC on a passive turn', () => {
    expect(
      shouldTickNpcAgent({
        stance: 'observe',
        inputMode: 'in-character',
        presentCharacters: [npc({ is_player: 1 }), npc({ status: 'dead' })],
      }),
    ).toBe(false)
  })
})

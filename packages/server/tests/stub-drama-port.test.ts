import { describe, expect, it } from 'vitest'

import type { DramaBeatInput } from '@/domain/ports/drama-port'
import { StubDramaPort } from '@/infrastructure/world-gen/stub-drama-port'

// Unit tests for the deterministic StubDramaPort (starship P3). It must return a
// valid DramaBeat whose valence deltas are scoped to the co-located participants,
// so the offline sim script can fire beats with no LLM spend.

function input(overrides: Partial<DramaBeatInput> = {}): DramaBeatInput {
  return {
    world_id: 1,
    sim_tick: 4,
    world_time: 'Day 1 — midday',
    place_id: 10,
    place_name: 'Mess Hall',
    participants: [
      { character_id: 101, name: 'Vance', role: 'captain', goal: 'hold the crew together' },
      { character_id: 102, name: 'Okonkwo', role: 'engineer', goal: 'keep the drive stable' },
      { character_id: 103, name: 'Renn', role: 'pilot', goal: 'plot the survey arc' },
    ],
    relationships: [],
    threads: [],
    ...overrides,
  }
}

describe('StubDramaPort', () => {
  it('returns a valid beat naming the place and all co-located participants', async () => {
    const beat = await new StubDramaPort().generateBeat(input())

    expect(beat.title).toContain('Mess Hall')
    expect(beat.summary).toContain('Mess Hall')
    expect(beat.participant_ids).toEqual([101, 102, 103])
  })

  it('emits one positive valence delta between the first two participants', async () => {
    const beat = await new StubDramaPort().generateBeat(input())

    expect(beat.valenceDeltas).toHaveLength(1)
    const delta = beat.valenceDeltas[0]
    expect(delta.from_character_id).toBe(101)
    expect(delta.to_character_id).toBe(102)
    expect(delta.delta).toBeGreaterThan(0)
  })

  it('scopes every valence delta to the participant group', async () => {
    const beat = await new StubDramaPort().generateBeat(input())
    const memberIds = new Set([101, 102, 103])

    for (const d of beat.valenceDeltas) {
      expect(memberIds.has(d.from_character_id)).toBe(true)
      expect(memberIds.has(d.to_character_id)).toBe(true)
      expect(Math.abs(d.delta)).toBeLessThanOrEqual(0.4)
    }
  })

  it('omits the delta when fewer than two participants are co-located', async () => {
    const beat = await new StubDramaPort().generateBeat(
      input({
        participants: [
          { character_id: 101, name: 'Vance', role: 'captain', goal: 'hold the crew together' },
        ],
      }),
    )

    expect(beat.participant_ids).toEqual([101])
    expect(beat.valenceDeltas).toHaveLength(0)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'

import { applyArchivistPatch } from '@/lib/archivist'
import { db, getCharactersForWorld, getPlacesForWorld, insertTurn } from '@/lib/db'
import { applyNpcAgentPatch } from '@/lib/npc-agent'
import { createWorld } from '@/lib/worlds'

function seedWorld(name: string): { worldId: number; turnId: number } {
  const world = createWorld({
    name,
    premise: 'An office in Spokane. The protagonist has secrets.',
    initialState: {
      time: 'Morning',
      location: 'Covenant Security',
      identity: 'Quiet engineer with strange dreams.',
      playerName: 'Andrew',
    },
  })
  const turn = insertTurn(world.id, 'assistant', 'The keyboard hum.', null)
  return { worldId: world.id, turnId: turn.id }
}

function promoteToLocal(worldId: number, name: string): void {
  db.prepare(
    `UPDATE characters SET agency_level = 'local'
       WHERE world_id = ? AND lower(name) = lower(?)`,
  ).run(worldId, name)
}

describe('applyNpcAgentPatch', () => {
  let worldId: number
  let turnId: number

  beforeEach(() => {
    ;({ worldId, turnId } = seedWorld(`NpcAgent-${Math.random()}`))
    // Seed two NPCs: Marcus (local agent-tier) and Donna (npc-tier).
    applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Marcus', description: 'Senior engineer.', current_place_name: 'Covenant Security' },
        { name: 'Donna', description: 'Office manager.', current_place_name: 'Covenant Security' },
      ],
    })
    promoteToLocal(worldId, 'Marcus')
  })

  it('overwrites current_focus on agent-tier NPC', () => {
    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [{ name: 'Marcus', current_focus: 'finishing the auth refactor' }],
    })

    const marcus = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    expect(marcus.current_focus).toBe('finishing the auth refactor')
  })

  it('appends activity with [t:N] provenance, accumulating across patches', () => {
    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [{ name: 'Marcus', activity_append: 'walked to the breakroom' }],
    })
    const second = insertTurn(worldId, 'assistant', 'A later turn.', null)
    applyNpcAgentPatch(worldId, second.id, {
      npc_updates: [{ name: 'Marcus', activity_append: 'took a call from David' }],
    })

    const marcus = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    expect(marcus.recent_activity).toBe(
      `walked to the breakroom [t:${turnId}]\ntook a call from David [t:${second.id}]`,
    )
  })

  it('relocates an agent NPC only when the place already exists', () => {
    // Pre-existing place — relocation should land.
    applyArchivistPatch(worldId, turnId, { places: [{ name: 'Breakroom' }] })
    const breakroomId = getPlacesForWorld(worldId).find((p) => p.name === 'Breakroom')!.id

    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [{ name: 'Marcus', current_place_name: 'Breakroom' }],
    })
    expect(getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!.current_place_id).toBe(
      breakroomId,
    )

    // Unknown place — silently dropped (NPC agent doesn't create places).
    const marcusBefore = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [{ name: 'Marcus', current_place_name: 'Mars Orbit' }],
    })
    expect(getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!.current_place_id).toBe(
      marcusBefore.current_place_id,
    )
    expect(getPlacesForWorld(worldId).find((p) => p.name === 'Mars Orbit')).toBeUndefined()
  })

  it('drops updates for non-agent-tier NPCs', () => {
    // Donna is npc-tier; her current_focus should not change.
    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [{ name: 'Donna', current_focus: 'should not persist' }],
    })
    const donna = getCharactersForWorld(worldId).find((c) => c.name === 'Donna')!
    expect(donna.current_focus).toBeNull()
  })

  it('drops updates targeting the player character', () => {
    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [{ name: 'Andrew', current_focus: 'should not persist' }],
    })
    const andrew = getCharactersForWorld(worldId).find((c) => c.is_player === 1)!
    expect(andrew.current_focus).toBeNull()
  })

  it('drops updates for unknown NPCs', () => {
    expect(() =>
      applyNpcAgentPatch(worldId, turnId, {
        npc_updates: [{ name: 'Ghost', current_focus: 'nope' }],
      }),
    ).not.toThrow()
  })

  it('overwrites personal_goals when set', () => {
    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [
        {
          name: 'Marcus',
          personal_goals: 'Wants to leave by Q4.\nWorried about his father.',
        },
      ],
    })
    const marcus = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    expect(marcus.personal_goals).toBe('Wants to leave by Q4.\nWorried about his father.')
  })

  it('empty patch is a no-op', () => {
    const before = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    applyNpcAgentPatch(worldId, turnId, {})
    const after = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    expect(after.current_focus).toBe(before.current_focus)
    expect(after.recent_activity).toBe(before.recent_activity)
  })
})

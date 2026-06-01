import { beforeEach, describe, expect, it } from 'vitest'

import { applyArchivistPatch } from '@/lib/archivist'
import { parseDailyLoop } from '@/lib/daily-loop'
import { db, getCharactersForWorld, getPlacesForWorld, insertTurn } from '@/lib/db'
import { applyNpcAgentPatch, NpcAgentPatchSchema, repairNpcAgentText } from '@/lib/npc-agent'
import { getReveriesForCharacter } from '@/lib/reveries'
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

describe('repairNpcAgentText', () => {
  // Mirrors the real shape recovered from a live Haiku flake: valid content,
  // broken serialization.
  const intended = {
    npc_updates: [{ name: 'The Attendant at the Gates', current_focus: 'obeying' }],
    planned_actions: [
      {
        npc_name: 'The Attendant at the Gates',
        intent: 'survive by surrendering everything',
        planned_action: 'empties his pockets with shaking hands',
        intent_type: 'comply',
      },
    ],
  }

  it('rebuilds the body crammed into a stringified npc_updates field (Shape 1)', () => {
    const inner = `${JSON.stringify(intended.npc_updates)},\n"planned_actions": ${JSON.stringify(intended.planned_actions)}`
    const malformed = JSON.stringify({ npc_updates: inner })

    const repaired = repairNpcAgentText(malformed)
    expect(repaired).not.toBeNull()
    const obj = JSON.parse(repaired!)
    expect(NpcAgentPatchSchema.safeParse(obj).success).toBe(true)
    expect(obj).toEqual(intended)
  })

  it('parses array fields returned as JSON strings (Shape 2)', () => {
    const malformed = JSON.stringify({
      npc_updates: JSON.stringify(intended.npc_updates),
      planned_actions: JSON.stringify(intended.planned_actions),
    })
    const repaired = repairNpcAgentText(malformed)
    expect(repaired).not.toBeNull()
    expect(NpcAgentPatchSchema.safeParse(JSON.parse(repaired!)).success).toBe(true)
  })

  it('returns null when there is nothing to repair', () => {
    expect(repairNpcAgentText(JSON.stringify(intended))).toBeNull()
  })

  it('returns null for unparseable text', () => {
    expect(repairNpcAgentText('not json at all')).toBeNull()
  })
})

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

  it('overwrites richer cognition fields when set', () => {
    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [
        {
          name: 'Marcus',
          private_beliefs: 'Andrew is hiding why the auth logs changed.',
          relationship_to_player: 'Wary of Andrew, but owes him for covering the outage.',
          long_term_agenda: 'Get out before the audit closes.\nNever implicate Jordana.',
          tool_access: 'Can query Covenant Security issue trackers and Slack history.',
        },
      ],
    })

    const marcus = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    expect(marcus.private_beliefs).toBe('Andrew is hiding why the auth logs changed.')
    expect(marcus.relationship_to_player).toBe(
      'Wary of Andrew, but owes him for covering the outage.',
    )
    expect(marcus.long_term_agenda).toBe('Get out before the audit closes.\nNever implicate Jordana.')
    expect(marcus.tool_access).toBe('Can query Covenant Security issue trackers and Slack history.')
  })

  it('empty patch is a no-op', () => {
    const before = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    applyNpcAgentPatch(worldId, turnId, {})
    const after = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    expect(after.current_focus).toBe(before.current_focus)
    expect(after.recent_activity).toBe(before.recent_activity)
  })
})

describe('npc agent reverie authoring (append-only)', () => {
  it('inserts reveries_add as rows and never deletes on omission', () => {
    const { worldId, turnId } = seedWorld('rev-author')
    db.prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Mara', 0)").run(worldId)
    promoteToLocal(worldId, 'Mara')
    const charId = (db.prepare("SELECT id FROM characters WHERE world_id = ? AND name = 'Mara'").get(worldId) as { id: number }).id

    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [{ name: 'Mara', reveries_add: [{ text: 'burnt coffee recalls the outage', match_tags: ['coffee'] }] }],
    })
    expect(getReveriesForCharacter(charId)).toHaveLength(1)

    applyNpcAgentPatch(worldId, turnId, { npc_updates: [{ name: 'Mara', current_focus: 'waiting' }] })
    expect(getReveriesForCharacter(charId)).toHaveLength(1) // omission preserved
  })

  it('authors daily_loop once and does not overwrite it later', () => {
    const { worldId, turnId } = seedWorld('loop-author')
    db.prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Tomas', 0)").run(worldId)
    promoteToLocal(worldId, 'Tomas')

    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [{ name: 'Tomas', daily_loop: { morning: { activity: 'opens the shop' } } }],
    })
    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [{ name: 'Tomas', daily_loop: { morning: { activity: 'DIFFERENT' } } }],
    })
    const row = db.prepare("SELECT daily_loop FROM characters WHERE world_id = ? AND name = 'Tomas'").get(worldId) as { daily_loop: string | null }
    expect(parseDailyLoop(row.daily_loop)?.morning?.activity).toBe('opens the shop')
  })
})

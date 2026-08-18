import { beforeEach, describe, expect, it } from 'vitest'

import { getContainer } from '@/composition/container'
import { applyArchivistPatch } from '@/lib/archivist'
import { parseDailyLoop } from '@/lib/daily-loop'
import { db, getCharactersForWorld, getPlacesForWorld, insertTurn } from '@/lib/db'
import { buildNpcStoryContext } from '@/domain/services/closed-dossier'
import {
  applyNpcAgentPatch,
  buildNpcAgentUserContent,
  NpcAgentPatchSchema,
  repairNpcAgentText,
  sanitizeSpeechHint,
  shouldSkipRoutineTick,
  type NpcAgentDeps,
} from '@/lib/npc-agent'
import { getReveriesForCharacter } from '@/lib/reveries'
import { createWorld } from '@/lib/worlds'

// The NPC agent now reads/writes through injected ports (P5b strangle). On the
// default SQLite path the container's adapters delegate to the same byte-identical
// SQL these tests assert against, so they remain the characterization oracle.
function npcAgentDeps(): NpcAgentDeps {
  const c = getContainer()
  return {
    characters: c.characters,
    dossiers: c.dossiers,
    npcIntents: c.npcIntents,
    places: c.places,
    reveries: c.reveries,
    unitOfWork: c.unitOfWork,
    worlds: c.worlds,
  }
}

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

  it('recovers Shape 1 when Haiku uses > instead of : before planned_actions', () => {
    const inner = `${JSON.stringify(intended.npc_updates)},\n"planned_actions">${JSON.stringify(intended.planned_actions)}`
    const malformed = JSON.stringify({ npc_updates: inner })

    const repaired = repairNpcAgentText(malformed)
    expect(repaired).not.toBeNull()
    const obj = JSON.parse(repaired!)
    expect(NpcAgentPatchSchema.safeParse(obj).success).toBe(true)
    expect(obj).toEqual(intended)
  })
})

describe('NpcAgentPatchSchema (planned_actions reordered first)', () => {
  it('parses a patch with planned_actions present (the forced output)', () => {
    const parsed = NpcAgentPatchSchema.safeParse({
      planned_actions: [{ npc_name: 'Setnakht', intent: 'press the scribe', planned_action: 'steps in close and asks who the cartouche names' }],
      npc_updates: [{ name: 'Setnakht', current_focus: 'weighing the threat' }],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.planned_actions?.[0]?.npc_name).toBe('Setnakht')
  })

  it('still tolerates an npc_updates-only patch (both arrays optional)', () => {
    const parsed = NpcAgentPatchSchema.safeParse({
      npc_updates: [{ name: 'Setnakht', current_focus: 'wary' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('repairNpcAgentText still recovers a stringified planned_actions body after the reorder', () => {
    const malformed = '{"planned_actions":"[{\\"npc_name\\":\\"Setnakht\\",\\"intent\\":\\"x\\",\\"planned_action\\":\\"y\\"}]"}'
    const repaired = repairNpcAgentText(malformed)
    expect(repaired).not.toBeNull()
    expect(NpcAgentPatchSchema.safeParse(JSON.parse(repaired as string)).success).toBe(true)
  })

  it('tolerates null optional fields inside planned_actions (Haiku emits null, not omit)', () => {
    // Prod regression: Haiku returned `target_npc_name: null` / `target_place_name: null`;
    // a bare `.optional()` string rejects null, which dropped the whole planning array
    // and left present NPCs reactive. tolerateNulls coerces the nulls away.
    const parsed = NpcAgentPatchSchema.safeParse({
      planned_actions: [
        {
          npc_name: 'Setnakht',
          intent: 'press the scribe',
          planned_action: 'steps in close and asks who the cartouche names',
          target_npc_name: null,
          target_place_name: null,
        },
        {
          npc_name: 'Ahmose',
          intent: 'withdraw',
          planned_action: 'slips toward the colonnade without a word',
          target_place_name: null,
        },
      ],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.planned_actions?.[0]?.target_npc_name).toBeUndefined()
    expect(parsed.success && parsed.data.planned_actions?.[0]?.npc_name).toBe('Setnakht')
  })
})

describe('shouldSkipRoutineTick', () => {
  const base = {
    present_with_protagonist: false,
    in_transit_to_place_id: null as number | null,
    daily_loop: '{"morning":{"activity":"opens shop"}}' as string | null,
  }
  it('skips an off-scene, looped, stationary NPC not mentioned in prior narration', () => {
    expect(shouldSkipRoutineTick({ ...base, name: 'Tomas' }, 'The street was quiet.')).toBe(true)
  })
  it('does not skip if present, in transit, loopless, or mentioned', () => {
    expect(shouldSkipRoutineTick({ ...base, name: 'Tomas', present_with_protagonist: true }, '')).toBe(false)
    expect(shouldSkipRoutineTick({ ...base, name: 'Tomas', in_transit_to_place_id: 5 }, '')).toBe(false)
    expect(shouldSkipRoutineTick({ ...base, name: 'Tomas', daily_loop: null }, '')).toBe(false)
    expect(shouldSkipRoutineTick({ ...base, name: 'Tomas' }, 'Tomas waved from the shop.')).toBe(false)
  })
})

describe('applyNpcAgentPatch', () => {
  let worldId: number
  let turnId: number

  beforeEach(async () => {
    ;({ worldId, turnId } = seedWorld(`NpcAgent-${Math.random()}`))
    // Seed two NPCs: Marcus (local agent-tier) and Donna (npc-tier).
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Marcus', description: 'Senior engineer.', current_place_name: 'Covenant Security' },
        { name: 'Donna', description: 'Office manager.', current_place_name: 'Covenant Security' },
      ],
    })
    promoteToLocal(worldId, 'Marcus')
  })

  it('overwrites current_focus on agent-tier NPC', async () => {
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Marcus', current_focus: 'finishing the auth refactor' }],
    })

    const marcus = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    expect(marcus.current_focus).toBe('finishing the auth refactor')
  })

  it('appends activity with [t:N] provenance, accumulating across patches', async () => {
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Marcus', activity_append: 'walked to the breakroom' }],
    })
    const second = insertTurn(worldId, 'assistant', 'A later turn.', null)
    await applyNpcAgentPatch(npcAgentDeps(), worldId, second.id, {
      npc_updates: [{ name: 'Marcus', activity_append: 'took a call from David' }],
    })

    const marcus = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    expect(marcus.recent_activity).toBe(
      `walked to the breakroom [t:${turnId}]\ntook a call from David [t:${second.id}]`,
    )
  })

  it('starts a journey toward a known place instead of teleporting (Track M)', async () => {
    // Pre-existing place — relocation becomes en-route, not instant present.
    await applyArchivistPatch(worldId, turnId, { places: [{ name: 'Breakroom' }] })
    const breakroomId = getPlacesForWorld(worldId).find((p) => p.name === 'Breakroom')!.id
    const marcusBefore = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!

    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Marcus', current_place_name: 'Breakroom' }],
    })
    const marcus = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    // Still at origin until resolveArrivals lands them.
    expect(marcus.current_place_id).toBe(marcusBefore.current_place_id)
    expect(marcus.in_transit_to_place_id).toBe(breakroomId)
    expect(marcus.arrival_minutes).not.toBeNull()

    // Unknown place — silently dropped (NPC agent doesn't create places).
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Marcus', current_place_name: 'Mars Orbit' }],
    })
    expect(getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!.current_place_id).toBe(
      marcusBefore.current_place_id,
    )
    expect(getPlacesForWorld(worldId).find((p) => p.name === 'Mars Orbit')).toBeUndefined()
  })

  it('persists updates for a co-located npc-tier NPC (write-back gap closed, P1)', async () => {
    // Donna is npc-tier and co-located; with the write-back widening the NPC
    // agent's own update for her now persists (the agent only emits updates for
    // NPCs it planned for this turn — see isPlanEligible).
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Donna', current_focus: 'now persists' }],
    })
    const donna = getCharactersForWorld(worldId).find((c) => c.name === 'Donna')!
    expect(donna.current_focus).toBe('now persists')
  })

  it('drops updates targeting the player character', async () => {
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Andrew', current_focus: 'should not persist' }],
    })
    const andrew = getCharactersForWorld(worldId).find((c) => c.is_player === 1)!
    expect(andrew.current_focus).toBeNull()
  })

  it('drops updates for unknown NPCs', async () => {
    await expect(
      applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
        npc_updates: [{ name: 'Ghost', current_focus: 'nope' }],
      }),
    ).resolves.not.toThrow()
  })

  it('overwrites personal_goals when set', async () => {
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
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

  it('overwrites richer cognition fields when set', async () => {
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
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

  it('empty patch is a no-op', async () => {
    const before = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {})
    const after = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')!
    expect(after.current_focus).toBe(before.current_focus)
    expect(after.recent_activity).toBe(before.recent_activity)
  })
})

describe('reveries_add cooldown gate', () => {
  it('no-prior accept: first reverie mints when NPC has zero reveries', async () => {
    const { worldId, turnId } = seedWorld(`rev-gate-accept-${Math.random()}`)
    db.prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Nyx', 0)").run(worldId)
    promoteToLocal(worldId, 'Nyx')
    const charId = (db.prepare("SELECT id FROM characters WHERE world_id = ? AND name = 'Nyx'").get(worldId) as { id: number }).id

    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Nyx', reveries_add: [{ text: 'the hum of servers in an empty office', match_tags: ['servers'] }] }],
    })

    expect(getReveriesForCharacter(charId)).toHaveLength(1)
  })

  it('within-cooldown drop: new reverie is dropped when cooldown has not elapsed', async () => {
    const { worldId, turnId } = seedWorld(`rev-gate-cooldown-${Math.random()}`)
    db.prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Nyx', 0)").run(worldId)
    promoteToLocal(worldId, 'Nyx')
    const charId = (db.prepare("SELECT id FROM characters WHERE world_id = ? AND name = 'Nyx'").get(worldId) as { id: number }).id

    // Mint the first reverie
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Nyx', reveries_add: [{ text: 'first memory', match_tags: [] }] }],
    })
    expect(getReveriesForCharacter(charId)).toHaveLength(1)

    // Attempt a second mint on the very next turn (no player turns have elapsed)
    const nextTurn = insertTurn(worldId, 'assistant', 'another narration', null)
    await applyNpcAgentPatch(npcAgentDeps(), worldId, nextTurn.id, {
      npc_updates: [{ name: 'Nyx', reveries_add: [{ text: 'second memory blocked by cooldown', match_tags: [] }] }],
    })

    // Still only 1 — the cooldown gate dropped the second
    expect(getReveriesForCharacter(charId)).toHaveLength(1)
  })

  it('multi-emit clamp: only the first of multiple reveries_add items is persisted', async () => {
    const { worldId, turnId } = seedWorld(`rev-gate-clamp-${Math.random()}`)
    db.prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Nyx', 0)").run(worldId)
    promoteToLocal(worldId, 'Nyx')
    const charId = (db.prepare("SELECT id FROM characters WHERE world_id = ? AND name = 'Nyx'").get(worldId) as { id: number }).id

    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{
        name: 'Nyx',
        reveries_add: [
          { text: 'first item — persisted', match_tags: [] },
          { text: 'second item — dropped', match_tags: [] },
        ],
      }],
    })

    const rows = getReveriesForCharacter(charId)
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('first item — persisted')
  })
})

describe('npc agent reverie authoring (append-only)', () => {
  it('inserts reveries_add as rows and never deletes on omission', async () => {
    const { worldId, turnId } = seedWorld('rev-author')
    db.prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Mara', 0)").run(worldId)
    promoteToLocal(worldId, 'Mara')
    const charId = (db.prepare("SELECT id FROM characters WHERE world_id = ? AND name = 'Mara'").get(worldId) as { id: number }).id

    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Mara', reveries_add: [{ text: 'burnt coffee recalls the outage', match_tags: ['coffee'] }] }],
    })
    expect(getReveriesForCharacter(charId)).toHaveLength(1)

    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, { npc_updates: [{ name: 'Mara', current_focus: 'waiting' }] })
    expect(getReveriesForCharacter(charId)).toHaveLength(1) // omission preserved
  })

  it('authors daily_loop once and does not overwrite it later', async () => {
    const { worldId, turnId } = seedWorld('loop-author')
    db.prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Tomas', 0)").run(worldId)
    promoteToLocal(worldId, 'Tomas')

    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Tomas', daily_loop: { morning: { activity: 'opens the shop' } } }],
    })
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Tomas', daily_loop: { morning: { activity: 'DIFFERENT' } } }],
    })
    const row = db.prepare("SELECT daily_loop FROM characters WHERE world_id = ? AND name = 'Tomas'").get(worldId) as { daily_loop: string | null }
    expect(parseDailyLoop(row.daily_loop)?.morning?.activity).toBe('opens the shop')
  })

  it('authors speech_register once and does not overwrite it later', async () => {
    const { worldId, turnId } = seedWorld('speech-register-author')
    db.prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Tomas', 0)").run(worldId)
    promoteToLocal(worldId, 'Tomas')

    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [
        {
          name: 'Tomas',
          speech_register: 'clipped · bureaucratic · default: counter-question · never monologues',
        },
      ],
    })
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Tomas', speech_register: 'florid · warm · monologues often' }],
    })
    const row = db
      .prepare("SELECT speech_register FROM characters WHERE world_id = ? AND name = 'Tomas'")
      .get(worldId) as { speech_register: string | null }
    expect(row.speech_register).toContain('clipped')
    expect(row.speech_register).not.toContain('florid')
  })

  it('caps speech_register at 200 characters on author', async () => {
    const { worldId, turnId } = seedWorld('speech-register-cap')
    db.prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Tomas', 0)").run(worldId)
    promoteToLocal(worldId, 'Tomas')
    const long = 'x'.repeat(250)
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [{ name: 'Tomas', speech_register: long }],
    })
    const row = db
      .prepare("SELECT speech_register FROM characters WHERE world_id = ? AND name = 'Tomas'")
      .get(worldId) as { speech_register: string | null }
    expect(row.speech_register?.length).toBe(200)
  })
})

describe('speech_hint schema (ephemeral)', () => {
  it('accepts optional speech_hint on planned_actions', () => {
    const parsed = NpcAgentPatchSchema.safeParse({
      planned_actions: [
        {
          npc_name: 'Marcus',
          intent: 'test whether Andrew is lying',
          planned_action: 'turns his chair to face Andrew',
          intent_type: 'confront',
          speech_hint: 'cuts him off; one hard question; no softener',
        },
      ],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.planned_actions?.[0]?.speech_hint).toContain('one hard question')
  })

  it('allows omitting speech_hint', () => {
    const parsed = NpcAgentPatchSchema.safeParse({
      planned_actions: [
        {
          npc_name: 'Marcus',
          intent: 'leave',
          planned_action: 'walks out without a word',
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })
})

describe('sanitizeSpeechHint', () => {
  it('caps and strips long quoted monologues', () => {
    expect(sanitizeSpeechHint('cuts off; one question')).toBe('cuts off; one question')
    expect(sanitizeSpeechHint(null)).toBeNull()
    const dumped =
      'says "This is a very long monologue that the model should not dump into a staging edge field at all, really."'
    const out = sanitizeSpeechHint(dumped)
    expect(out == null || !out.includes('very long monologue')).toBe(true)
    expect(sanitizeSpeechHint('x'.repeat(200))?.length).toBe(160)
  })
})

describe('NPC story context (plot lifecycle)', () => {
  it('includes closed objectives and active pressure in agent user content', async () => {
    const storyContext = buildNpcStoryContext({
      threads: [
        {
          id: 1,
          world_id: 1,
          title: 'Live quest',
          kind: 'quest',
          status: 'active',
          summary: 'Still open',
          stakes: null,
          rewards: null,
          consequences: null,
          hidden: null,
          relevance_tags_json: '[]',
          source_turn_id: 1,
          resolved_turn_id: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 2,
          world_id: 1,
          title: 'Done quest',
          kind: 'quest',
          status: 'resolved',
          summary: 'Settled',
          stakes: null,
          rewards: null,
          consequences: null,
          hidden: null,
          relevance_tags_json: '[]',
          source_turn_id: 2,
          resolved_turn_id: 9,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      clues: [],
      objectives: [
        {
          id: 1,
          world_id: 1,
          thread_id: 2,
          thread_title: 'Done quest',
          title: 'Deliver manifests',
          status: 'completed',
          detail: 'Done at the quay',
          blocker: null,
          source_turn_id: 2,
          completed_turn_id: 9,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      resources: [],
      timeline: [],
    })

    const content = buildNpcAgentUserContent({
      worldTime: 'Morning',
      settingRegion: null,
      protagonistPlace: 'Office',
      openOrderLine: null,
      privateChannelLine: null,
      npcContext: [{ name: 'Marcus', director_slot: 'initiate' }],
      knownPlacesBlock: '- Office',
      priorNarration: 'Marcus watches the door.',
      playerAboutLine: 'PLAYER IS ABOUT TO (this turn): I wait.',
      storyContext,
    })

    expect(content).toContain('STORY CONTEXT')
    expect(content).toContain('Live quest')
    expect(content).toContain('Done quest')
    expect(content).toContain('Deliver manifests')
    expect(content).toContain('recently_closed')
    expect(content).toContain('director_slot')
    expect(content).toContain('initiate')
  })

  it('pins a write-through instruction when the player yielded the floor', () => {
    const content = buildNpcAgentUserContent({
      worldTime: 'Night',
      settingRegion: null,
      protagonistPlace: 'Medical',
      openOrderLine: null,
      privateChannelLine: null,
      npcContext: [{ name: 'Ellis Shaw', director_slot: 'initiate' }],
      knownPlacesBlock: '- Medical',
      priorNarration: 'Ellis closes the ledger.',
      playerAboutLine: 'PLAYER IS ABOUT TO (this turn): continue',
      storyContext: null,
      yieldFloorLine:
        'PLAYER YIELDED THE FLOOR this turn (continue / wait / until-done / time jump). Plan the rest of the current activity as one move.',
    })
    expect(content).toContain('PLAYER YIELDED THE FLOOR')
    expect(content).toContain('rest of the current activity')
  })
})

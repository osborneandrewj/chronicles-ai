import { beforeEach, describe, expect, it } from 'vitest'

import { applyArchivistPatch } from '@/lib/archivist'
import { db, getCharactersForWorld, insertTurn } from '@/lib/db'
import {
  attachIntentsToNarratorTurn,
  getIntentsForPlayerTurn,
  getRecentIntentOutcomesForCharacter,
  insertNpcIntent,
  reconcileIntent,
  reconcileIntentsBatch,
} from '@/lib/npc-intents'
import { createWorld } from '@/lib/worlds'

async function seedWorld(name: string): Promise<{ worldId: number; playerTurnId: number }> {
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
  const turn = insertTurn(world.id, 'user', 'I look at Marcus.', null)
  await applyArchivistPatch(world.id, turn.id, {
    characters: [
      { name: 'Marcus', description: 'Senior engineer.', current_place_name: 'Covenant Security' },
    ],
  })
  db.prepare(
    `UPDATE characters SET agency_level = 'local'
     WHERE world_id = ? AND lower(name) = lower(?)`,
  ).run(world.id, 'Marcus')
  return { worldId: world.id, playerTurnId: turn.id }
}

function marcusId(worldId: number): number {
  const marcus = getCharactersForWorld(worldId).find((c) => c.name === 'Marcus')
  if (!marcus) throw new Error('Marcus missing from world')
  return marcus.id
}

describe('npc_intents persistence', () => {
  let worldId: number
  let playerTurnId: number
  let characterId: number

  beforeEach(async () => {
    ;({ worldId, playerTurnId } = await seedWorld(`NpcIntents-${Math.random()}`))
    characterId = marcusId(worldId)
  })

  it('insertNpcIntent persists planned action with provenance', () => {
    const id = insertNpcIntent({
      worldId,
      characterId,
      playerTurnId,
      agencyLevel: 'local',
      intentText: 'find out what Andrew did last night',
      plannedAction: 'pulls his chair around and asks Andrew about Sanderson',
      intentType: 'confront',
      privateRationale: 'fears the audit',
    })

    const rows = getIntentsForPlayerTurn(playerTurnId)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(id)
    expect(rows[0].character_id).toBe(characterId)
    expect(rows[0].player_turn_id).toBe(playerTurnId)
    expect(rows[0].narrator_turn_id).toBeNull()
    expect(rows[0].intent_text).toBe('find out what Andrew did last night')
    expect(rows[0].planned_action).toBe(
      'pulls his chair around and asks Andrew about Sanderson',
    )
    expect(rows[0].intent_type).toBe('confront')
    expect(rows[0].private_rationale).toBe('fears the audit')
    expect(rows[0].narrator_disposition).toBeNull()
    expect(rows[0].expected_visibility).toBe('narrator')
  })

  it('attachIntentsToNarratorTurn links pending rows to the narrator turn', () => {
    const id = insertNpcIntent({
      worldId,
      characterId,
      playerTurnId,
      agencyLevel: 'local',
      intentText: 'check Slack for messages',
      plannedAction: 'glances at his second monitor',
    })

    const narratorTurn = insertTurn(worldId, 'assistant', 'Marcus glances...', null)
    attachIntentsToNarratorTurn([id], narratorTurn.id)

    const rows = getIntentsForPlayerTurn(playerTurnId)
    expect(rows[0].narrator_turn_id).toBe(narratorTurn.id)
    expect(rows[0].narrator_disposition).toBeNull()
  })

  it('reconcileIntent stamps disposition, interpretation, and confidence', () => {
    const id = insertNpcIntent({
      worldId,
      characterId,
      playerTurnId,
      agencyLevel: 'local',
      intentText: 'leave the meeting',
      plannedAction: 'stands up and walks out without speaking',
    })
    const narratorTurn = insertTurn(worldId, 'assistant', 'He stays...', null)

    reconcileIntent({
      intentId: id,
      narratorTurnId: narratorTurn.id,
      disposition: 'ignored',
      interpretation: 'Marcus stayed in the room — narrator did not stage the exit.',
      outcomeSummary: 'Marcus remained at his desk.',
      confidence: 0.85,
    })

    const rows = getIntentsForPlayerTurn(playerTurnId)
    expect(rows[0].narrator_turn_id).toBe(narratorTurn.id)
    expect(rows[0].narrator_disposition).toBe('ignored')
    expect(rows[0].narrator_interpretation).toBe(
      'Marcus stayed in the room — narrator did not stage the exit.',
    )
    expect(rows[0].outcome_summary).toBe('Marcus remained at his desk.')
    expect(rows[0].reconciliation_confidence).toBeCloseTo(0.85)
  })

  it('reconcileIntentsBatch applies all results in a single transaction', () => {
    const a = insertNpcIntent({
      worldId,
      characterId,
      playerTurnId,
      agencyLevel: 'local',
      intentText: 'a',
      plannedAction: 'walks over to the desk',
    })
    const b = insertNpcIntent({
      worldId,
      characterId,
      playerTurnId,
      agencyLevel: 'local',
      intentText: 'b',
      plannedAction: 'picks up the phone',
    })
    const narratorTurn = insertTurn(worldId, 'assistant', '...', null)

    reconcileIntentsBatch([
      { intentId: a, narratorTurnId: narratorTurn.id, disposition: 'staged', confidence: 0.95 },
      {
        intentId: b,
        narratorTurnId: narratorTurn.id,
        disposition: 'modified',
        interpretation: 'narrator had him text rather than call',
        confidence: 0.7,
      },
    ])

    const rows = getIntentsForPlayerTurn(playerTurnId)
    const dispositions = Object.fromEntries(
      rows.map((r) => [r.id, r.narrator_disposition]),
    )
    expect(dispositions[a]).toBe('staged')
    expect(dispositions[b]).toBe('modified')
  })

  it('getRecentIntentOutcomesForCharacter returns only reconciled rows, newest first', () => {
    const pending = insertNpcIntent({
      worldId,
      characterId,
      playerTurnId,
      agencyLevel: 'local',
      intentText: 'pending',
      plannedAction: 'taps his pen',
    })
    expect(pending).toBeGreaterThan(0)

    const second = insertTurn(worldId, 'user', 'I look at Marcus.', null)
    const reconciled1 = insertNpcIntent({
      worldId,
      characterId,
      playerTurnId: second.id,
      agencyLevel: 'local',
      intentText: 'leave',
      plannedAction: 'gets up and walks out',
    })
    const narratorTurn1 = insertTurn(worldId, 'assistant', '...', null)
    reconcileIntent({
      intentId: reconciled1,
      narratorTurnId: narratorTurn1.id,
      disposition: 'ignored',
    })

    const third = insertTurn(worldId, 'user', 'I ask Marcus a question.', null)
    const reconciled2 = insertNpcIntent({
      worldId,
      characterId,
      playerTurnId: third.id,
      agencyLevel: 'local',
      intentText: 'deflect',
      plannedAction: 'changes the subject',
    })
    const narratorTurn2 = insertTurn(worldId, 'assistant', '...', null)
    reconcileIntent({
      intentId: reconciled2,
      narratorTurnId: narratorTurn2.id,
      disposition: 'staged',
    })

    const outcomes = getRecentIntentOutcomesForCharacter(characterId, 5)
    expect(outcomes.map((o) => o.id)).toEqual([reconciled2, reconciled1])
    expect(outcomes[0].narrator_disposition).toBe('staged')
    expect(outcomes[1].narrator_disposition).toBe('ignored')
  })

  it('intent rows cascade on character deletion', () => {
    insertNpcIntent({
      worldId,
      characterId,
      playerTurnId,
      agencyLevel: 'local',
      intentText: 'a',
      plannedAction: 'b',
    })
    db.prepare('DELETE FROM characters WHERE id = ?').run(characterId)
    expect(getIntentsForPlayerTurn(playerTurnId)).toHaveLength(0)
  })
})

import { describe, expect, it } from 'vitest'

import { decideDirector } from '@/domain/services/director'
import {
  beatDirectedEvent,
  isStoryTabWorldEvent,
  npcReconcileEvents,
  objectiveCompletedEvent,
  outcomeResolvedEvent,
  threadClosedEvent,
} from '@/domain/services/world-event-log'
import { contestedFallback } from '@/domain/services/outcome-resolution'

describe('beatDirectedEvent', () => {
  it('returns null when the director has nothing to record', () => {
    const decision = decideDirector({
      threads: [],
      objectives: [],
      clockMinutes: 0,
      currentTurnId: 1,
      playerText: 'look around',
    })
    expect(
      beatDirectedEvent({
        worldId: 1,
        turnId: 10,
        worldTime: 'morning',
        decision,
      }),
    ).toBeNull()
  })

  it('records a BEAT_DIRECTED row from a foreground decision', () => {
    const decision = decideDirector({
      threads: [
        {
          id: 7,
          title: 'The Sealed Papyrus',
          kind: 'quest',
          status: 'active',
          summary: 'Setnakht carries a letter',
          stakes: null,
          consequences: null,
          hidden: null,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
          source_turn_id: 3,
        },
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 8,
      playerText: 'I ask about the papyrus',
      presentCast: [{ id: 2, name: 'Setnakht' }],
    })
    const event = beatDirectedEvent({
      worldId: 4,
      turnId: 12,
      worldTime: 'dusk',
      decision,
    })
    expect(event).toMatchObject({
      world_id: 4,
      turn_id: 12,
      kind: 'BEAT_DIRECTED',
      source_agent: 'director',
      thread_id: 7,
      visibility: 'system',
    })
    expect(event?.payload.beatKind).toBeTruthy()
    expect(event?.payload.mustStage).toEqual(expect.any(Array))
  })
})

describe('npcReconcileEvents', () => {
  it('maps dispositions onto NPC_* kinds and actor ids', () => {
    const events = npcReconcileEvents({
      worldId: 1,
      turnId: 20,
      worldTime: 'night',
      plans: [
        { intent_id: 11, character_id: 2 },
        { intent_id: 12, character_id: 3 },
      ],
      results: [
        { intent_id: 11, disposition: 'staged' },
        { intent_id: 12, disposition: 'contradicted', interpretation: 'left first' },
      ],
    })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      kind: 'NPC_STAGED',
      actor_id: 2,
      source_agent: 'reconciler',
      payload: { intent_id: 11, disposition: 'staged' },
    })
    expect(events[1]).toMatchObject({
      kind: 'NPC_IGNORED',
      actor_id: 3,
      payload: { intent_id: 12, disposition: 'contradicted' },
    })
  })
})

describe('lifecycle world events', () => {
  it('records THREAD_CLOSED and OBJECTIVE_COMPLETED', () => {
    expect(
      threadClosedEvent({
        worldId: 1,
        turnId: 4,
        worldTime: 'dusk',
        threadId: 7,
        status: 'resolved',
        title: 'The Heist',
      }),
    ).toMatchObject({
      kind: 'THREAD_CLOSED',
      source_agent: 'director',
      thread_id: 7,
      payload: { status: 'resolved', title: 'The Heist' },
    })
    expect(
      objectiveCompletedEvent({
        worldId: 1,
        turnId: 4,
        worldTime: 'dusk',
        objectiveId: 2,
        status: 'completed',
        title: 'Crack the vault',
      }),
    ).toMatchObject({
      kind: 'OBJECTIVE_COMPLETED',
      payload: { objective_id: 2, status: 'completed' },
    })
  })
})

describe('outcomeResolvedEvent', () => {
  it('records a binding conductor resolution and skips not_applicable', () => {
    const event = outcomeResolvedEvent({
      worldId: 3,
      turnId: 9,
      worldTime: 'dusk',
      resolution: contestedFallback('I kill the king'),
    })
    expect(event).toMatchObject({
      kind: 'OUTCOME_RESOLVED',
      source_agent: 'conductor',
      visibility: 'system',
      payload: { outcome: 'partial_success' },
    })
    expect(
      outcomeResolvedEvent({
        worldId: 3,
        turnId: 9,
        worldTime: 'dusk',
        resolution: {
          intent: 'look around',
          stance: 'attempt',
          inputMode: 'tactical_intent',
          outcome: 'not_applicable',
          worldStateDelta: '',
        },
      }),
    ).toBeNull()
  })
})

describe('isStoryTabWorldEvent', () => {
  it('hides closure rows from Story; keeps referee outcomes; drops per-turn coordination', () => {
    expect(isStoryTabWorldEvent({ kind: 'THREAD_CLOSED' })).toBe(false)
    expect(isStoryTabWorldEvent({ kind: 'OBJECTIVE_COMPLETED' })).toBe(false)
    expect(isStoryTabWorldEvent({ kind: 'OUTCOME_RESOLVED' })).toBe(true)
    expect(isStoryTabWorldEvent({ kind: 'BEAT_DIRECTED' })).toBe(false)
    expect(isStoryTabWorldEvent({ kind: 'NPC_STAGED' })).toBe(false)
    expect(isStoryTabWorldEvent({ kind: 'NPC_MODIFIED' })).toBe(false)
    expect(isStoryTabWorldEvent({ kind: 'NPC_IGNORED' })).toBe(false)
  })
})

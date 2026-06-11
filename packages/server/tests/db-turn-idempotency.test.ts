import { beforeEach, describe, expect, it } from 'vitest'

import {
  insertTurn,
  latestAssistantAfterLatestUser,
  latestTurn,
  userTurnCount,
} from '@/lib/db'
import { createWorld } from '@/lib/worlds'

function seedWorld(): number {
  return createWorld({
    name: `Idempotency-${Math.random()}`,
    premise: 'A quiet office.',
    initialState: {
      time: 'Morning',
      location: 'Covenant Security',
      identity: 'Engineer.',
      playerName: 'Andrew',
    },
  }).id
}

describe('turn idempotency helpers', () => {
  let worldId: number

  beforeEach(() => {
    worldId = seedWorld()
  })

  it('finds the assistant response paired with the latest user turn', () => {
    insertTurn(worldId, 'user', 'I open my texts', null)
    const assistant = insertTurn(worldId, 'assistant', 'The messages app opens.', null)

    expect(latestTurn(worldId)?.id).toBe(assistant.id)
    expect(latestAssistantAfterLatestUser(worldId)?.id).toBe(assistant.id)
  })

  it('returns no completed assistant while the latest user turn is still in flight', () => {
    insertTurn(worldId, 'user', 'I open my texts', null)

    expect(latestTurn(worldId)?.role).toBe('user')
    expect(latestAssistantAfterLatestUser(worldId)).toBeNull()
  })

  it('counts only user turns for archivist throttling', () => {
    insertTurn(worldId, 'assistant', 'Opening narration.', null)
    insertTurn(worldId, 'user', 'I look around.', null)
    insertTurn(worldId, 'assistant', 'You look around.', null)

    expect(userTurnCount(worldId)).toBe(1)
  })
})

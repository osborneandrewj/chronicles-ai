import { describe, expect, it } from 'vitest'

import {
  detectOpenOrder,
  deriveActiveOpenOrder,
  formatOpenOrderStatusLine,
  isExplicitTimeJump,
  isPlayerYieldingFloor,
  isYieldMove,
  openOrderFromMetadata,
  openOrderToMetadata,
  OPEN_ORDER_TTL_PLAYER_TURNS,
  type OpenOrder,
} from '@/domain/services/open-order'

const chars = [
  { id: 10, name: 'Andy Osborne', aliases: 'Andy', is_player: 0 as const, status: 'active' },
  { id: 11, name: 'Marcus', is_player: 0 as const, status: 'active' },
  { id: 1, name: 'Player', is_player: 1 as const, status: 'active' },
]

describe('detectOpenOrder', () => {
  it('detects retrieve/bring orders naming a known character', () => {
    const order = detectOpenOrder('Andy Osborne. Bring him to me, now.', chars, 100)
    expect(order).not.toBeNull()
    expect(order!.targetCharacterId).toBe(10)
    expect(order!.targetName).toBe('Andy Osborne')
    expect(order!.kind).toBe('retrieve')
    expect(order!.status).toBe('pending')
    expect(order!.expiresAfterPlayerTurns).toBe(OPEN_ORDER_TTL_PLAYER_TURNS)
    expect(order!.createdTurnId).toBe(100)
  })

  it('detects wait-for / await orders', () => {
    const order = detectOpenOrder('I sit down and wait for Andy', chars, 101)
    expect(order).not.toBeNull()
    expect(order!.kind).toBe('await')
    expect(order!.targetCharacterId).toBe(10)
  })

  it('is conservative — no order without a known name + retrieve/wait verb', () => {
    expect(detectOpenOrder('I look around the room carefully', chars, 1)).toBeNull()
    expect(detectOpenOrder('Bring someone to me', chars, 1)).toBeNull()
    expect(detectOpenOrder('Andy is nice', chars, 1)).toBeNull()
  })

  it('does not target the player character', () => {
    expect(detectOpenOrder('Bring Player to me now', chars, 1)).toBeNull()
  })
})

describe('isYieldMove / isExplicitTimeJump', () => {
  it('recognizes continue / wait / time-jump as yield', () => {
    expect(isYieldMove('Continue')).toBe(true)
    expect(isYieldMove('I wait')).toBe(true)
    expect(isYieldMove('I sit down and wait for Andy')).toBe(true)
    expect(isExplicitTimeJump('10 minutes later')).toBe(true)
    expect(isYieldMove('10 minutes later')).toBe(true)
    expect(isYieldMove('I charge the line with my spear')).toBe(false)
  })
})

describe('isPlayerYieldingFloor', () => {
  it('treats bare continue, wait-until-done, and time jumps as yielding the floor', () => {
    expect(isPlayerYieldingFloor('continue')).toBe(true)
    expect(isPlayerYieldingFloor('I wait')).toBe(true)
    expect(isPlayerYieldingFloor('I lay still until the tests are done')).toBe(true)
    expect(isPlayerYieldingFloor('I wait until the examination is done.')).toBe(true)
    expect(isPlayerYieldingFloor('10 minutes later')).toBe(true)
  })

  it('does not treat driving continue-the-X or look-around as yielding the floor', () => {
    expect(isPlayerYieldingFloor('continue the investigation')).toBe(false)
    expect(isPlayerYieldingFloor('I look around')).toBe(false)
    expect(isPlayerYieldingFloor('I ask Ellis what the tests show')).toBe(false)
    expect(isPlayerYieldingFloor('I stand as I wait for Lena to respond')).toBe(false)
  })
})

describe('deriveActiveOpenOrder', () => {
  it('recovers a pending order from prior user-turn content (durable/derivable)', () => {
    const order = deriveActiveOpenOrder(
      [
        { id: 100, content: 'Andy Osborne. Bring him to me, now.' },
        { id: 102, content: 'I sit down and wait for Andy' },
        { id: 104, content: 'Continue' },
      ],
      chars,
      {
        currentPlayerTurnId: 104,
        currentPlayerText: 'Continue',
      },
    )
    expect(order).not.toBeNull()
    expect(order!.status).toBe('pending')
    expect(order!.targetName).toBe('Andy Osborne')
    // Yield refresh should bump refreshedAtTurnId
    expect(order!.refreshedAtTurnId).toBe(104)
  })

  it('keeps the Threshold 4-beat script alive via yield refresh (TTL 4)', () => {
    // retrieve → wait → continue → time-jump (4 yield-ish beats after create)
    const order = deriveActiveOpenOrder(
      [
        { id: 100, content: 'Bring Andy to me now.' },
        { id: 102, content: 'I wait' },
        { id: 104, content: 'Continue' },
        { id: 106, content: '10 minutes later' },
      ],
      chars,
      {
        currentPlayerTurnId: 106,
        currentPlayerText: '10 minutes later',
      },
    )
    expect(order).not.toBeNull()
    expect(order!.status).toBe('pending')
    expect(order!.refreshedAtTurnId).toBe(106)
  })

  it('expires when TTL elapses without yield refresh', () => {
    // created at 100, then 4 non-yield driving turns without refresh
    const order = deriveActiveOpenOrder(
      [
        { id: 100, content: 'Bring Andy to me now.' },
        { id: 102, content: 'I search the drawers carefully for a key' },
        { id: 104, content: 'I examine the blueprints on the table' },
        { id: 106, content: 'I walk to the far console and open a log' },
        { id: 108, content: 'I demand the security chief explain the breach' },
      ],
      chars,
      {
        currentPlayerTurnId: 108,
        currentPlayerText: 'I demand the security chief explain the breach',
      },
    )
    // After create, 4 player turns with no yield → expired
    expect(order).not.toBeNull()
    expect(order!.status).toBe('expired')
  })

  it('resolves when the target is present', () => {
    const order = deriveActiveOpenOrder(
      [{ id: 100, content: 'Bring Andy to me now.' }],
      chars,
      {
        currentPlayerTurnId: 102,
        currentPlayerText: 'I wait',
        presentCharacterIds: new Set([10]),
      },
    )
    expect(order!.status).toBe('resolved')
    expect(order!.resolution).toBe('arrived')
  })

  it('prefers durable metadata open_order blocks', () => {
    const stored: OpenOrder = {
      targetCharacterId: 10,
      targetName: 'Andy Osborne',
      kind: 'retrieve',
      createdTurnId: 50,
      expiresAfterPlayerTurns: 4,
      status: 'pending',
      refreshedAtTurnId: 50,
    }
    const order = deriveActiveOpenOrder(
      [
        { id: 50, content: 'something unrelated', openOrder: stored },
        { id: 52, content: 'Continue' },
      ],
      chars,
      {
        currentPlayerTurnId: 52,
        currentPlayerText: 'Continue',
      },
    )
    expect(order!.createdTurnId).toBe(50)
    expect(order!.status).toBe('pending')
  })

  it('round-trips metadata serialization', () => {
    const order = detectOpenOrder('Bring Andy here', chars, 9)!
    const raw = openOrderToMetadata(order)
    const back = openOrderFromMetadata(raw)
    expect(back).toEqual(order)
  })
})

describe('formatOpenOrderStatusLine', () => {
  const pending: OpenOrder = {
    targetCharacterId: 10,
    targetName: 'Andy Osborne',
    kind: 'retrieve',
    createdTurnId: 1,
    expiresAfterPlayerTurns: 4,
    status: 'pending',
  }

  it('surfaces transit / still-at / last_known as authoritative status', () => {
    expect(
      formatOpenOrderStatusLine(pending, {
        name: 'Andy Osborne',
        current_place_name: 'Administrative Wing',
        last_known_situation: null,
      }),
    ).toContain('still at Administrative Wing')

    expect(
      formatOpenOrderStatusLine(pending, {
        name: 'Andy Osborne',
        in_transit_to_name: 'Ops Floor',
        arrival_world_time: '18:20',
      }),
    ).toMatch(/in transit to Ops Floor.*ETA 18:20/)

    expect(
      formatOpenOrderStatusLine(pending, {
        name: 'Andy Osborne',
        last_known_situation: 'leaving the cafeteria, radio in hand',
      }),
    ).toContain('leaving the cafeteria')
  })

  it('marks present as arrived', () => {
    expect(
      formatOpenOrderStatusLine(pending, {
        name: 'Andy Osborne',
        present_with_protagonist: true,
      }),
    ).toMatch(/present|arrived/i)
  })
})

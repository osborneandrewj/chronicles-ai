import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { buildCostMap, effectiveDbTurnId } from '@/lib/turn-cost-map'
import type { TurnCost } from '@/lib/turn-cost'

// Minimal UIMessage builder — buildCostMap/effectiveDbTurnId only read id, role,
// parts, and metadata, so the rest of the UIMessage surface is irrelevant here.
function msg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  metadata?: { dbTurnId?: number },
): UIMessage {
  return { id, role, parts: [{ type: 'text', text }], metadata } as unknown as UIMessage
}

function cost(id: number, total: number): TurnCost {
  return { id, total }
}

describe('effectiveDbTurnId', () => {
  it('prefers metadata.dbTurnId over a non-numeric (live) message id', () => {
    expect(effectiveDbTurnId(msg('msg-abc', 'assistant', 'hi', { dbTurnId: 42 }))).toBe(42)
  })

  it('falls back to a numeric (history-loaded) message id when no metadata id', () => {
    expect(effectiveDbTurnId(msg('17', 'assistant', 'hi'))).toBe(17)
  })

  it('returns undefined for a live id with no dbTurnId yet', () => {
    expect(effectiveDbTurnId(msg('msg-xyz', 'assistant', 'hi'))).toBeUndefined()
  })

  it('ignores a zero/negative dbTurnId and falls back to the numeric id', () => {
    expect(effectiveDbTurnId(msg('9', 'assistant', 'hi', { dbTurnId: 0 }))).toBe(9)
  })
})

describe('buildCostMap', () => {
  it('matches a live streamed turn to its usage via metadata.dbTurnId', () => {
    const messages = [
      msg('u1', 'user', 'I look around.'),
      msg('msg-live', 'assistant', 'The wind picks up.', { dbTurnId: 42 }),
    ]
    const usage = [cost(42, 0.0031)]
    const map = buildCostMap(messages, usage)
    // Keyed by the message id, valued by the dbTurnId-matched usage row.
    expect(map.get('msg-live')).toEqual(cost(42, 0.0031))
  })

  it('matches a history-loaded turn by its numeric message id', () => {
    const messages = [msg('u1', 'user', 'Hello.'), msg('10', 'assistant', 'A reply.')]
    const map = buildCostMap(messages, [cost(10, 0.002)])
    expect(map.get('10')).toEqual(cost(10, 0.002))
  })

  it('skips meta-command responses', () => {
    const messages = [
      msg('u-meta', 'user', '/pause'),
      msg('msg-meta', 'assistant', 'Paused.', { dbTurnId: 99 }),
    ]
    const map = buildCostMap(messages, [cost(99, 0.5)])
    expect(map.has('msg-meta')).toBe(false)
  })

  it('end-aligns an unmatched live turn (dbTurnId not yet arrived) with the newest usage', () => {
    const messages = [
      msg('u1', 'user', 'Go on.'),
      msg('msg-pending', 'assistant', 'Still no DB id.'),
    ]
    // The fallback pass pairs the lone unmatched assistant with the lone usage row.
    const map = buildCostMap(messages, [cost(55, 0.004)])
    expect(map.get('msg-pending')).toEqual(cost(55, 0.004))
  })
})

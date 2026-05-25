import { beforeEach, describe, expect, it } from 'vitest'

import { dailyTokenLimit, isOverDailyLimit, todaysTokens } from '@/lib/cost-cap'
import { db, insertTurn } from '@/lib/db'
import { createWorld } from '@/lib/worlds'

// The cost-cap query is global (no world filter), so tests share the same
// daily total. Each test records the baseline before inserting its rows and
// asserts on the delta. The singleton in-memory DB is fresh per worker process.
function seedWorld(): number {
  return createWorld({
    name: `Cost-${Math.random()}`,
    premise: 'A coastal village in autumn 1897.',
    initialState: {
      time: 'Late afternoon',
      location: 'Mevagissey harbour, Cornwall',
      identity: 'Travel-worn letter-writer.',
      playerName: 'Edith',
    },
  }).id
}

function insertTurnWithMetadata(
  worldId: number,
  metadata: Record<string, unknown>,
  createdAtSql = "datetime('now')",
): number {
  const turn = insertTurn(worldId, 'assistant', 'x', null)
  db.prepare(`UPDATE turns SET metadata = ?, created_at = ${createdAtSql} WHERE id = ?`).run(
    JSON.stringify(metadata),
    turn.id,
  )
  return turn.id
}

describe('todaysTokens', () => {
  let worldId: number
  let baseline: number

  beforeEach(() => {
    worldId = seedWorld()
    baseline = todaysTokens()
  })

  it('sums narrator input + output for today', () => {
    insertTurnWithMetadata(worldId, {
      narrator: { usage: { inputTokens: 10, outputTokens: 20 } },
    })
    expect(todaysTokens() - baseline).toBe(30)
  })

  it('sums archivist input + output (post-v0.5 key)', () => {
    insertTurnWithMetadata(worldId, {
      archivist: { usage: { inputTokens: 100, outputTokens: 50 } },
    })
    expect(todaysTokens() - baseline).toBe(150)
  })

  it('sums extractor input + output (pre-v0.5 key)', () => {
    insertTurnWithMetadata(worldId, {
      extractor: { usage: { inputTokens: 7, outputTokens: 3 } },
    })
    expect(todaysTokens() - baseline).toBe(10)
  })

  it('sums classifier input + output', () => {
    insertTurnWithMetadata(worldId, {
      classifier: { usage: { inputTokens: 5, outputTokens: 5 } },
    })
    expect(todaysTokens() - baseline).toBe(10)
  })

  it('sums all four keys together when present on a mixed row', () => {
    insertTurnWithMetadata(worldId, {
      narrator: { usage: { inputTokens: 1, outputTokens: 2 } },
      archivist: { usage: { inputTokens: 4, outputTokens: 8 } },
      extractor: { usage: { inputTokens: 16, outputTokens: 32 } },
      classifier: { usage: { inputTokens: 64, outputTokens: 128 } },
    })
    expect(todaysTokens() - baseline).toBe(1 + 2 + 4 + 8 + 16 + 32 + 64 + 128)
  })

  it('ignores rows whose metadata is missing the usage keys', () => {
    insertTurnWithMetadata(worldId, { tts: { chars: 1234 } })
    expect(todaysTokens() - baseline).toBe(0)
  })

  it('ignores rows with NULL metadata entirely', () => {
    insertTurn(worldId, 'assistant', 'no metadata', null)
    expect(todaysTokens() - baseline).toBe(0)
  })

  it('excludes rows whose created_at is not today (UTC)', () => {
    insertTurnWithMetadata(
      worldId,
      { archivist: { usage: { inputTokens: 9_999, outputTokens: 9_999 } } },
      "datetime('now', '-2 days')",
    )
    expect(todaysTokens() - baseline).toBe(0)
  })

  it('regression: a 200k archivist row alone trips the default 200k cap', () => {
    insertTurnWithMetadata(worldId, {
      archivist: { usage: { inputTokens: 150_000, outputTokens: 50_000 } },
    })
    expect(todaysTokens() - baseline).toBe(200_000)
    expect(dailyTokenLimit()).toBe(200_000)
    expect(isOverDailyLimit()).toBe(true)
  })
})

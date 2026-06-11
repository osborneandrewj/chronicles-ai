import { describe, expect, it } from 'vitest'

import { addTtsChars, db, getCachedTtsAudio, insertTurn, storeCachedTtsAudio } from '@/lib/db'
import { createWorld } from '@/lib/worlds'

// These tests seed two fresh worlds on the shared in-memory singleton, then
// walk the world/role binding through a single accumulating scenario. The
// 150-total accumulation in case (d) assumes the 100 credited in case (a)
// is still present on the assistant turn (and that the (b) and (c) attempts
// did NOT mutate it), so the cases must share state — they're written as
// sequential `it` blocks in a single `describe` with no per-test reset.
// Metadata is read back via json_extract to keep the assertion as close to
// the storage layer as the production query.
function seedWorld(name: string): { worldId: number } {
  const world = createWorld({
    name,
    premise: 'A coastal village in autumn 1897.',
    initialState: {
      time: 'Late afternoon',
      location: 'Mevagissey harbour, Cornwall',
      identity: 'Travel-worn letter-writer.',
      playerName: 'Edith',
    },
  })
  return { worldId: world.id }
}

function readTtsChars(turnId: number): number | null {
  const row = db
    .prepare(`SELECT json_extract(metadata, '$.tts.chars') AS chars FROM turns WHERE id = ?`)
    .get(turnId) as { chars: number | null } | undefined
  return row?.chars ?? null
}

describe('addTtsChars world+role binding', () => {
  const worldA = seedWorld(`A-${Math.random()}`).worldId
  const worldB = seedWorld(`B-${Math.random()}`).worldId
  const assistantTurnA = insertTurn(worldA, 'assistant', 'The wind picks up.', null).id
  const userTurnA = insertTurn(worldA, 'user', 'I look around.', null).id

  it('(a) credits chars when worldId + turnId + assistant role all match', () => {
    addTtsChars(worldA, assistantTurnA, 100)
    expect(readTtsChars(assistantTurnA)).toBe(100)
  })

  it('(b) rejects a cross-world write: world B with a turn that belongs to world A', () => {
    addTtsChars(worldB, assistantTurnA, 999)
    expect(readTtsChars(assistantTurnA)).toBe(100)
  })

  it("(c) rejects a write against a 'user' turn even within the same world", () => {
    addTtsChars(worldA, userTurnA, 50)
    expect(readTtsChars(userTurnA)).toBeNull()
  })

  it('(d) is additive within a world: two more 25-char writes bring the total to 150', () => {
    addTtsChars(worldA, assistantTurnA, 25)
    addTtsChars(worldA, assistantTurnA, 25)
    expect(readTtsChars(assistantTurnA)).toBe(150)
  })
})

describe('TTS audio replay cache', () => {
  it('keys entries by world, turn, model, voice, and text hash', () => {
    const worldId = seedWorld(`cache-${Math.random()}`).worldId
    const turnId = insertTurn(worldId, 'assistant', 'The sea goes quiet.', null).id

    storeCachedTtsAudio({
      worldId,
      turnId,
      modelKey: 'model-a',
      voiceId: 'eve',
      textHash: 'hash-a',
      contentType: 'audio/mpeg',
      audio: Buffer.from('audio-a'),
    })

    expect(getCachedTtsAudio(worldId, turnId, 'model-a', 'eve', 'hash-a')?.audio.toString()).toBe(
      'audio-a',
    )
    expect(getCachedTtsAudio(worldId, turnId, 'model-a', 'other-voice', 'hash-a')).toBeNull()
    expect(getCachedTtsAudio(worldId, turnId, 'model-b', 'eve', 'hash-a')).toBeNull()
    expect(getCachedTtsAudio(worldId, turnId, 'model-a', 'eve', 'hash-b')).toBeNull()
  })

  it('rejects non-assistant or cross-world cache writes and prunes to the newest turns', () => {
    const worldA = seedWorld(`cache-prune-a-${Math.random()}`).worldId
    const worldB = seedWorld(`cache-prune-b-${Math.random()}`).worldId
    const assistantA1 = insertTurn(worldA, 'assistant', 'One.', null).id
    const assistantA2 = insertTurn(worldA, 'assistant', 'Two.', null).id
    const assistantA3 = insertTurn(worldA, 'assistant', 'Three.', null).id
    const userA = insertTurn(worldA, 'user', 'Nope.', null).id

    storeCachedTtsAudio({
      worldId: worldB,
      turnId: assistantA1,
      modelKey: 'model-a',
      voiceId: 'eve',
      textHash: 'wrong-world',
      contentType: 'audio/mpeg',
      audio: Buffer.from('wrong-world'),
    })
    storeCachedTtsAudio({
      worldId: worldA,
      turnId: userA,
      modelKey: 'model-a',
      voiceId: 'eve',
      textHash: 'user-turn',
      contentType: 'audio/mpeg',
      audio: Buffer.from('user-turn'),
    })
    expect(getCachedTtsAudio(worldB, assistantA1, 'model-a', 'eve', 'wrong-world')).toBeNull()
    expect(getCachedTtsAudio(worldA, userA, 'model-a', 'eve', 'user-turn')).toBeNull()

    for (const [idx, turnId] of [assistantA1, assistantA2, assistantA3].entries()) {
      storeCachedTtsAudio({
        worldId: worldA,
        turnId,
        modelKey: 'model-a',
        voiceId: 'eve',
        textHash: `hash-${idx}`,
        contentType: 'audio/mpeg',
        audio: Buffer.from(`audio-${idx}`),
        turnsPerWorld: 2,
      })
    }

    expect(getCachedTtsAudio(worldA, assistantA1, 'model-a', 'eve', 'hash-0')).toBeNull()
    expect(getCachedTtsAudio(worldA, assistantA2, 'model-a', 'eve', 'hash-1')).not.toBeNull()
    expect(getCachedTtsAudio(worldA, assistantA3, 'model-a', 'eve', 'hash-2')).not.toBeNull()
  })

  it('retains by turn, not by entry: a multi-chunk newest turn never evicts its own chunks', () => {
    // The distinguishing case from entry-count retention. Turn 3 has TWO cache
    // entries (two text hashes — the shape v0.6.12 multi-chunk caching produces).
    // Turn-based retention (turnsPerWorld=2) keeps the newest 2 distinct turns
    // (turn 2 and turn 3) in full; only turn 1 is evicted. Entry-count=2 would
    // instead keep just turn 3's two entries and wrongly evict turn 2.
    const worldId = seedWorld(`cache-turns-${Math.random()}`).worldId
    const t1 = insertTurn(worldId, 'assistant', 'First.', null).id
    const t2 = insertTurn(worldId, 'assistant', 'Second.', null).id
    const t3 = insertTurn(worldId, 'assistant', 'Third — a longer turn.', null).id

    const store = (turnId: number, textHash: string) =>
      storeCachedTtsAudio({
        worldId,
        turnId,
        modelKey: 'model-a',
        voiceId: 'eve',
        textHash,
        contentType: 'audio/mpeg',
        audio: Buffer.from(`audio-${turnId}-${textHash}`),
        turnsPerWorld: 2,
      })

    store(t1, 'h1')
    store(t2, 'h2')
    store(t3, 'chunk-a')
    store(t3, 'chunk-b')

    expect(getCachedTtsAudio(worldId, t1, 'model-a', 'eve', 'h1')).toBeNull()
    expect(getCachedTtsAudio(worldId, t2, 'model-a', 'eve', 'h2')).not.toBeNull()
    expect(getCachedTtsAudio(worldId, t3, 'model-a', 'eve', 'chunk-a')).not.toBeNull()
    expect(getCachedTtsAudio(worldId, t3, 'model-a', 'eve', 'chunk-b')).not.toBeNull()
  })
})

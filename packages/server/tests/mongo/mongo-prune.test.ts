import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MongoReverieRepository } from '@/infrastructure/persistence/mongo/repositories/reverie-repository.mongo'
import { MongoTtsCacheRepository } from '@/infrastructure/persistence/mongo/repositories/tts-cache-repository.mongo'
import { MongoTurnRepository } from '@/infrastructure/persistence/mongo/repositories/turn-repository.mongo'

import { replSetAvailable, startReplSet, type ReplSetHandle } from './replset'

// Prune-logic suite (spec §4.6): the npc_reveries cap-3 eviction and the
// tts_audio_cache turn-based retention prune must port, not just the inserts.
// Guarded behind MongoMemoryReplSet availability.

const available = await replSetAvailable()
const d = available ? describe : describe.skip

d('mongo prune logic', () => {
  let h: ReplSetHandle

  beforeAll(async () => {
    const handle = await startReplSet()
    if (!handle) throw new Error('replica set unexpectedly unavailable')
    h = handle
  }, 120_000)

  afterAll(async () => {
    if (h) await h.stop()
  })

  describe('reverie cap-3 eviction', () => {
    it('keeps the strongest 3 reveries per NPC and evicts the rest', async () => {
      const reveries = new MongoReverieRepository(h.ctx)
      await reveries.add(2001, 50, [
        { text: 'weak one', intensity: 0.1 },
        { text: 'medium two', intensity: 0.5 },
        { text: 'strong three', intensity: 0.9 },
        { text: 'strongest four', intensity: 0.95 },
        { text: 'mid five', intensity: 0.4 },
      ], 1)
      const kept = await reveries.forCharacter(50)
      expect(kept).toHaveLength(3)
      const texts = kept.map((r) => r.text).sort()
      expect(texts).toEqual(['medium two', 'strong three', 'strongest four'].sort())
    })

    it('dedupes by normalized text (case + whitespace) before pruning', async () => {
      // normalizeReverieText = trim + lowercase + collapse whitespace (no
      // punctuation stripping — mirrors the SQLite path exactly).
      const reveries = new MongoReverieRepository(h.ctx)
      await reveries.add(2002, 51, [{ text: 'A Vivid  Memory', intensity: 0.5 }], 1)
      await reveries.add(2002, 51, [{ text: '  a vivid memory  ', intensity: 0.6 }], 2)
      const kept = await reveries.forCharacter(51)
      expect(kept).toHaveLength(1)
    })
  })

  describe('tts retention prune', () => {
    it('keeps cache rows for the newest N distinct turns, evicting older turns', async () => {
      const turns = new MongoTurnRepository(h.ctx)
      const cache = new MongoTtsCacheRepository(h.ctx)
      await h.ctx.models.World.create({
        id: 2003,
        name: 'tts-prune',
        premise: 'p',
        createdAt: new Date(),
      })
      // three assistant turns
      const t1 = await turns.insert(2003, 'assistant', 'one')
      const t2 = await turns.insert(2003, 'assistant', 'two')
      const t3 = await turns.insert(2003, 'assistant', 'three')
      const audio = Buffer.from('audio-bytes')
      for (const t of [t1, t2, t3]) {
        await cache.store({
          worldId: 2003,
          turnId: t.id,
          modelKey: 'm',
          voiceId: 'v',
          textHash: `h-${t.id}`,
          contentType: 'audio/mpeg',
          audio,
          turnsPerWorld: 2,
        })
      }
      // Only the newest 2 distinct turns survive.
      const remaining = (await h.ctx.models.TtsAudioCache.find({ worldId: 2003 })
        .distinct('turnId')) as number[]
      expect(remaining.sort((a, b) => a - b)).toEqual([t2.id, t3.id].sort((a, b) => a - b))
      // The oldest is gone.
      const oldest = await cache.get(2003, t1.id, 'm', 'v', `h-${t1.id}`)
      expect(oldest).toBeNull()
    })

    it('does not cache for a non-assistant or missing turn', async () => {
      const cache = new MongoTtsCacheRepository(h.ctx)
      await cache.store({
        worldId: 2003,
        turnId: 999999,
        modelKey: 'm',
        voiceId: 'v',
        textHash: 'nope',
        contentType: 'audio/mpeg',
        audio: Buffer.from('x'),
      })
      const got = await cache.get(2003, 999999, 'm', 'v', 'nope')
      expect(got).toBeNull()
    })
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MongoTurnRepository } from '@/infrastructure/persistence/mongo/repositories/turn-repository.mongo'
import { MongoUnitOfWork } from '@/infrastructure/persistence/mongo/mongo-unit-of-work'

import { replSetAvailable, startReplSet, type ReplSetHandle } from './replset'

// Mongo adapter suite (spec §5.2). Runs against a real MongoMemoryReplSet so
// transactions are honored. Guarded behind availability: if the environment
// can't download/run the memory server, every test is skipped and the mongo
// work is reported as complete-but-unverified (NEVER gate-passed).

const available = await replSetAvailable()
const d = available ? describe : describe.skip

if (!available) {
  console.warn(
    '[mongo suite] MongoMemoryReplSet unavailable — skipping mongo adapter tests. ' +
      'The mongo adapter code is complete but UNVERIFIED in this environment.',
  )
}

d('mongo persistence adapters', () => {
  let h: ReplSetHandle

  beforeAll(async () => {
    const handle = await startReplSet()
    if (!handle) throw new Error('replica set unexpectedly unavailable')
    h = handle
  }, 120_000)

  afterAll(async () => {
    if (h) await h.stop()
  })

  // Seed a minimal world + an assistant turn helper used by several tests.
  async function seedWorld(id: number, name: string): Promise<void> {
    await h.ctx.models.World.create({
      id,
      name,
      premise: 'p',
      initialState: { time: 't', location: 'l', identity: 'i' },
      settingRegion: null,
      worldTime: null,
      currentSceneId: null,
      archivedAt: null,
      createdAt: new Date(),
    })
  }

  describe('unique index enforcement', () => {
    it('rejects a duplicate character nameKey with E11000', async () => {
      await seedWorld(1001, 'unique-world')
      const now = new Date()
      const base = {
        worldId: 1001,
        name: 'Marcus',
        nameKey: 'marcus',
        status: 'active' as const,
        agencyLevel: 'npc' as const,
        createdAt: now,
        updatedAt: now,
      }
      await h.ctx.models.Character.create({ ...base, id: await h.ctx.nextSeq('characterId') })
      await expect(
        h.ctx.models.Character.create({
          ...base,
          id: await h.ctx.nextSeq('characterId'),
        }),
      ).rejects.toMatchObject({ code: 11000 })
    })

    it('rejects a duplicate story-thread titleKey with E11000', async () => {
      await seedWorld(1002, 'thread-world')
      const now = new Date()
      const base = {
        worldId: 1002,
        title: 'The Heist',
        titleKey: 'the heist',
        kind: 'quest' as const,
        status: 'active' as const,
        relevanceTagsJson: '[]',
        createdAt: now,
        updatedAt: now,
      }
      await h.ctx.models.StoryThread.create({ ...base, id: await h.ctx.nextSeq('threadId') })
      await expect(
        h.ctx.models.StoryThread.create({ ...base, id: await h.ctx.nextSeq('threadId') }),
      ).rejects.toMatchObject({ code: 11000 })
    })
  })

  describe('counters seq monotonicity', () => {
    it('allocates strictly increasing turn seqs under concurrent inserts', async () => {
      await seedWorld(1003, 'seq-world')
      const turns = new MongoTurnRepository(h.ctx)
      const inserted = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          turns.insert(1003, i % 2 === 0 ? 'user' : 'assistant', `t${i}`),
        ),
      )
      const seqs = inserted.map((t) => t.id).sort((a, b) => a - b)
      // strictly monotone (no dupes, no gaps within the allocated block)
      const unique = new Set(seqs)
      expect(unique.size).toBe(seqs.length)
      for (let i = 1; i < seqs.length; i += 1) {
        expect(seqs[i]).toBe(seqs[i - 1] + 1)
      }
    })

    it('never reuses a turn seq across worlds (global counter)', async () => {
      await seedWorld(1004, 'global-a')
      await seedWorld(1005, 'global-b')
      const turns = new MongoTurnRepository(h.ctx)
      const a = await turns.insert(1004, 'user', 'a')
      const b = await turns.insert(1005, 'user', 'b')
      expect(b.id).toBeGreaterThan(a.id)
    })
  })

  describe('metadata merge ($set nested path is additive per agent)', () => {
    it('mergeMetadata writes disjoint agent keys without clobbering siblings', async () => {
      await seedWorld(1006, 'meta-world')
      const turns = new MongoTurnRepository(h.ctx)
      const t = await turns.insert(1006, 'assistant', 'narration')
      await turns.mergeMetadata(t.id, 'narrator', { usage: { inputTokens: 10 } })
      await turns.mergeMetadata(t.id, 'archivist', { usage: { inputTokens: 5 } })
      const doc = await h.ctx.models.Turn.findOne({ seq: t.id }).lean()
      expect(doc?.metadata).toMatchObject({
        narrator: { usage: { inputTokens: 10 } },
        archivist: { usage: { inputTokens: 5 } },
      })
    })

    it('re-merging one agent key replaces only that block', async () => {
      await seedWorld(1007, 'meta-world-2')
      const turns = new MongoTurnRepository(h.ctx)
      const t = await turns.insert(1007, 'assistant', 'narration')
      await turns.mergeMetadata(t.id, 'narrator', { usage: { inputTokens: 10 } })
      await turns.mergeMetadata(t.id, 'classifier', { label: 'action' })
      await turns.mergeMetadata(t.id, 'narrator', { usage: { inputTokens: 99 } })
      const doc = await h.ctx.models.Turn.findOne({ seq: t.id }).lean()
      expect(doc?.metadata).toMatchObject({
        narrator: { usage: { inputTokens: 99 } },
        classifier: { label: 'action' },
      })
    })
  })

  describe('incTtsChars ($inc additive)', () => {
    it('accumulates metadata.tts.chars across calls', async () => {
      await seedWorld(1008, 'tts-world')
      const turns = new MongoTurnRepository(h.ctx)
      const t = await turns.insert(1008, 'assistant', 'narration')
      await turns.incTtsChars(1008, t.id, 100)
      await turns.incTtsChars(1008, t.id, 50)
      const doc = await h.ctx.models.Turn.findOne({ seq: t.id }).lean()
      expect((doc?.metadata as { tts?: { chars?: number } })?.tts?.chars).toBe(150)
    })
  })

  describe('append-only turn invariant guard', () => {
    it('exposes no general update/setMetadata and never mutates content/role/seq', async () => {
      await seedWorld(1009, 'append-world')
      const turns = new MongoTurnRepository(h.ctx)
      const t = await turns.insert(1009, 'user', 'original content')

      // The port surface has no clobbering write.
      expect((turns as unknown as Record<string, unknown>).update).toBeUndefined()
      expect((turns as unknown as Record<string, unknown>).setMetadata).toBeUndefined()
      expect((turns as unknown as Record<string, unknown>).delete).toBeUndefined()

      // The only permitted mutations touch metadata, never the spine fields.
      await turns.mergeMetadata(t.id, 'narrator', { usage: { inputTokens: 1 } })
      await turns.incTtsChars(1009, t.id, 10)
      const doc = await h.ctx.models.Turn.findOne({ seq: t.id }).lean()
      expect(doc?.content).toBe('original content')
      expect(doc?.role).toBe('user')
      expect(doc?.seq).toBe(t.id)
    })
  })

  describe('UnitOfWork rollback', () => {
    it('rolls back every write in the transaction when the work throws', async () => {
      await seedWorld(1010, 'uow-world')
      const uow = new MongoUnitOfWork(h.ctx)
      const turns = new MongoTurnRepository(h.ctx)
      const before = await h.ctx.models.Turn.countDocuments({ worldId: 1010 })
      await expect(
        uow.run(async () => {
          await turns.insert(1010, 'user', 'will be rolled back')
          await turns.insert(1010, 'assistant', 'also rolled back')
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      const after = await h.ctx.models.Turn.countDocuments({ worldId: 1010 })
      expect(after).toBe(before)
    })

    it('commits both the counter increment and the turn insert atomically', async () => {
      await seedWorld(1011, 'uow-commit')
      const uow = new MongoUnitOfWork(h.ctx)
      const turns = new MongoTurnRepository(h.ctx)
      let seq = -1
      await uow.run(async () => {
        const t = await turns.insert(1011, 'user', 'committed')
        seq = t.id
      })
      const doc = await h.ctx.models.Turn.findOne({ seq }).lean()
      expect(doc?.content).toBe('committed')
    })
  })
})

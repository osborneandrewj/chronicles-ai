import { afterEach, describe, expect, it } from 'vitest'

import {
  __resetMongoConnectionForTests,
  assertReplicaSet,
  connectMongo,
  isBuildPhase,
} from '@/infrastructure/persistence/mongo/connection'

import { replSetAvailable, startReplSet } from './replset'

// Connection guards (spec §4.6 replica-set fail-fast, §4.9 build-phase no-op).
const available = await replSetAvailable()
const d = available ? describe : describe.skip

describe('mongo connection build-phase guard', () => {
  afterEach(() => {
    delete process.env.NEXT_PHASE
    __resetMongoConnectionForTests()
  })

  it('is a no-op during the Next build phase (does not dial a cluster)', async () => {
    process.env.NEXT_PHASE = 'phase-production-build'
    expect(isBuildPhase()).toBe(true)
    // Returns a disconnected connection without a live URL — no throw, no dial.
    const conn = await connectMongo('mongodb://unreachable.invalid:27017/x')
    expect(conn).toBeDefined()
  })
})

d('mongo replica-set guard', () => {
  afterEach(() => {
    __resetMongoConnectionForTests()
  })

  it('passes assertReplicaSet against a real replica set', async () => {
    const handle = await startReplSet()
    if (!handle) throw new Error('replica set unexpectedly unavailable')
    try {
      await expect(assertReplicaSet(handle.connection)).resolves.toBeUndefined()
    } finally {
      await handle.stop()
    }
  }, 120_000)
})

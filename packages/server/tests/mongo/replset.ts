import { MongoMemoryReplSet } from 'mongodb-memory-server'

import type { Connection } from 'mongoose'

import { MongoContext } from '@/infrastructure/persistence/mongo/mongo-context'
import { connectTestMongo } from '@/infrastructure/persistence/mongo/test-support'

// Shared MongoMemoryReplSet harness for the Mongo adapter suite (spec §5.2).
// A REPLICA SET — not a single MongoMemoryServer — because a single node
// silently no-ops `session.withTransaction`, which would hide the replica-set
// requirement the UnitOfWork depends on. If the environment cannot download or
// run the memory server, `tryStartReplSet` returns null and the suites skip
// (the mongo work is then complete-but-unverified — reported loudly, never
// claimed as gate-passed).

export type ReplSetHandle = {
  replSet: MongoMemoryReplSet
  connection: Connection
  ctx: MongoContext
  stop: () => Promise<void>
}

let probeResult: boolean | null = null

/** One-time probe: can we stand up a replica set at all in this environment? */
export async function replSetAvailable(): Promise<boolean> {
  if (probeResult !== null) return probeResult
  try {
    const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    await rs.stop()
    probeResult = true
  } catch {
    probeResult = false
  }
  return probeResult
}

/** Start a fresh single-node replica set + a connected MongoContext, or null. */
export async function startReplSet(): Promise<ReplSetHandle | null> {
  let replSet: MongoMemoryReplSet
  try {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  } catch {
    return null
  }
  const uri = replSet.getUri()
  const { connection, ctx, close } = await connectTestMongo(uri)
  return {
    replSet,
    connection,
    ctx,
    stop: async () => {
      await close()
      await replSet.stop()
    },
  }
}

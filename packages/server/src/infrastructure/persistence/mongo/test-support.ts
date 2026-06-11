import mongoose, { type Connection } from 'mongoose'

import { MongoContext } from './mongo-context'

// Test-only support living inside the mongo adapter dir so the `mongoose`
// import stays confined to `infrastructure/persistence/mongo/` (the P7 boundary
// rule). The test harness (tests/mongo/replset.ts) wires a MongoMemoryReplSet
// URI to a connected MongoContext through this factory and imports no mongoose
// itself. NOT 'server-only': it is imported by the Vitest harness, which has no
// RSC boundary.
export type TestMongoHandle = {
  connection: Connection
  ctx: MongoContext
  close: () => Promise<void>
}

export async function connectTestMongo(uri: string): Promise<TestMongoHandle> {
  const connection = mongoose.createConnection(uri, { dbName: 'chronicles_test' })
  await connection.asPromise()
  const ctx = new MongoContext(connection)
  await ctx.syncIndexes()
  return {
    connection,
    ctx,
    close: () => connection.close(),
  }
}

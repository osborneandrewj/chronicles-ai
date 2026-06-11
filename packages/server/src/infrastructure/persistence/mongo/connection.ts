import 'server-only'

import mongoose, { type Connection } from 'mongoose'

// Mongo connection bootstrap (spec §4.6, §4.9). The persistence layer lives in
// the server package behind repository ports; this is the single place a live
// cluster is dialed. Three concerns are handled here and nowhere else:
//
//   1. Fail-fast if the deployment is NOT a replica set — multi-document
//      transactions (UnitOfWork.run → session.withTransaction) and the atomic
//      turn-seq allocation require one. A single-node mongod silently no-ops
//      `startTransaction`, so we refuse to boot rather than corrupt invariants.
//   2. Build-phase no-op — mirrors the SQLite `:memory:` swap when
//      NEXT_PHASE === 'phase-production-build' so Next page-data collection
//      during `next build` never reaches a live cluster.
//   3. Single shared connection per process (cached on the module), mirroring
//      the SQLite singleton.

const BUILD_PHASE = 'phase-production-build'

let cachedConnection: Connection | undefined

/** True during `next build` static page-data collection. */
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === BUILD_PHASE
}

/**
 * Probe whether the connected deployment is a replica set (or mongos). Mongo
 * exposes this via the `hello` admin command: replica sets report a `setName`,
 * sharded clusters report `msg: 'isdbgrid'`. A standalone reports neither.
 */
export async function assertReplicaSet(connection: Connection): Promise<void> {
  const admin = connection.db?.admin()
  if (!admin) {
    throw new Error('Mongo connection has no admin database; cannot verify replica set')
  }
  const hello = (await admin.command({ hello: 1 })) as {
    setName?: string
    msg?: string
    isWritablePrimary?: boolean
    ismaster?: boolean
  }
  const isReplicaSet = typeof hello.setName === 'string' && hello.setName.length > 0
  const isMongos = hello.msg === 'isdbgrid'
  if (!isReplicaSet && !isMongos) {
    throw new Error(
      'Mongo deployment is not a replica set. Multi-document transactions ' +
        '(UnitOfWork) and atomic turn-seq allocation require a replica set or ' +
        'Atlas. Run mongod with --replSet (single-node replica set is fine) ' +
        'or point DATABASE_URL at Atlas. (spec §4.6)',
    )
  }
}

/**
 * Connect to Mongo and return the shared connection. Idempotent: a second call
 * returns the cached connection. During the Next build phase this is a no-op
 * that throws if anything actually tries to use the (absent) connection — the
 * build never reaches a repository, mirroring the SQLite `:memory:` guard.
 */
export async function connectMongo(databaseUrl: string): Promise<Connection> {
  if (cachedConnection) {
    return cachedConnection
  }

  if (isBuildPhase()) {
    // Do not dial a live cluster during `next build`. Return a disconnected
    // connection object; any repository call during build would fail loudly,
    // but the build path never reaches one (page-data collection only).
    cachedConnection = mongoose.createConnection()
    return cachedConnection
  }

  if (!databaseUrl) {
    throw new Error('connectMongo requires a DATABASE_URL connection string')
  }

  const connection = mongoose.createConnection(databaseUrl)
  await connection.asPromise()
  await assertReplicaSet(connection)
  cachedConnection = connection
  return cachedConnection
}

/** For tests: reset the module-cached connection. */
export function __resetMongoConnectionForTests(): void {
  cachedConnection = undefined
}

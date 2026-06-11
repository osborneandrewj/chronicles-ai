import 'server-only'

import type { UnitOfWork } from '@/domain/ports/unit-of-work'

import type { MongoContext } from './mongo-context'

// Mongo UnitOfWork (spec §4.6). Wraps `session.withTransaction`, exposing the
// same opaque-callback port as the SQLite adapter so the application owns the
// boundary and repositories stay dumb. The session is threaded to the
// repositories via `MongoContext.setSession` for the duration of the work, so
// every write inside `fn` — including the atomic turn-seq counter increment —
// joins the same transaction and commits or rolls back together.
//
// Single-document writes (a lone metadata merge, an append-only insert with a
// pre-allocated seq) must NOT open a session; they call the repository methods
// directly outside `run` and remain atomic at the document level.
//
// Multi-document transactions require a replica set or Atlas — enforced at boot
// by `assertReplicaSet` in connection.ts. A standalone mongod throws here.
export class MongoUnitOfWork implements UnitOfWork {
  constructor(private readonly ctx: MongoContext) {}

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    const session = await this.ctx.connection.startSession()
    try {
      let result!: T
      await session.withTransaction(async () => {
        this.ctx.setSession(session)
        try {
          result = (await fn()) as T
        } finally {
          this.ctx.setSession(null)
        }
      })
      return result
    } finally {
      this.ctx.setSession(null)
      await session.endSession()
    }
  }
}

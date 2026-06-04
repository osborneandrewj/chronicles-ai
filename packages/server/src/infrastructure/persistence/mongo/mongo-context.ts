import 'server-only'

import type { ClientSession, Connection } from 'mongoose'

import { buildModels, type MongoModels } from './models'

// MongoContext bundles the live connection + bound model registry + the shared
// monotone-id allocator. Repositories receive this context (the Mongo analog of
// the SQLite `db` singleton) and never import mongoose models directly through
// the global. A per-request/per-transaction `ClientSession` is threaded via the
// AsyncLocalStorage-free explicit-session pattern: the UnitOfWork sets
// `currentSession` for the duration of `withTransaction`, and the id allocator
// + writers pick it up so a single transaction is atomic (spec §4.5, §4.6).

export class MongoContext {
  readonly connection: Connection
  readonly models: MongoModels
  private session: ClientSession | null = null

  constructor(connection: Connection) {
    this.connection = connection
    this.models = buildModels(connection)
  }

  /** The session active for the current UnitOfWork, or null for single-doc writes. */
  get currentSession(): ClientSession | null {
    return this.session
  }

  /**
   * Build every collection's indexes (unique nameKey/titleKey/seq, partial
   * filters). Run once at boot after connect so a duplicate that a SQLite
   * `lower(name)` UNIQUE was silently preventing surfaces as E11000.
   */
  async syncIndexes(): Promise<void> {
    const models = this.models as unknown as Record<
      string,
      { createIndexes(): Promise<unknown> }
    >
    await Promise.all(Object.values(models).map((m) => m.createIndexes()))
  }

  setSession(session: ClientSession | null): void {
    this.session = session
  }

  /**
   * Allocate the next monotone integer from a named counter (spec §4.5).
   * `turnSeq` backs the load-bearing turn sequence; every other collection uses
   * its own counter so the integer `id` the ports expose stays autoincrement-
   * compatible with SQLite. Runs inside the current session if one is active,
   * so the counter increment and the dependent insert commit atomically.
   */
  async nextSeq(counter: string): Promise<number> {
    const doc = await this.models.Counter.findOneAndUpdate(
      { _id: counter },
      { $inc: { value: 1 } },
      {
        upsert: true,
        returnDocument: 'after',
        session: this.session ?? undefined,
      },
    ).lean()
    // `doc` is non-null after upsert+returnDocument:'after'.
    return (doc as { value: number }).value
  }
}

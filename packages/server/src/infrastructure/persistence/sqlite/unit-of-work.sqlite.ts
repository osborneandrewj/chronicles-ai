import 'server-only'

import { db } from '@/lib/db'
import type { UnitOfWork } from '@/domain/ports/unit-of-work'

// SQLite UnitOfWork adapter (spec §3.4). better-sqlite3 is fully synchronous, so
// every SQLite repository method runs its SQL immediately and returns an
// already-resolved Promise. An `async` use-case body therefore executes all of
// its writes eagerly even though it `await`s — but `db.transaction(fn)` would
// commit the moment `fn` returns its Promise (before the awaited continuations
// run), so it cannot wrap an async body. Instead we open the transaction
// manually with `BEGIN IMMEDIATE` (the memory-note rule: a bare BEGIN can
// partial-commit on constraint failure), await the work, then COMMIT or
// ROLLBACK. Every awaited write lands between BEGIN and COMMIT and so joins the
// same transaction. The Mongo sibling threads a session through `withTransaction`.
//
// If a transaction is already open (a nested `run`), we run the work inline so
// SQLite does not throw "cannot start a transaction within a transaction"; the
// outer `run` owns the commit boundary.
export class SqliteUnitOfWork implements UnitOfWork {
  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    if (db.inTransaction) {
      return (await fn()) as T
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = (await fn()) as T
      db.exec('COMMIT')
      return result
    } catch (err) {
      if (db.inTransaction) db.exec('ROLLBACK')
      throw err
    }
  }
}

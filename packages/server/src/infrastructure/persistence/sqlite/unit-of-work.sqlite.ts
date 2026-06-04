import 'server-only'

import { db } from '@/lib/db'
import type { UnitOfWork } from '@/domain/ports/unit-of-work'

// SQLite UnitOfWork adapter (spec §3.4). Wraps `db.transaction(fn)`. The
// callback is synchronous under SQLite; better-sqlite3 forbids async work
// inside `db.transaction`, so the callback must complete synchronously. The
// async port signature is for Mongo signature-compatibility (`withTransaction`)
// — here we run the work synchronously and resolve.
export class SqliteUnitOfWork implements UnitOfWork {
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = db.transaction(() => fn() as T)()
    return Promise.resolve(result)
  }
}

// UnitOfWork port (spec §3.4): `run(fn)` runs the supplied work inside a single
// transaction boundary. On SQLite this wraps `db.transaction(fn)`; on Mongo it
// becomes `session.withTransaction`. The callback shape is intentionally opaque
// (no session object threaded through P1) so the SQLite impl stays signature-
// compatible with the future Mongo impl while the repositories remain the unit
// of access. Async by mandate (spec §5.3) even on the synchronous SQLite engine.
export interface UnitOfWork {
  run<T>(fn: () => Promise<T> | T): Promise<T>
}

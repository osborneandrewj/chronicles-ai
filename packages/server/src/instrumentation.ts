// Next.js boot hook (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
// `register()` runs once when a server instance starts.
//
// On the default SQLite path this is a no-op: the composition root builds its
// container lazily and synchronously on first use. When PERSISTENCE=mongo the
// adapter set must be constructed HERE instead — connecting + the replica-set
// probe + index build are async, and the synchronous getContainer() that route
// handlers call cannot open the connection lazily (composition/container.ts).
export async function register(): Promise<void> {
  // Nesting the dynamic import inside this literal check is load-bearing, not
  // cosmetic. Next compiles instrumentation for BOTH the nodejs and edge
  // runtimes and replaces process.env.NEXT_RUNTIME per compilation. Inside this
  // block the edge build sees `'edge' === 'nodejs'` → dead code → it drops the
  // entire node-only import graph (better-sqlite3, mongoose → node:net/fs) that
  // the edge target cannot resolve. An early `return` guard would NOT do this:
  // the bundler still compiles a dynamic import that merely follows a return.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Never during `next build` page-data collection — connectMongo returns a
    // disconnected stub in that phase and syncIndexes() needs a live socket.
    if (process.env.NEXT_PHASE === 'phase-production-build') return
    if (process.env.PERSISTENCE !== 'mongo') return

    const { initContainer } = await import('@/composition/container')
    await initContainer()
  }
}

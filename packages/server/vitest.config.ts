import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

// `DATABASE_PATH=:memory:` is set on the env so the shared db.ts singleton —
// which initializes once per process and runs all migrations — uses an
// in-memory database. Tests against the singleton scope their state by
// creating fresh worlds per test. Tests that need their own pristine DB
// (e.g. migrations.test.ts, which starts from a synthetic v4 state) open
// their own better-sqlite3 instance and bypass the singleton entirely.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    // Infrastructure modules are guarded by `import 'server-only'`, whose
    // default export throws outside a React Server Component. Vitest has no RSC
    // boundary, so alias the package to its no-op `empty.js` (the same file
    // Next.js resolves under the `react-server` condition) to let those modules
    // be imported under test.
    alias: {
      'server-only': path.resolve(moduleDir, '../../node_modules/server-only/empty.js'),
    },
    env: {
      DATABASE_PATH: ':memory:',
    },
    include: ['tests/**/*.test.ts'],
    // The Mongo adapter suite (P2) runs against a MongoMemoryReplSet and is the
    // explicit job of `npm run test:mongo` (vitest.mongo.config.ts). It is
    // excluded from the default run so `npm test` stays the SQLite-default
    // regression gate (byte-identical count) and never pulls a Mongo binary.
    exclude: ['tests/mongo/**', '**/node_modules/**'],
  },
})

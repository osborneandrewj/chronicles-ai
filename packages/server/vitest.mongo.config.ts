import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

// Dedicated config for the P2 Mongo adapter suite (spec §5.2). These tests spin
// up a real MongoMemoryReplSet (a single MongoMemoryServer silently no-ops
// transactions), so they are isolated from the SQLite-default `npm test` gate.
// `npm run test:mongo` runs only `tests/mongo/**`.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    alias: {
      'server-only': path.resolve(moduleDir, '../../node_modules/server-only/empty.js'),
    },
    env: {
      DATABASE_PATH: ':memory:',
      PERSISTENCE: 'mongo',
    },
    include: ['tests/mongo/**/*.test.ts'],
    // The replica-set download + boot can be slow on a cold cache.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Each suite owns a replica set; run files sequentially to bound resource use.
    fileParallelism: false,
  },
})

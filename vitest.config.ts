import { defineConfig } from 'vitest/config'

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
    env: {
      DATABASE_PATH: ':memory:',
    },
    include: ['tests/**/*.test.ts'],
  },
})

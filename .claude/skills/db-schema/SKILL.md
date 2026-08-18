---
name: db-schema
description: Change the live schema — SQLite migrations, matching Mongo models/indexes, and repository ports. Use when adding or altering tables, columns, indexes, or persistence models.
user-invocable: false
paths:
  - "packages/server/src/lib/migrations.ts"
  - "packages/server/src/infrastructure/persistence/**"
  - "packages/server/tests/migrations.test.ts"
  - "packages/server/tests/mongo/**"
---

# Schema changes

Live schema is `packages/server/src/lib/migrations.ts` plus the matching Mongoose models in `packages/server/src/infrastructure/persistence/mongo/models`. Specs (`docs/specs/database-design.md`) are logical intent; they lose when they disagree with migrations.

There is no Drizzle, no `db:generate` / `db:migrate`, no down-migration. SQLite applies `migrations.ts` on boot (`PRAGMA user_version`). Do not revive Postgres or UUID primary keys.

## How to change it

1. Append the next numbered `{ version, name, up }` in `migrations.ts`. Never edit a shipped `up()` so that already-applied DBs diverge. New columns: `addColumnIfMissing`.
2. Update the matching Mongo schema/index in `infrastructure/persistence/mongo/models`. Integer `id` comes from the `counters` collection — never use `ObjectId` for ordering or `[t:N]` provenance.
3. Keep both adapters behind the same repository port. Repositories are dumb CRUD; deciding logic (name resolution, merges, sticky-scene) stays in `domain/services/`.
4. A schema change is not done until: the new migration applies on boot, the Mongo model/index is updated, and queries typecheck.

IDs are monotone integers (SQLite `AUTOINCREMENT` / Mongo `counters`), scoped by `world_id` / `worldId` where relevant. JSON lives as `TEXT` in SQLite and BSON subdocs in Mongo.

## Verify

- `npm -w @chronicles/server test -- tests/migrations.test.ts`
- `npm run test:mongo` when you touch a persistence port, adapter, or Mongo model

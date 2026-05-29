---
name: db-schema
description: Design and manage database schemas, migrations, and queries following project conventions. Use when creating or modifying database models.
user-invocable: false
paths:
  - "db/**"
  - "src/models/**"
  - "**/migrations/**"
  - "**/schema*"
---

> **MVP sprint override (active until exit criteria in `docs/plans/milestones/mvp-sprint.md` are met).**
> During the MVP sprint the conventions below are intentionally relaxed:
> - SQLite via raw `better-sqlite3` (no Postgres, no Drizzle, no migrations)
> - Single `turns(id, role, content, created_at)` table; `id` is INTEGER PRIMARY KEY AUTOINCREMENT
> - No UUIDs, no `updated_at`, no `deleted_at`, no `fk_*`/`idx_*` ceremony
> - Inline prepared statements in `src/lib/db.ts` — no model layer
> The full conventions below resume at Phase 1 proper (Postgres + Drizzle + pgvector).

## Database Conventions

### Schema Design
- Use UUIDs for primary keys (not auto-increment integers)
- Include `created_at` and `updated_at` timestamps on all tables
- Add `deleted_at` for soft-delete when data retention is required
- Use foreign keys with appropriate ON DELETE behavior
- Index columns used in WHERE clauses, JOINs, and ORDER BY

### Naming
- Tables: plural snake_case (`user_sessions`, `api_keys`)
- Columns: snake_case (`first_name`, `created_at`)
- Indexes: `idx_<table>_<columns>` (`idx_users_email`)
- Foreign keys: `fk_<table>_<referenced_table>` (`fk_posts_users`)

### Migrations
- One migration per logical change
- Migrations must be reversible (include down/rollback)
- Never modify a deployed migration — create a new one
- Test migrations against a copy of production data when possible
- Name format: `YYYYMMDDHHMMSS_description`

### Query Safety
- Always use parameterized queries
- Never concatenate user input into SQL strings
- Use transactions for multi-table operations
- Add appropriate indexes before deploying queries on large tables

### Performance
- Avoid SELECT * — specify columns explicitly
- Use EXPLAIN ANALYZE on complex queries
- Implement connection pooling
- Add pagination to all list endpoints
- Consider read replicas for heavy read workloads

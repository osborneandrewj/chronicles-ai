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

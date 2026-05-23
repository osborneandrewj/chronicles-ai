# Chronicles AI

AI-powered multiplayer interactive novel engine. Persistent world, multi-agent narrator system, living wiki + timeline.

> **MVP sprint in progress** (target 2026-05-25). Until the exit criteria in `docs/10-mvp-sprint.md` are met, the stack and rules in this file describe the **post-sprint target**, not what's being built right now. Sprint reality: SQLite + raw `better-sqlite3`, no Drizzle, no migrations, no Docker; one `turns` table with autoincrement `id`; one streaming `POST /api/chat` route; Claude **Sonnet 4.6** (`claude-sonnet-4-6`); no auth, no rate limiting, no test suite. Read `docs/10-mvp-sprint.md` for the explicit cuts and accepted tradeoffs before suggesting anything from the long-term stack below.

Architecture and design detail lives in `docs/` — read the relevant doc before non-trivial changes:
- `docs/01-system-architecture.md` — overall structure, project layout
- `docs/02-database-design.md` — full schema
- `docs/03-agent-system-design.md` — agent roster, prompts, context flow
- `docs/04-memory-architecture.md` — memory chunks, retrieval, embeddings
- `docs/07-implementation-roadmap.md` — phased plan, current phase

## Working in this repo

- **State assumptions before coding.** If the request has multiple reasonable readings, surface them rather than picking silently. If you don't know which agent/table/phase a change belongs in, ask.
- **Define "done" before starting.** A narrator change isn't done until you've streamed a turn end-to-end in the browser. A schema change isn't done until `db:generate` + `db:migrate` succeed and queries still typecheck. A new agent isn't done until its prompt template is in `prompts/` and a real call returns valid output.
- **Stay in your lane.** Each agent has its own prompt, context, and Zod schema. Don't merge them, don't share full prompts, don't let the narrator see what the archivist sees.
- **Respect the budget.** Context assembler enforces 8K input / 1K output per narrator call. System prompt, authoritative state, and player action are pinned; recent turns + retrieved memories drop first. Don't bypass it.

## Tech Stack

Next.js 15 (App Router) · TypeScript · Tailwind + shadcn/ui · Vercel AI SDK (`@ai-sdk/anthropic`) · Claude Sonnet 4 (narrator/seeder/actor) + Haiku (compiler/linter/archivist/conductor) · PostgreSQL 17 + pgvector · Drizzle ORM (postgres-js driver) · Zod · Voyage AI embeddings (Phase 2+) · NextAuth.js (Phase 5+)

## Commands

- `docker compose up -d` — start Postgres
- `npm run dev` — start Next.js dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run type-check` — TypeScript check (`tsc --noEmit`)
- `npm run db:generate` — generate migration from schema changes
- `npm run db:migrate` — apply pending migrations
- `npm run db:studio` — open Drizzle Studio
- `npm test` — run tests

## Code Style

- 2-space indentation, TypeScript throughout
- Named imports, alphabetized within groups (external → internal → relative)
- `const` / `let` only, never `var`
- Functions: small, single-responsibility, explicit return types on exports
- Functional React components only, hooks for state/effects
- Server Components by default, `"use client"` only when interactivity is required
- Server Actions for mutations, Route Handlers only for streaming endpoints

## Key Design Rules

- The LLM does not remember — the system decides what it remembers and injects into context
- Never dump full conversation history into a prompt
- Separate creative output (narrator) from factual extraction (archivist)
- Keep tactical scene state, content boundaries, and action resolution in structured authoritative state, not only in prose
- Player actions are persisted BEFORE streaming starts; narrator responses AFTER stream completes
- Turns are append-only — never modified after creation
- Token usage tracked in `turns.metadata` on every LLM call
- Treat LLM output as untrusted — sanitize before rendering
- Prompt templates live in `prompts/*.md` — git-diffable, loaded at runtime

## Environment

- `.env.local` for local dev (never commit); `.env.example` documents required variables
- Required: `DATABASE_URL`, `ANTHROPIC_API_KEY`
- Phase 2+: `VOYAGE_API_KEY`

## Common Gotchas

- Database must be running (`docker compose up -d`) before dev server or tests
- Drizzle schema changes require `npm run db:generate` then `npm run db:migrate`
- Hot-reload breaks on ORM model changes — restart dev server
- pgvector extension must exist before vector column migrations run
- The `postgres` package (postgres-js) is used, NOT `pg` — different API

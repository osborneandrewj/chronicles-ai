# Chronicles AI

AI-powered multiplayer interactive novel engine. Persistent world, multi-agent narrator system, living wiki + timeline.

## Tech Stack
- **Framework**: Next.js 15 App Router + TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **LLM**: Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) — Claude Sonnet 4 (narrator), Haiku (archivist/conductor)
- **Database**: PostgreSQL 17 + pgvector (Docker Compose for local dev)
- **ORM**: Drizzle ORM + `postgres` (postgres-js driver)
- **Validation**: Zod
- **Embeddings**: Voyage AI (Phase 2+)
- **Auth**: NextAuth.js (Phase 4+)

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

## Project Structure
```
src/
├── app/                     # Next.js App Router pages + API routes
├── components/
│   ├── ui/                  # shadcn/ui base components
│   ├── story/               # StoryFeed, StoryInput, TurnEntry, StreamingTurn
│   └── world/               # WorldCard, CreateWorldForm
├── lib/
│   ├── ai/                  # Agent system: narrator, archivist, conductor, actor
│   │   ├── context-assembler.ts  # Builds LLM context from DB (token-budgeted)
│   │   └── prompts.ts            # Loads prompt templates from prompts/
│   ├── db/
│   │   ├── schema/          # Drizzle table definitions
│   │   └── queries/         # Typed query functions
│   ├── actions/             # Server Actions (world CRUD, story)
│   └── utils/               # Error classes, helpers
└── types/                   # Shared TypeScript types
prompts/                     # LLM prompt templates (.md files, git-tracked)
docker/                      # Docker init scripts
docs/                        # Architecture and design docs
```

## Database
- 4 core tables (Phase 1): `worlds`, `characters`, `scenes`, `turns`
- Turns are append-only — never modified after creation
- UUIDs for all primary keys
- JSONB columns for flexible data (`setting_details`, `traits`, `metadata`)
- Token usage tracked in `turns.metadata` on every LLM call
- pgvector extension loaded via `docker/init.sql`

## AI Agent System
- **Narrator** (Sonnet): generates story prose, streamed via SSE
- **Archivist** (Haiku): extracts structured data via `generateObject()` with Zod schemas
- **Conductor** (Haiku): pacing/scene decisions — Phase 3
- **Actor** (Sonnet): NPC dialogue/actions — Phase 3
- Prompt templates live in `prompts/*.md` — git-diffable, loaded at runtime
- Context assembler enforces token budget (~8K tokens max per narrator call)
- Each agent sees only the context it needs — never share full prompts between agents

## Key Design Rules
- The LLM does not remember — the system decides what it remembers and injects into context
- Never dump full conversation history into a prompt
- Separate creative output (narrator) from factual extraction (archivist)
- Player actions are persisted BEFORE streaming starts; narrator responses AFTER stream completes
- Treat LLM output as untrusted — sanitize before rendering

## Environment
- `.env.local` for local dev (never commit)
- `.env.example` documents all required variables
- Required: `DATABASE_URL`, `ANTHROPIC_API_KEY`
- Phase 2+: `VOYAGE_API_KEY`

## Common Gotchas
- Database must be running (`docker compose up -d`) before dev server or tests
- Drizzle schema changes require `npm run db:generate` then `npm run db:migrate`
- Hot-reload breaks on ORM model changes — restart dev server
- pgvector extension must exist before vector column migrations run
- The `postgres` package (postgres-js) is used, NOT `pg` — different API

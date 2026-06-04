# Chronicles AI

AI-powered multiplayer interactive novel engine. Persistent world, multi-agent narrator system, living wiki + timeline.

> **MVP sprint in progress** (target 2026-05-25). Until the exit criteria in `docs/plans/milestones/mvp-sprint.md` are met, the stack and rules in this file describe the **post-sprint target**, not what's being built right now. Sprint reality: SQLite + raw `better-sqlite3`, no Drizzle, no migrations, no Docker; one `turns` table with autoincrement `id`; one streaming `POST /api/chat` route; Claude **Sonnet 4.6** (`claude-sonnet-4-6`); no auth, no rate limiting, no test suite. Read `docs/plans/milestones/mvp-sprint.md` for the explicit cuts and accepted tradeoffs before suggesting anything from the long-term stack below.

Architecture and design detail lives in `docs/` — read the relevant doc before non-trivial changes:
- `docs/specs/system-architecture.md` — overall structure, project layout
- `docs/specs/database-design.md` — full schema
- `docs/specs/agent-system-design.md` — agent roster, prompts, context flow
- `docs/specs/hexagonal-architecture-blueprint.md` — **binding architecture**: ports & adapters, layering rules, the turn pipeline as a use case, the incremental migration path. Read before any non-trivial code change.
- `docs/specs/system-design-rebuild-spec.md` — architecture-neutral spec of every behavior (full schema, agents + prompts, deterministic algorithms, API contracts)
- `docs/specs/memory-architecture.md` — memory chunks, retrieval, embeddings
- `docs/plans/roadmap.md` — phased plan, current phase

## Working autonomy

- **Default to the recommended option** when you offer me a choice. Only stop to ask when the options have materially different blast radius (e.g. destructive vs. reversible) or when the right answer genuinely depends on something only I know. Don't ask me to choose between "snapshot type A vs B" if A is clearly better — just do A and tell me what you did.
- **Proceed without confirmation for reversible local actions**: writing files in this repo, creating local backups under `backups/`, running read-only railway commands, sshing into the prod container via `railway ssh` for inspection or snapshots. Still confirm before: `git push`, `railway redeploy`/`down`/`delete`, dropping DB tables, `rm -rf`, anything that touches the production DB destructively, or anything that posts to GitHub/external systems.
- **When a command fails, diagnose before retrying with flags.** Don't keep poking. If two attempts fail for related reasons, stop and explain the hypothesis before the third try.

## Working in this repo

- **State assumptions before coding.** If the request has multiple reasonable readings, surface them rather than picking silently. If you don't know which agent/table/phase a change belongs in, ask.
- **Define "done" before starting.** A narrator change isn't done until you've streamed a turn end-to-end in the browser. A schema change isn't done until `db:generate` + `db:migrate` succeed and queries still typecheck. A new agent isn't done until its prompt template is in `prompts/` and a real call returns valid output.
- **Stay in your lane.** Each agent has its own prompt, context, and Zod schema. Don't merge them, don't share full prompts, don't let the narrator see what the archivist sees.
- **Respect the budget.** Context assembler enforces 8K input / 1K output per narrator call. System prompt, authoritative state, and player action are pinned; recent turns + retrieved memories drop first. Don't bypass it.

## Architecture & separation of concerns

This project is organized as a **hexagonal architecture (ports & adapters)**. The full design and rationale live in `docs/specs/hexagonal-architecture-blueprint.md` — read it before non-trivial work. The rules below are the short, binding form, and they override convenience.

**The one rule: dependencies point inward.** The domain depends on nothing; everything depends on the domain. This is the *target* layout — today most logic still lives in `src/lib/`; new and refactored code adopts the layered layout below and moves violating code toward it.

- `src/domain/` — **pure.** Entities, value objects, pure domain services (context assembly, reverie flaring, occupancy sim, NPC promotion, patch sanitization, classifier rules, world clock, dedup), and **ports** (interfaces). No `import` of `next`, `ai`, `@ai-sdk/*`, `better-sqlite3`, `fs`, `fetch`, or a wall-clock. Deterministic, no I/O.
- `src/application/` — **use cases** (`AdvanceTurn`, `CreateWorld`, `ApplyCorrection`, `LoadHistory`, …). Orchestration and transaction boundaries only. May import `domain/`; never SQL, an SDK, or a framework.
- `src/infrastructure/` — **driven adapters** implementing ports: repositories (SQLite today; Postgres a sibling), LLM providers, embeddings, geocoder, TTS, clock, logger. **All model IDs and pricing live here.**
- `src/app/` + `src/components/` — **driving adapters.** A route handler / Server Action parses input, calls a use case, pipes the result, and owns no logic. React renders and reads via a query port; it never writes SQL.
- `src/composition/` — the **only** place adapters meet use cases (the dependency-injection wiring root).

**Separation-of-concerns rules — one concern per module:**

- **Repositories are dumb CRUD.** Any rule that *decides* something (name resolution, alias merge, `reveals_name_of` rename, sticky-scene / scene-open-on-move, freshest-field-wins) is a pure domain service the use case runs before handing flat rows to a repository. A `merge`/resolution branch inside `infrastructure/` is a leaked concern.
- **Structure ≠ rendering.** The domain emits structured values (`ContextBundle`, `ArchivistPatch`); turning them into a prompt string or an HTTP payload is an adapter's job. The domain never knows the narrator's markdown dialect or an HTTP status code.
- **One agent per port; don't fuse a vertical slice in one file.** Prompt-building + inference + parsing + sanitization + persistence are five concerns with five homes (the old `archivist.ts` is the anti-pattern).
- **Untrusted input crosses a boundary once.** Player text and LLM output are validated/sanitized at the adapter→domain edge, then trusted inward.
- **Errors are domain types** (`WorldNotFound`, `BudgetExceeded`, `ContextOverflowError`), mapped to HTTP/UI **only** in the inbound adapter.

**The leak test:** if adding one feature forces you to edit two layers at once, a concern has leaked — re-cut the boundary before writing the feature.

**Mid-migration discipline.** Some shipped code still violates this — the 594-line `src/app/api/chat/route.ts` god endpoint, and `src/lib/db.ts` imported directly everywhere. **Do not add to them.** New logic goes in a domain service or a use case; new persistence goes behind a repository port; new modules must not `import` `db.ts` or an SDK directly. When you touch a violating file, move it one step toward the layering (blueprint §10). Cross-layer imports are forbidden and should fail CI (`dependency-cruiser` / `import/no-restricted-paths`) — don't introduce them.

## Tech Stack

Next.js 15 (App Router) · TypeScript · Tailwind + shadcn/ui · Vercel AI SDK (`@ai-sdk/anthropic`) · Grok 4.3 (narrator/seeder/actor) + Haiku (compiler/linter/archivist/conductor) · PostgreSQL 17 + pgvector · Drizzle ORM (postgres-js driver) · Zod · Voyage AI embeddings (Phase 2+) · NextAuth.js (Phase 5+)

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
- Respect layer boundaries (see Architecture): `domain/` imports nothing outward, `application/` imports only `domain/`, adapters import inward only, wiring lives in `composition/`. No cross-layer imports.
- Keep SQL, SDK calls, model IDs, and pricing in `infrastructure/` only — never as literals in domain or application code

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
- Dependencies point inward — the domain (entities, pure services, ports) depends on nothing; adapters depend on the domain; they meet only in the composition root
- Keep deciding logic out of adapters — repositories are dumb CRUD; merges, name resolution, and invariants are pure domain services run by the use case
- Separate structure from rendering — the domain emits structured values; turning them into prompt text or HTTP payloads is an adapter's job

## Environment

- `.env.local` for local dev (never commit); `.env.example` documents required variables
- Required: `DATABASE_URL`, `ANTHROPIC_API_KEY`
- Phase 2+: `VOYAGE_API_KEY`

## Release version bump

The header at `src/app/page.tsx:17` reads `pkg.version` from `package.json` — that one number is the user's only at-a-glance trust signal for "what's running". Treat it as load-bearing.

Whenever you bump the project version:

1. **Bump on the release branch, not post-merge.** Same branch as the release PR, ideally as the first or last commit. Never on `main` after the merge — that creates a window where prod runs new code under the old version string.
2. **Bump both files.** `package.json` *and* `package-lock.json` (both the top-level `"version"` and the one under `"packages": { "": { ... } }`). Single commit. Don't rely on `npm install` to fix the lockfile after the fact.
3. **Restart the dev server.** Next.js does not HMR module-level JSON imports — the cached `pkg` object persists until the process restarts. After bumping, kill `npm run dev` and start it again, then visually confirm the header on `/` shows the new version. Same goes for Railway: a redeploy is required.
4. **Update the milestone exit criteria.** Each milestone doc lists "`package.json` reads `vX.Y.Z` on the release branch" as an exit criterion — keep that pattern (see `docs/plans/_template-milestone.md`).

If you ever see the header showing a different version than `package.json` on disk, the dev server is stale — restart it.

## Common Gotchas

- Database must be running (`docker compose up -d`) before dev server or tests
- Drizzle schema changes require `npm run db:generate` then `npm run db:migrate`
- Hot-reload breaks on ORM model changes — restart dev server
- Hot-reload also breaks on `package.json` changes (e.g. version bumps) — restart dev server
- pgvector extension must exist before vector column migrations run
- The `postgres` package (postgres-js) is used, NOT `pg` — different API

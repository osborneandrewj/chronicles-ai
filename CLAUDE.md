# Chronicles AI

AI-powered multiplayer interactive novel engine. Persistent world, multi-agent narrator system, living wiki + timeline.

Architecture and design detail lives in `docs/` — read the relevant doc before non-trivial changes:
- `docs/specs/system-architecture.md` — overall structure, project layout
- `docs/specs/database-design.md` — full schema
- `docs/specs/agent-system-design.md` — agent roster, prompts, context flow
- `docs/specs/hexagonal-architecture-blueprint.md` — **binding architecture**: ports & adapters, layering rules, the turn pipeline as a use case, the incremental migration path. Read before any non-trivial code change.
- `docs/specs/system-design-rebuild-spec.md` — architecture-neutral spec of every behavior (full schema, agents + prompts, deterministic algorithms, API contracts)
- `docs/specs/memory-architecture.md` — memory chunks, retrieval, embeddings
- `docs/plans/roadmap.md` — phased plan, current phase
- `docs/plans/` — active feature/design plans; version-numbered milestone docs in `docs/plans/milestones/`; completed plans in `docs/plans/archive/`

## Working autonomy

- **Default to the recommended option** when you offer me a choice. Only stop to ask when the options have materially different blast radius (e.g. destructive vs. reversible) or when the right answer genuinely depends on something only I know. Don't ask me to choose between "snapshot type A vs B" if A is clearly better — just do A and tell me what you did.
- **Proceed without confirmation for reversible local actions**: writing files in this repo, creating local backups under `backups/`, running read-only railway commands, sshing into the prod container via `railway ssh` for inspection or snapshots. Still confirm before: `git push`, `railway redeploy`/`down`/`delete`, dropping DB tables, `rm -rf`, anything that touches the production DB destructively, or anything that posts to GitHub/external systems.
- **When a command fails, diagnose before retrying with flags.** Don't keep poking. If two attempts fail for related reasons, stop and explain the hypothesis before the third try.

## Working in this repo

- **State assumptions before coding.** If the request has multiple reasonable readings, surface them rather than picking silently. If you don't know which agent/table/phase a change belongs in, ask.
- **Define "done" before starting.** A narrator change isn't done until you've streamed a turn end-to-end in the browser. A schema change isn't done until the migration in `packages/server/src/lib/migrations.ts` applies cleanly on boot, the matching Mongo model/index under `infrastructure/persistence/mongo/models` is updated, and queries still typecheck. A new agent isn't done until its prompt template is in `prompts/` and a real call returns valid output.
- **Stay in your lane.** Each agent has its own prompt, context, and Zod schema. Don't merge them, don't share full prompts, don't let the narrator see what the archivist sees.
- **Simplicity first.** Minimum code that solves the problem. Nothing speculative. If you write 200 lines and it could be 50, rewrite it.
- **Respect the budget.** Context assembler enforces 8K input / 1K output per narrator call. System prompt, authoritative state, and player action are pinned; recent turns + retrieved memories drop first. Don't bypass it.
- **Archive plans when they ship.** Once a plan doc in `docs/plans/` is implemented and landed, `git mv` it into `docs/plans/archive/` (never delete — the rationale outlives the code). Roadmaps and the milestone template stay put; version-numbered milestone docs go in `docs/plans/milestones/`. See `docs/plans/archive/README.md`.

## Architecture & separation of concerns

This project is organized as a **hexagonal architecture (ports & adapters)**. The full design and rationale live in `docs/specs/hexagonal-architecture-blueprint.md` — read it before non-trivial work. The rules below are the short, binding form, and they override convenience.

**The one rule: dependencies point inward.** The domain depends on nothing; everything depends on the domain. This layout is now **realized** under `packages/server/src/` (the `onion-arch-refactor` branch). A few legacy SQL-owning modules still live in `packages/server/src/lib/` and are being strangled behind ports — new and refactored code adopts the layered layout below; never add to `lib/`. (All paths below are relative to `packages/server/src/`.)

- `domain/` — **pure.** Entities (`domain/entities/`), pure domain services (`domain/services/`: name resolution, reverie flaring, occupancy sim, NPC promotion, patch sanitization, classifier rules, scene-transition, story-signal, world clock, dedup, turn numbering, memorable-fact provenance), and **ports** (`domain/ports/`, 20 interfaces). No `import` of `next`, `ai`, `@ai-sdk/*`, `better-sqlite3`, `mongoose`, `fs`, `fetch`, or a wall-clock. Deterministic, no I/O.
- `application/use-cases/` — **use cases** (`AdvanceTurn`, `ApplyCorrection`, `InspectWorld`, `ListCorrections`, `LoadHistory`, `RecordTtsUsage`, `SummarizeUsage`, `SynthesizeNarration`). Orchestration and transaction boundaries only. May import `domain/`; never SQL, an SDK, or a framework.
- `infrastructure/` — **driven adapters** implementing ports: repositories (SQLite live default in `persistence/sqlite/`; a Mongo/Mongoose set is a sibling in `persistence/mongo/` behind `PERSISTENCE=mongo`), the narrator (`narrator/`), TTS (`tts/`), clock, logger, background tasks. **All model IDs and pricing live in `infrastructure/llm/`.**
- `app/` + `components/` + `server/render/` — **driving adapters.** A route handler / Server Action parses input, calls a use case, pipes the result, and owns no logic. React renders and reads via a query port; it never writes SQL.
- `composition/container.ts` — the **only** place adapters meet use cases (the dependency-injection wiring root; selects the live store by `PERSISTENCE`).

**Separation-of-concerns rules — one concern per module:**

- **Repositories are dumb CRUD.** Any rule that *decides* something (name resolution, alias merge, `reveals_name_of` rename, sticky-scene / scene-open-on-move, freshest-field-wins) is a pure domain service the use case runs before handing flat rows to a repository. A `merge`/resolution branch inside `infrastructure/` is a leaked concern.
- **Structure ≠ rendering.** The domain emits structured values (`ContextBundle`, `ArchivistPatch`); turning them into a prompt string or an HTTP payload is an adapter's job. The domain never knows the narrator's markdown dialect or an HTTP status code.
- **One agent per port; don't fuse a vertical slice in one file.** Prompt-building + inference + parsing + sanitization + persistence are five concerns with five homes (the old `archivist.ts` is the anti-pattern).
- **Untrusted input crosses a boundary once.** Player text and LLM output are validated/sanitized at the adapter→domain edge, then trusted inward.
- **Errors are domain types** (`WorldNotFound`, `BudgetExceeded`, `ContextOverflowError`), mapped to HTTP/UI **only** in the inbound adapter.

**The leak test:** if adding one feature forces you to edit two layers at once, a concern has leaked — re-cut the boundary before writing the feature.

**Mid-migration discipline.** The big offenders are gone — the 593-line chat god endpoint is now the `AdvanceTurn` use case (`POST /api/chat` is a thin adapter), and model IDs/pricing are consolidated in `infrastructure/llm/`. What remains: a handful of SQL-owning modules in `packages/server/src/lib/` (e.g. `db.ts`, `world-state.ts`, `npc-agent.ts`) still being strangled behind ports, plus two **manual gates** — the Mongo production cutover (P3) and the eventual SQLite deletion (P7). **Do not add to `lib/`.** New logic goes in a domain service or a use case; new persistence goes behind a repository port; new modules must not `import` `db.ts` or an SDK directly. When you touch a violating file, move it one step toward the layering (blueprint §10). Cross-layer imports are forbidden and fail CI (`dependency-cruiser` — 11 boundary rules + `server-only` + grep guards, run as `npm run depcruise` / pretest) — don't introduce them.

## Tech Stack

npm-workspace monorepo — `@chronicles/server` (the Next.js app) + `@chronicles/contracts` (shared Zod schemas + the pure sentence-splitter) · Next.js 15 (App Router) · TypeScript · Tailwind · Vercel AI SDK (`@ai-sdk/anthropic` + `@ai-sdk/xai`) · Grok 4.3 (`grok-4.3` — narrator/seeder) + Haiku (`claude-haiku-4-5-20251001` — archivist/classifier/intent-reconciler/npc-agent/region-extractor/world-generator) · **SQLite via raw `better-sqlite3`** (live default, migrates on boot) + **MongoDB/Mongoose** behind `PERSISTENCE=mongo` (implemented, not yet cut over) · Zod · xAI TTS · `dependency-cruiser` onion-boundary CI · Voyage AI embeddings (Phase 2+, unbuilt)

> Postgres 17 + pgvector + Drizzle ORM was the earlier target and is **superseded** — the chosen persistence path is SQLite (live) → MongoDB (behind a flag).

## Commands

All root scripts proxy to `@chronicles/server` via npm workspaces.

- `npm run dev` — start Next.js dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run type-check` — TypeScript check (`tsc --noEmit`)
- `npm test` — Vitest (SQLite default; `pretest` runs `npm run depcruise`)
- `npm run test:mongo` — Vitest Mongo suite against a `MongoMemoryReplSet`
- `npm run depcruise` — enforce onion boundaries (dependency-cruiser)
- `docker compose up -d` — start the MongoDB replica set (only needed for `PERSISTENCE=mongo` experimentation; the default SQLite path needs no DB process)

> SQLite has no separate migrate step — `packages/server/src/lib/migrations.ts` runs on boot. There is no Drizzle / `db:generate` / `db:migrate` / `db:studio`.

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
- Required: `ANTHROPIC_API_KEY` (Haiku extractors), `XAI_API_KEY` (Grok narrator + TTS)
- `PERSISTENCE=sqlite|mongo` (default `sqlite`). SQLite path: optional `DATABASE_PATH` overrides the local DB file. Mongo path: `DATABASE_URL` is the replica-set connection string (and requires `await initContainer()` at boot)
- Optional tuning: `DAILY_TOKEN_LIMIT`, `TTS_VOICE`, `TTS_SPEED`, `MAP_ROUTE_PROVIDER`, `MAP_TOOL_USER_AGENT`
- Phase 2+: `VOYAGE_API_KEY` (embeddings, unbuilt)

## Release version bump & deploy

The header at `packages/server/src/app/page.tsx:23` reads `pkg.version` from `packages/server/package.json` — that one number is the user's only at-a-glance trust signal for "what's running". Treat it as load-bearing. (In the monorepo the root, `@chronicles/server`, and `@chronicles/contracts` versions move together — currently `0.2.4`.) Full playbook in `docs/RELEASING.md`; the binding rules:

**Versioning (0.x scheme, restarted at v0.1.0 on 2026-06-05).**

- **New feature → bump MINOR** (0.1.0 → 0.2.0 → … → 0.9.0 → **0.10.0** → 0.11.0). Minor keeps incrementing as a plain integer; it does NOT roll into 1.0.
- **Bug fix → bump PATCH** (0.1.0 → 0.1.1 → 0.1.2).
- **v1.0.0 is reserved** for a deliberate "first stable / public release" decision Andrew makes explicitly — never reached by auto-increment.

**Branch / deploy model.**

- `main` = integration / default branch. All `feat/*` and `fix/*` branches PR into `main`. **`main` is NOT auto-deployed.**
- `production` = the dedicated deploy branch Railway watches. It holds only released code; Railway deploys on push to `production`.
- **Release flow:** cut a `feat/<slug>` or `fix/<slug>` branch → **bump the version on that branch, before merge** (never post-merge) → merge to `main` → when ready to ship, **promote** by merging/fast-forwarding `main → production` and pushing `production`. Railway builds + deploys `production`.
- **Hotfix:** branch from `production`, fix, bump PATCH, merge to BOTH `main` and `production`.
- (Andrew repoints Railway's watched branch from `main` to `production` himself — one-time manual step; don't run railway commands for it.)

**Every bump:**

1. **Bump on the feature/release branch, not post-merge.** Ideally the first or last commit. Never on `main` after the merge — that creates a window where prod runs new code under the old version string.
2. **Bump the workspace versions together.** `packages/server/package.json` (the version-of-record the header reads) plus the root and `@chronicles/contracts` `package.json`, *and* `package-lock.json` (the top-level `"version"` and the matching `"packages": { ... }` entries). Single commit. Don't rely on `npm install` to fix the lockfile after the fact.
3. **Restart the dev server.** Next.js does not HMR module-level JSON imports — the cached `pkg` object persists until the process restarts. After bumping, kill `npm run dev` and start it again, then visually confirm the header on `/` shows the new version. After a `production` deploy, the Railway redeploy is required; confirm the header there too.
4. **Update the milestone exit criteria.** Each milestone doc lists a version-bump-on-release-branch exit criterion (now paired with "promoted to `production` to deploy") — keep that pattern (see `docs/plans/_template-milestone.md`).

If you ever see the header showing a different version than `package.json` on disk, the dev server is stale — restart it.

## Common Gotchas

- The default SQLite path needs no DB process — `migrations.ts` runs on boot. Only `PERSISTENCE=mongo` needs `docker compose up -d` (the Mongo replica set) first
- `PERSISTENCE=mongo` requires `await initContainer()` at boot (the Mongo connection is async); the default SQLite path builds the container lazily and never loads `mongoose`
- Tests default to SQLite (`npm test`); the Mongo adapter suite is separate (`npm run test:mongo`) and spins up `mongodb-memory-server`
- `better-sqlite3` is a native module pinned in `serverExternalPackages` — never import it outside `infrastructure/persistence/sqlite/` (dependency-cruiser enforces this); same for `mongoose` outside `persistence/mongo/`
- Hot-reload breaks on `package.json` changes (e.g. version bumps) — restart the dev server
- `dependency-cruiser` boundary failures surface in `npm test` (via `pretest`) — fix the import direction, don't suppress the rule

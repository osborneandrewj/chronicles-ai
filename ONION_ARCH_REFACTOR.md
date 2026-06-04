# Onion Architecture Refactor Blueprint — Chronicles AI

*A binding proposal to move Chronicles AI to MongoDB, a DDD onion architecture, and a client/server monorepo.*

**Status:** proposal · **Date:** 2026-06-04 · **Scope:** persistence swap (SQLite → MongoDB/Mongoose), layer re-cut (domain / app / infra / server), and a monorepo split (Next.js client with no business logic + a server package holding all four rings). Phased so every step is independently shippable and reversible.

## Table of Contents

- [Executive Summary](#executive-summary)
- [1. Current State Analysis](#1-current-state-analysis)
- [2. Monorepo Structure & Client/Server Split](#2-monorepo-structure--clientserver-split)
- [3. Onion Architecture (domain / app / infra / server)](#3-onion-architecture-domain--app--infra--server)
- [4. Persistence: MongoDB + Mongoose](#4-persistence-mongodb--mongoose)
- [5. Migration Plan, Testing & Risks](#5-migration-plan-testing--risks)
- [Open Questions & Decisions for the Author](#open-questions--decisions-for-the-author)

## Executive Summary

This refactor pursues three goals, in service of a codebase that is testable, has clean separation of concerns, and can scale past a single SQLite file:

1. **MongoDB + Mongoose** replacing SQLite / `better-sqlite3`.
2. **A DDD onion architecture** — four rings (domain / app / infra / server) with strict inward-pointing dependencies and machine-enforced boundaries.
3. **A monorepo** — a Next.js *client* package carrying no business logic, and a *server* package holding the full onion (domain / app / infra / server).

**The current pain, grounded in the real god files.** *Persistence* is a single SQLite file opened once via `better-sqlite3` (`src/lib/db.ts`, 823 LOC), cached on `globalThis`, with the entire schema living only inside a hand-rolled 25-step migration runner (`src/lib/migrations.ts`, 858 LOC); `db.ts` is imported directly by 22 modules in two incompatible patterns, so there is no single chokepoint to wrap and no repository port anywhere. *Separation of concerns* has collapsed: `src/lib/archivist.ts` (2223 LOC, the named anti-pattern) fuses eight Zod schemas, two LLM calls, ~50 prepared statements, and all name/place resolution + merge logic inside one 370-line write transaction — adding a feature there forces edits across what should be five layers. *Client/server* is undivided: there is no `import "server-only"` guard anywhere in `src/` (zero matches), domain logic like `deriveCharacterBadges` and `[t:N]` provenance parsing runs in the browser via `WorldInspector.tsx` (1333 LOC), pricing tables leak into the client bundle, and the turn pipeline is a 593-line god endpoint (`src/app/api/chat/route.ts`) mixing HTTP, six LLM/IO calls, policy, rendering, persistence, and a `SIGTERM` drain.

**The recommended target.** A two-app, one-shared-package npm-workspaces monorepo: `apps/web` (Next.js, rendering only), `packages/server` (the onion: `domain/` pure decisions + ports, `application/` use cases, `infrastructure/` Mongo/LLM/TTS/geo adapters with all model IDs and pricing, `composition/` wiring), and `packages/contracts` (framework-free DTOs + Zod, the only thing both sides import). Next.js route handlers stay as thin inbound adapters that call use cases in-process, so streaming `POST /api/chat` keeps working with no extra proxy hop. MongoDB sits behind repository ports; the append-only turn spine, the load-bearing monotone `[t:N]` sequence, the `lower(name)` uniqueness, and the CHECK-constraint enums are all preserved through deliberate design (a `counters` collection, normalized `nameKey` fields, Mongoose enums). Boundaries are enforced by `dependency-cruiser` + `server-only` guards that do not exist today.

**A note on the existing blueprint.** `docs/specs/hexagonal-architecture-blueprint.md` is a **paper design that has never been implemented anywhere** — there is no `domain/`, `application/`, `infrastructure/`, or `composition/` code on disk, no port, no repository, no use case. The shipped codebase is still entirely the "god endpoint + raw `better-sqlite3` everywhere" shape. This document therefore treats the blueprint as a *reference vocabulary* (port names, use-case names, the leak test, the turn-pipeline ordering) to reuse — **not** as scaffolding to extend — and explicitly **supersedes** its two stale assumptions: its Postgres + Drizzle + pgvector persistence (§7) becomes **MongoDB + Mongoose** here, and its single-Next.js-app layout (§9) becomes a **client/server monorepo**. Phase 0 below starts from the god files, not from half-built layers.

**The phased migration, in one line.** Eight phases (P0–P7) on the blueprint's §10 discipline — *pure refactors first, capability changes last, never two in one PR*: monorepo skeleton → repository ports over SQLite (strangler-fig) → Mongo adapter behind a flag → backfill + dual-read verify + cutover → carve domain services out of the god files → thin the chat route into an `AdvanceTurn` use case → extract the client → enforce boundaries in CI and delete SQLite — with the Mongo track and the god-file-carve track able to run in parallel after the ports land.

## 1. Current State Analysis

Chronicles AI today is a **single Next.js 15 App Router package** at the repo root — one `package.json` (v0.6.21, npm, no workspaces), one `tsconfig.json` with a single `@/* → ./src/*` alias, one Vitest config. There is no `domain/`, `application/`, `infrastructure/`, or `composition/` directory on disk; the hexagonal layout described in `CLAUDE.md` and `docs/specs/hexagonal-architecture-blueprint.md` is the *target*, not the reality. Essentially all logic lives in **39 flat modules under `src/lib/`** plus **8 route handlers under `src/app/api/`**, with React in `src/components/`. Persistence is a single SQLite file opened once via `better-sqlite3` (`src/lib/db.ts`), cached on `globalThis.__chroniclesDb`, with a hand-rolled 25-migration runner (`src/lib/migrations.ts`) keyed on `PRAGMA user_version`.

### 1.1 The layout today

```
src/
├── lib/                    # 39 modules — domain rules, SQL, LLM calls, model IDs ALL fused here
│   ├── db.ts               (823) better-sqlite3 singleton + ~40 prepared stmts + row types
│   ├── migrations.ts       (858) the entire schema (25 migrations, no .sql files, no Drizzle)
│   ├── archivist.ts        (2223) the named anti-pattern (see §1.4)
│   ├── world-state.ts      (714) read-side aggregation + prompt rendering + db import
│   ├── npc-agent.ts        (695) NPC tick: schema + LLM + ~18 field-writer UPDATEs
│   ├── place-population.ts  (509) occupancy sim (mostly pure) + DB read/write fused
│   └── ... (reveries, npc-promotion, classifier, intent-reconciler, pricing, tts, map-tools, …)
├── app/
│   ├── api/chat/route.ts   (593) the god endpoint = the entire turn pipeline
│   ├── api/{turns,world-state,usage,world-correction(s),tts,tts/record}/route.ts
│   └── worlds/.../{play/page.tsx, new/actions.ts, actions.ts}  # Server Components/Actions read SQL directly
└── components/
    ├── Chat.tsx            (998) streaming UI + cost math + transport glue
    ├── WorldInspector.tsx  (1333) state drawer + domain fns running in the browser
    └── useNarratorAudio.ts (945) TTS playback + chunk-boundary decision (cache-critical)
```

There is **no `import "server-only"` guard anywhere in `src/`** (confirmed: 0 matches). The client is protected from bundling `better-sqlite3` only by the accident that DB-backed modules are reached via `import type`. **`src/lib/db.ts` is imported directly by 22 modules** (confirmed), in two patterns — raw-handle `import { db }` (each importer defining its own `db.prepare(...)` statements) and named-function imports — so there is no single chokepoint to wrap.

### 1.2 The SQLite schema (the real source of truth)

The schema is defined *only* in `migrations.ts` — `docs/specs/database-design.md` describes a different, aspirational Postgres/UUID/JSONB target with tables (`wiki_pages`, `memory_chunks`, `relationships`, `users`, …) that **do not exist** in the shipped build. The Mongo target must be designed from the migrations, not the doc. 14 tables:

| Table | Notes load-bearing for the migration |
| --- | --- |
| `turns` | **Append-only spine.** One *global* `AUTOINCREMENT id` shared across all worlds. The sole mutation is `metadata` (JSON-text) via `json_patch`/`json_set`. Player turn inserted PRE-stream, narrator turn POST-stream. |
| `worlds` | `initial_state_json`, `world_time` (clock; named to dodge `CURRENT_TIME`), `archived_at`, `current_scene_id`. |
| `characters` | Heavily ALTERed (migrations 5–24). `memorable_facts`/`observations` are append-only newline lists carrying `[t:N]` provenance referencing `turns.id`. `agency_level`, `daily_loop` (JSON), `aliases`, UNIQUE on `(world_id, lower(name))`. |
| `places` | `osm_*` geo cols, `geo_status`, UNIQUE `(world_id, lower(name))`. |
| `scenes` | UNIQUE `(world_id, scene_number)` (blocks parallel scenes), CHECK enums for `scene_mood`/`pace`/`focus`/`status`. |
| `story_threads`/`story_clues`/`story_objectives`/`story_resources`/`timeline_events` | Dossier. CHECK enums, UNIQUE `(world_id, lower(title|name))`, `importance BETWEEN 1 AND 5`. |
| `npc_intents` | Durable plan ledger; partial index `WHERE narrator_turn_id IS NULL`. |
| `npc_reveries` | Append-only log, **app-enforced cap 3/NPC**; supersedes dormant `characters.reveries` col. |
| `place_profiles`/`population_templates`/`place_occupancy_snapshots` | Living-place sim; occupancy is **append-only, app-pruned by turn count**. |
| `tts_audio_cache` | Only BLOB column; upsert + turn-count retention prune in one transaction. |
| `world_corrections` | Audit row holding serialized `ArchivistPatch`. |

Cross-cutting facts that constrain the rewrite: **CHECK enums** (role, statuses, `agency_level`, `traffic_level`, 0..1 ranges) are enforced by SQLite, not the app — Mongo will need Mongoose enums/`min`/`max` or domain validation. **UNIQUE-on-`lower(name)`** has no Mongo functional-index analog — needs a normalized lowercase key field. **`turns.id` is monotone and load-bearing** for ordering, before-id pagination, per-world display numbering, *and* the `[t:N]` strings already persisted in free text — a switch to bare `ObjectId` retroactively breaks provenance, so a numeric monotone seq must be preserved.

### 1.3 Where concerns are fused (the core problem)

Every LLM-calling module fuses **schema + inference + persistence + decision logic** in one file, and the prescribed layer homes don't exist:

- **Model IDs scattered across 9 files, not in infrastructure.** `NARRATOR_MODEL = 'grok-4.3'` is duplicated in `chat/route.ts:51` *and* `opening-turn.ts:10`; `'claude-haiku-4-5-20251001'` is independently re-declared in `archivist.ts`, `classifier.ts`, `intent-reconciler.ts`, `npc-agent.ts`, `region-extractor.ts`, `world-generator.ts`. Pricing for all models + TTS lives in `src/lib/pricing.ts` and **leaks into the client bundle** via `turn-cost.ts → Chat.tsx`. `CLAUDE.md` mandates model IDs and pricing live in `infrastructure/` only — currently violated everywhere.
- **SQL `db.prepare(...)` is interleaved with deciding logic.** `archivist.ts` reads all rows for a world, runs name/place resolution and merges, then issues UPDATEs *inside one transaction*. `npc-promotion.ts` interleaves tier decisions with `characters` UPDATEs. `reveries.ts` mixes pure flare-scoring with CRUD.
- **Wall-clock is in the SQL.** Nearly every write uses SQLite `datetime('now')` rather than a JS clock, across ~6 files. A `Clock` port cannot intercept these without rewriting every prepared statement.
- **Two LLM providers + TTS + geocoder are wired directly in feature modules**, not behind ports: `@ai-sdk/xai` (narrator/opening), `@ai-sdk/anthropic` (6 Haiku agents), a hand-rolled `fetch` TTS adapter (`tts.ts`), and OSM/OSRM `fetch` fused with AI-SDK `tool()` defs (`map-tools.ts`).
- **Domain logic runs in the browser.** `WorldInspector.tsx` value-imports `deriveCharacterBadges`/`deriveSceneBadge` (`inspector-badges.ts`), `organizePlayerProfileFacts` (`player-profile.ts`), and inline-parses `[t:N]` provenance; `useNarratorAudio.ts` runs the `splitNewChunks` chunk-boundary decision client-side (and that boundary **must stay byte-identical to the server's** for TTS cache hits).

### 1.4 The god files and the leak test

`CLAUDE.md`'s **leak test** — *"if adding one feature forces you to edit two layers at once, a concern has leaked"* — is failed structurally by the heaviest modules:

| Module | LOC | Concerns fused (should be ≥3 separate homes) | Target layer(s) |
| --- | --- | --- | --- |
| `src/lib/archivist.ts` | **2223** | 8 Zod patch schemas · 2 LLM calls (`extractPatch`/`extractCorrectionPatch`) · ~50 prepared stmts · all character/place dedup + name resolution + alias/`reveals_name_of` merge · scene-transition invariant · the 370-line `applyArchivistPatch` write txn | domain (resolution/sanitize/invariant), infra (LLM adapter + repos), app (ApplyCorrection) |
| `src/lib/db.ts` | **823** | connection bootstrap · ~40 prepared stmts · all row TYPE defs · tts upsert+prune txn | infra (repositories + Mongo connection) + domain (entity types) |
| `src/lib/migrations.ts` | **858** | the entire schema as a SQLite migration runner | infra (Mongo schema/index setup; runner becomes a no-op) |
| `src/lib/world-state.ts` | **714** | read-side aggregation (imports `db`) · row TYPE defs · prompt rendering (`formatStateBlock`/`formatDossierBlock`/`formatOccupancyBlock`) | app/infra read model + adapter-side rendering; types → domain |
| `src/lib/npc-agent.ts` | **695** | `NpcAgentPatchSchema` · `runNpcAgentTick` LLM call · ~18 field-writer UPDATEs · pure helpers | domain (helpers), infra (LLM + repo) |
| `src/app/api/chat/route.ts` | **593** | request validation · retry/dedup policy · cost-cap gate · 6 LLM/IO orchestrations · prompt rendering · 2 persistence boundaries · UI-stream rendering · `process.once('SIGTERM')` drain | app (`AdvanceTurn` use case) + thin inbound adapter |
| `src/components/WorldInspector.tsx` | **1333** | fetch + domain fns in-browser + provenance parsing + JSX | client adapter only (domain moves server-side or to DTO fields) |
| `src/components/Chat.tsx` | **998** | streaming + pagination + cost math (`formatUsd`, pricing) + dual turn-id glue + JSX | client adapter only |
| `src/components/useNarratorAudio.ts` | **945** | Web-Audio I/O (legit client) + the cache-critical chunk-boundary decision | client adapter + shared pure splitter |

`chat/route.ts` is the highest-risk piece: its `onFinish` closure captures ~20 outer variables, the `dbTurnId` trailing-metadata mechanism relies on a `flush`-fires-after-`onFinish` ordering hack, and many failure modes (NPC agent, occupancy, archivist, reverie-stamp) are *intentionally* swallowed (`console.error` + continue) for resilience — so a naïve "errors are domain types" refactor would convert soft degradations into hard failures.

### 1.5 What's already clean

A meaningful set of modules are **already pure** (no `db`/SDK import) and are zero-risk lifts into `domain/`: `narrator-guidance.ts`, `character-dedup.ts`, `character-identity.ts`, `world-time.ts`, `story-signal.ts`, `memorable-facts.ts`, `daily-loop.ts`, `turn-numbers.ts`, `genres.ts`, `slash-commands.ts`, `sentence-splitter.ts`, and the cost math in `turn-cost.ts`/`turn-cost-map.ts`. `reveries.ts` and `place-population.ts` have exemplary pure cores (`computeReverieFlares`/`canMintReverie`; `hashSeed`/`mulberry32`/`buildGroups`/`densityForCount`) wrapped by thin I/O. `npc-intents.ts` is the closest thing to a clean repository (CRUD + value types), only spoiled by its direct `db` import. Two caveats: `player-profile.ts` and `narrator-guidance.ts` are **overfit to specific prod worlds** (hardcoded `minerva`/`caesar`/`maya`/`usace` and specific ambient nouns) — moving them as-is enshrines that data in pure code.

### Key problems to solve

- **Persistence is a SQLite singleton fused into 22 importers** with no port; the schema lives only in a hand-rolled migration runner. → Repository ports + a Mongo/Mongoose adapter (§4).
- **No layering on disk.** No `domain/`/`application/`/`infrastructure/`/`composition/`; all logic is in flat `src/lib/` + an 8-route `api/` surface. → Stand up the four rings inside a server package (§3).
- **Deciding logic (name/place resolution, merges, NPC promotion, reverie prune, scene-transition invariant) is interleaved with SQL inside transactions.** → Extract as pure domain services that return *merge plans/intents*; repos stay dumb CRUD run by the use case in one Unit-of-Work (§3, §4.7).
- **The turn pipeline IS a 593-line god endpoint** mixing HTTP, 6 LLM/IO calls, policy, rendering, persistence, and SIGTERM. → `AdvanceTurn` use case returning a `{chunks, completion}` stream value; route becomes a thin parse→call→pipe adapter (§3.5, §5 P5).
- **Model IDs (9 files) and pricing are scattered and leak to the client.** → One infra model registry + cost calculator; pricing server-side only.
- **External services (xAI, Anthropic, xAI TTS, OSM/OSRM, prompt fs reads) are wired directly in feature modules.** → `Narrator`/`StructuredAgent`/`SpeechSynthesizer`/`Geocoder`/`PromptRegistry` ports + infra adapters.
- **Wall-clock (`datetime('now')`) and env reads are embedded in SQL and modules.** → `Clock` port + a single infra config module.
- **No `server-only` guard and no import-boundary tooling** (ESLint extends only `next` presets); client safety is accidental (`import type`) and domain logic runs in the browser. → Add `dependency-cruiser`/`no-restricted-paths` + a shared DTO package; move badge/profile/provenance derivation server-side (§2.5).
- **Append-only + cap/prune invariants are app-enforced** (`turns.metadata` merge-not-clobber, `npc_reveries` cap 3, occupancy retention) and must be replicated, not lost, under Mongo (`$set` on nested paths / `$inc`, not document replace) (§4.4, §4.6).
- **The monorepo split has a pre-drawn seam** — the HTTP API surface (`/api/chat`, `/api/turns`, `/api/world-state`, `/api/world-correction(s)`, `/api/usage`, `/api/tts*`) — but Server Actions (world create/archive) and SQL-reading Server Components (`play/page.tsx`, `page.tsx`) currently bypass it and must be re-expressed as endpoints.

Relevant files: `/Users/adeptus-mechanicus/Projects/chronicles-ai/src/lib/archivist.ts`, `/Users/adeptus-mechanicus/Projects/chronicles-ai/src/lib/db.ts`, `/Users/adeptus-mechanicus/Projects/chronicles-ai/src/lib/migrations.ts`, `/Users/adeptus-mechanicus/Projects/chronicles-ai/src/lib/world-state.ts`, `/Users/adeptus-mechanicus/Projects/chronicles-ai/src/app/api/chat/route.ts`, `/Users/adeptus-mechanicus/Projects/chronicles-ai/src/components/{Chat,WorldInspector}.tsx`, `/Users/adeptus-mechanicus/Projects/chronicles-ai/src/components/useNarratorAudio.ts`, `/Users/adeptus-mechanicus/Projects/chronicles-ai/src/lib/pricing.ts`.

## 2. Monorepo Structure & Client/Server Split

### 2.1 Tooling: npm workspaces (not pnpm, not Turborepo)

**Recommendation: npm workspaces.** The repo is already on npm with a committed `package-lock.json` (`package.json:1-39`), `private: true`, and a single native dependency (`better-sqlite3@^12`, soon `mongoose`). At exactly two deployable packages plus one type-only shared package, the cost/benefit is clear:

| Option | Verdict | Reason |
|---|---|---|
| **npm workspaces** | **Adopt** | Zero lockfile migration (keep `package-lock.json`), flat hoisting that Railway nixpacks/buildpacks handle natively, no new buildpack config. Native addons (`better-sqlite3`/`mongoose`) rebuild cleanly. |
| pnpm workspaces | Reject | Forces lockfile migration + a Railway buildpack change for the symlinked `node_modules` layout; strict isolation regularly trips native-addon rebuilds. Marginal disk savings at 3 packages. |
| Turborepo | Defer | A task-graph/cache layer that pays off at many packages or heavy CI. Overkill for client+server. It layers *on top of* npm workspaces later with no re-tooling if build caching ever hurts — so adopting workspaces now does not foreclose it. |

The native-addon point is load-bearing today (`next.config.ts:4` already lists `better-sqlite3` in `serverExternalPackages`); after the Mongo swap (§4) the server keeps a native dep (`mongoose`'s BSON), so the same reasoning holds.

### 2.2 Topology decision: Next.js stays the client; server is a standalone API package

Two viable shapes, given that **streaming `POST /api/chat` must keep working** (the AI-SDK UI message stream + the `flush`-timed `dbTurnId` trailing-metadata hack at `src/app/api/chat/route.ts:478-503`):

| Topology | Where route handlers live | Tradeoff |
|---|---|---|
| **A — Next route handlers as thin inbound adapters in `apps/web`, importing the server package's use cases** (RECOMMENDED) | `apps/web/src/app/api/*` | Single Next runtime on Railway; SSE/streaming "just works" via the existing `createUIMessageStreamResponse` path — no proxy hop, no double-buffering of the narrator stream. The route handler is the *driving adapter*: parse → call use case → pipe. It imports **only** `@chronicles/server` (composition root) + `@chronicles/contracts`. The "client contains no business logic" rule applies to `'use client'` components, **not** to the server-only route handlers/Server Components that already run only on the server. |
| B — standalone server (Hono/Express/Nest) as its own Railway service; `apps/web` is pure frontend | `apps/server/src/routes/*` | Cleaner conceptual split and independent scaling, but adds a second deploy unit and a network hop *in front of the narrator stream*. SSE through a second proxy is workable but is the exact place teleport-bug-class regressions hide; the `dbTurnId` flush ordering must survive an extra transform. Choose this only if the client will later be deployed separately (e.g. static export to a CDN). |

**Adopt A.** The Next.js App Router server runtime *is* the server package's host. `apps/web/src/app/api/chat/route.ts` shrinks from 593 lines to a ~30-line adapter that constructs the composition container, calls `AdvanceTurn.execute({ worldId, playerText })`, and renders the returned `NarrationStream {chunks, completion}` value into the AI-SDK stream + `dbTurnId` metadata part. All onion layers live in `packages/server` and are imported by the route handler — which is server-only code, never shipped to the browser.

This keeps the spec §8 HTTP API as the contract seam (it was already `[ESSENTIAL]` and architecture-neutral) without standing up a second service.

### 2.3 Directory tree

```
chronicles-ai/
├── package.json                 # root: { "private": true, "workspaces": ["apps/*", "packages/*"] }
├── package-lock.json            # single lockfile, stays npm
├── tsconfig.base.json           # shared compilerOptions; each package extends this
├── .dependency-cruiser.cjs      # NEW: boundary enforcement (see §2.5)
├── prompts/                      # MOVED → packages/server/prompts (see §2.8 cwd note)
│
├── apps/
│   └── web/                      # CLIENT package — Next.js 15, rendering only
│       ├── package.json          # name "@chronicles/web"; deps: next, react, react-dom, @ai-sdk/react, tailwind
│       ├── next.config.ts        # serverExternalPackages stays here (route handlers run server code)
│       ├── tsconfig.json         # references ../../packages/server, ../../packages/contracts
│       └── src/
│           ├── app/
│           │   ├── page.tsx                       # Server Component → calls @chronicles/server use case
│           │   ├── worlds/[worldId]/play/page.tsx  # Server Component → LoadHistory use case (NOT @/lib/db)
│           │   ├── worlds/new/actions.ts           # Server Action → thin adapter over CreateWorld use case
│           │   └── api/
│           │       ├── chat/route.ts               # thin: parse → AdvanceTurn → pipe NarrationStream
│           │       ├── turns/route.ts              # thin: → LoadHistory
│           │       ├── world-state/route.ts        # thin: → InspectWorld
│           │       ├── world-correction(s)/route.ts# thin: → ApplyCorrection / ListCorrections
│           │       ├── usage/route.ts              # thin: → SummarizeUsage
│           │       └── tts/{route,record/route}.ts # thin: → SynthesizeNarration / RecordTtsUsage
│           └── components/                          # 'use client' ONLY — Chat, WorldInspector, useNarratorAudio
│
└── packages/
    ├── contracts/                # SHARED — framework-free DTOs + Zod schemas. No I/O, no SDK, no mongoose.
    │   ├── package.json          # name "@chronicles/contracts"; deps: zod ONLY
    │   └── src/
    │       ├── chat.ts           # ChatRequest, MessageMetadata {dbTurnId}, NarrationStreamDTO
    │       ├── world-state.ts    # WorldStateDTO (was FullWorldState), CharacterDTO, SceneDTO, ReverieDTO
    │       ├── cost.ts           # TurnCostDTO / AgentCostDTO / TtsCostDTO (shapes only)
    │       ├── corrections.ts    # CorrectionDTO, ApplyCorrectionRequest/Response
    │       ├── history.ts        # OlderTurnDTO, OlderResponseDTO
    │       └── pure/             # cache-hash-critical pure domain shared by BOTH sides
    │           └── sentence-splitter.ts   # splitNewChunks — MUST be byte-identical client↔server
    │
    └── server/                   # SERVER package — the full onion
        ├── package.json          # name "@chronicles/server"; deps: mongoose, @ai-sdk/anthropic, @ai-sdk/xai, ai, zod, @chronicles/contracts
        ├── prompts/              # narrator-system.md, archivist-system.md, ... (resolved via import.meta.url)
        ├── tests/                # all 34 *.test.ts move here (server-side); chat-route test → composition test
        ├── scripts/              # clone-world, copy-world, repair-* — DB/LLM maintenance tools
        └── src/
            ├── domain/           # onion "domain": entities, value objects, PURE services, PORTS
            ├── application/      # onion "app": use cases (AdvanceTurn, CreateWorld, ApplyCorrection, ...)
            ├── infrastructure/   # onion "infra": mongo repos, LLM adapters, TTS, geocoder, clock, prompt loader
            ├── composition/      # DI wiring root (the only place adapters meet use cases)
            └── index.ts          # public API: re-exports composition container + use-case entry points ONLY
```

`packages/server/src/{domain,application,infrastructure,composition}` is the existing blueprint's hexagonal layout verbatim (`docs/specs/hexagonal-architecture-blueprint.md` §9) — the requested onion rings map 1:1 (domain=domain, app=application, infra=infrastructure, server=composition + the host's route handlers/Server Actions in `apps/web`). Do **not** introduce parallel vocabulary.

### 2.4 The hard rule: the client carries no onion concern

**`apps/web`'s client code may import exactly two packages and nothing else:**

1. `@chronicles/contracts` — DTO types + Zod request/response schemas + the cache-critical pure `sentence-splitter`.
2. A typed API client (generated or hand-written, shipped *from* `@chronicles/contracts` as `pure/api-client.ts`) that wraps `fetch`/`useChat` against the §8 endpoints and returns the DTO types.

**It must NOT import:** `@chronicles/server` (from `'use client'` files), `mongoose`, `better-sqlite3`, `@ai-sdk/anthropic`, `@ai-sdk/xai`, `ai` (except `@ai-sdk/react`), or anything under `packages/server/src/{domain,application,infrastructure,composition}`.

This kills the current leaks identified in the map:
- `pricing.ts` (model IDs `grok-4.3`/`claude-haiku-4-5-20251001` + `$` rates) and `turn-cost.ts` cost math move to `packages/server/src/infrastructure`. The server runs `summarizeTurn` and ships a pre-computed `TurnCostDTO`; the client keeps only a `formatUsd` presentation helper (or receives pre-formatted strings). **No model IDs in the browser bundle.**
- `inspector-badges.ts` (`deriveCharacterBadges`/`deriveSceneBadge`), `organizePlayerProfileFacts`, and the inline `[t:N]` `parseStateEntry` in `WorldInspector.tsx` run **server-side**; `WorldStateDTO` ships `badges[]`, grouped profile facts, and parsed provenance ready to render.
- The `WorldInspector → world-state.ts → db.ts` and `worlds.ts`/`reveries.ts` **type-import** chains (currently safe only by accident of `import type`) are severed: the client imports `WorldStateDTO`/`ReverieDTO` from `@chronicles/contracts`, never the server lib types.

The **one exception** is `sentence-splitter.ts`: the TTS chunk boundary must be byte-identical on client (live narration) and server (cache write) or TTS cache hits diverge and double spend (map risk). It has no I/O, so it lives in `@chronicles/contracts/src/pure/` and is imported by both `useNarratorAudio.ts` and the server's `SpeechSynthesizer` adapter — shared, not duplicated.

### 2.5 Enforcement (this does not exist today — it is net-new tooling)

ESLint extends only `next/core-web-vitals` + `next/typescript` (`eslint.config.mjs`); there is no boundary check despite CLAUDE.md claiming cross-layer imports "should fail CI." Add `dependency-cruiser` at the root and run it in CI:

```js
// .dependency-cruiser.cjs (forbidden rules — abbreviated)
module.exports = {
  forbidden: [
    { name: 'client-no-server-internals',
      from: { path: '^apps/web/src/components' },
      to:   { path: '^packages/server/src/(domain|application|infrastructure|composition)' } },
    { name: 'client-no-native-or-sdk',
      from: { path: '^apps/web/src/components' },
      to:   { dependencyTypes: ['npm'],
              path: 'mongoose|better-sqlite3|@ai-sdk/(anthropic|xai)|^ai$' } },
    { name: 'domain-points-inward',
      from: { path: '^packages/server/src/domain' },
      to:   { path: '^packages/server/src/(application|infrastructure|composition)' } },
    { name: 'app-no-concrete-adapter',
      from: { path: '^packages/server/src/application' },
      to:   { path: '^packages/server/src/infrastructure' } },
    { name: 'mongoose-only-in-mongo-adapter',
      from: { pathNot: '^packages/server/src/infrastructure/persistence/mongo' },
      to:   { dependencyTypes: ['npm'], path: '^mongoose$' } },
    { name: 'contracts-pure',
      from: { path: '^packages/contracts' },
      to:   { dependencyTypes: ['npm'], pathNot: '^zod$' } },
  ],
};
```

Plus a guard test grepping for the classic regressions (model-ID literal outside `infrastructure/llm/`, merge/name-resolution under `infrastructure/`, prompt markdown outside the renderer). The `import "server-only"` package should also be added to every `packages/server` entry module so a stray value-import into a `'use client'` file fails the build loudly — the missing guardrail the map flagged.

### 2.6 Shared contract types (`@chronicles/contracts`)

This package is the only thing both sides import. It is framework-free (depends on `zod` and nothing else) so the client can never transitively pull `mongoose`/SDK. It owns the wire seam the client currently re-declares inline (`Chat.tsx` re-declares `OlderTurn`/`OlderResponse`/`MessageMetadata`; `WorldInspector` re-declares `Correction`):

| Concern | Contract export | Replaces |
|---|---|---|
| Chat request | `ChatRequestSchema` (Zod) + `ChatRequest` | inline schema at `route.ts:62-72` |
| Stream metadata | `MessageMetadata { dbTurnId: string }` | `Chat.tsx:23-28` inline |
| Persisted-turn id protocol | formalized in `MessageMetadata` so id type is store-agnostic (SQLite int → Mongo seq/ObjectId) | implicit `dbTurnId` vs `msg-id` vs `String(t.id)` glue |
| World state read | `WorldStateDTO` + `CharacterDTO`/`SceneDTO`/`ReverieDTO` (with `badges[]`, grouped facts) | `FullWorldState` type imported from `world-state.ts` |
| Cost rollup | `TurnCostDTO`/`AgentCostDTO`/`TtsCostDTO` | types from `turn-cost.ts` |
| History page | `OlderResponseDTO`/`OlderTurnDTO` | `Chat.tsx:43-51` |
| Corrections | `CorrectionDTO`, `ApplyCorrectionRequest/Response` | `WorldInspector.tsx:1107-1190` |

The server maps `domain → DTO` at the adapter edge (in the route handler / use-case result mapper); the client only ever sees DTOs. The Zod schemas live here because untrusted input crosses the boundary once — the route handler validates with the *same* schema the client typed its request against.

### 2.7 Per-package `package.json` dependency split

**`apps/web/package.json`** (client — rendering only):
```jsonc
{
  "name": "@chronicles/web",
  "dependencies": {
    "@ai-sdk/react": "^2.0.0",        // useChat / DefaultChatTransport — the ONLY ai-sdk piece allowed client-side
    "@chronicles/contracts": "workspace:*",
    "@chronicles/server": "workspace:*", // imported ONLY by server-only route handlers / Server Components
    "next": "^15.0.0", "react": "^19.0.0", "react-dom": "^19.0.0"
  },
  "devDependencies": { "@tailwindcss/postcss": "^4", "postcss": "^8", "tailwindcss": "^4" }
}
```
> Note: `@chronicles/server` is a dependency of `apps/web` because route handlers and Server Components (server-only) import it. The boundary rule (§2.5) forbids `apps/web/src/components` (the `'use client'` tree) from reaching it — enforcement is path-scoped, not package-scoped.

**`packages/server/package.json`** (the onion):
```jsonc
{
  "name": "@chronicles/server",
  "dependencies": {
    "@ai-sdk/anthropic": "^2.0.0",  // archivist/classifier/reconciler/npc-agent/region/world-gen
    "@ai-sdk/xai": "^2.0.73",       // narrator + opening-turn + TTS key
    "ai": "^5.0.0",                 // streamText/generateObject/tool()
    "mongoose": "^8",               // replaces better-sqlite3
    "zod": "^4.4.3",
    "@chronicles/contracts": "workspace:*",
    "server-only": "^0.0.1"
  },
  "devDependencies": { "vitest": "^4.1.7", "@types/node": "^22" }
}
```

**`packages/contracts/package.json`**: `{ "dependencies": { "zod": "^4.4.3" } }` — nothing else.

`better-sqlite3` + `@types/better-sqlite3` are **deleted** once the Mongo adapter lands (sequence the repository-port extraction before the driver swap per blueprint §10). Until then they live in `packages/server` only.

### 2.8 tsconfig, path aliases, project references

Drop the single root `@/*` alias (`tsconfig.json:17-19`) — it is load-bearing across 38 src + 30 test files + tsx scripts (map risk), so the rewrite is the biggest mechanical task and should be a codemod gated by `type-check` + `vitest`. Replace per-package aliases + TS project references for incremental builds:

**`tsconfig.base.json`** (root, shared compilerOptions):
```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "skipLibCheck": true, "isolatedModules": true,
    "esModuleInterop": true, "resolveJsonModule": true, "composite": true, "declaration": true
  }
}
```
- `packages/contracts/tsconfig.json` — `extends base`, no references, `paths: { "@chronicles/contracts/*": ["./src/*"] }`.
- `packages/server/tsconfig.json` — `extends base`, `references: [{ "path": "../contracts" }]`, alias `@server/*` → `./src/*` (server-internal only; the layering rule, not the alias, prevents cross-ring imports).
- `apps/web/tsconfig.json` — `extends base`, `jsx: "preserve"`, `plugins: [{ "name": "next" }]`, `references: [{ "path": "../../packages/server" }, { "path": "../../packages/contracts" }]`. The client imports server/contracts **by package name**, never by reaching into source paths.

`composite: true` + `references` gives `tsc --build` incremental rebuilds across packages. Vitest moves into `packages/server/vitest.config.ts` (keep `env.DATABASE_PATH=':memory:'` until Mongo, then point at a Mongo test connection / `mongodb-memory-server`); set `resolve.tsconfigPaths` to the server tsconfig. All 34 tests are server-side (only `chat-route-parsing` touches an HTTP handler, none test React) so the suite migrates wholesale — no client test harness needed initially.

**cwd coupling must be fixed during the move:** `prompt-files.ts` and `db.ts` resolve from `process.cwd()` (`readFileSync(path.join(process.cwd(),'prompts',...))`). After `prompts/` moves under `packages/server`, resolve relative to the module (`new URL('../prompts/...', import.meta.url)`) so the server runs correctly regardless of which directory the process starts from. The `NEXT_PHASE==='phase-production-build'` `:memory:` guard (`db.ts:151`) needs a Mongo analog — a build-time stub so Next page-data collection doesn't dial a live DB.

### 2.9 Railway deployment

Today: one Next service, SQLite file on a mounted volume via `DATABASE_PATH`. Target with topology A:

| Aspect | Today | After split |
|---|---|---|
| Compute services | 1 (Next + SQLite) | **1** (Next host runs `apps/web`, which embeds `@chronicles/server` in-process) |
| Database | SQLite file on Railway volume | **Managed MongoDB** (Railway Mongo plugin or Atlas) via `DATABASE_URL` connection string — the volume disappears |
| Multi-doc transactions | better-sqlite3 `BEGIN IMMEDIATE` | **requires a replica set** — `createWorld` seed, `applyArchivistPatch`, promotion/reverie/intent batches need `session.withTransaction`; a single-node mongod silently cannot honor the UnitOfWork atomicity. Use Atlas or a Railway replica-set config. **Infra prerequisite, flag in the deploy plan.** |
| Build | `next build` at root | root `npm ci` (workspaces hoist) → `tsc --build packages/server` → `next build` in `apps/web`. Set Railway root/build command to the workspace-aware sequence. |
| Env contract | `DATABASE_PATH`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `DAILY_TOKEN_LIMIT`, `MAP_*`, `TTS_*` | swap `DATABASE_PATH` → `DATABASE_URL` (already the documented long-term env in CLAUDE.md); the rest unchanged, centralized into one `packages/server/src/infrastructure/config.ts` |

Topology A keeps a **single Railway service**, so SSE streaming from `POST /api/chat` has no extra proxy hop. Choose topology B (separate `apps/server`) only if the client later deploys to a CDN/static host — at which point the §8 API is already the contract and the route handlers move from `apps/web/src/app/api` to the standalone server with no use-case changes.

**Version-header caveat:** the prod trust signal at `src/app/page.tsx:17` reads `pkg.version`. Post-split that file lives in `apps/web`, so the header reads `apps/web/package.json`'s version. Decide that `apps/web` is the version-of-record for the UI header and keep the bump discipline there (or have CI assert `apps/web` and `packages/server` versions match), or the header silently desyncs from what's deployed.

---

Relevant paths for downstream sections: the persistence swap rides `packages/server/src/infrastructure/persistence/mongo/`; the `AdvanceTurn` carve-out rides `apps/web/src/app/api/chat/route.ts` → `packages/server/src/application/AdvanceTurn.ts`; the contract seam is `packages/contracts/src/`.

## 3. Onion Architecture (domain / app / infra / server)

### 3.0 The onion framing IS the existing hexagonal blueprint

This project already has a binding ports-and-adapters design *on paper* in `docs/specs/hexagonal-architecture-blueprint.md` — but **none of it is implemented in code**: there is no `domain/`, `application/`, `infrastructure/`, or `composition/` directory today, and not a single port or use case exists. The blueprint is a reference vocabulary, not a baseline to extend. The requested four-ring onion (domain / app / infra / server) is **the same dependency-inversion idea under different ring labels** — so reuse the blueprint's named ports/services/errors rather than inventing a parallel vocabulary, but treat all of it as net-new code to write. Two of the blueprint's choices are explicitly overridden by this document: its Postgres/Drizzle persistence becomes **MongoDB/Mongoose** (§4), and its single-Next.js-app layout becomes a **two-package monorepo** (§2). The ring mapping is 1:1:

| Onion ring | Hexagonal blueprint layer | Responsibility |
|---|---|---|
| **domain** | `domain/` — entities, value objects, pure services, **and the port interfaces** | Pure decisions. Zero I/O. Defines the interfaces the outside world must satisfy. |
| **app** | `application/` — use cases (the inbound ports) | Orchestration + transaction boundaries only. Composes domain services and calls outbound ports. |
| **infra** | `infrastructure/` — driven adapters implementing domain ports | All SQL/Mongo, all LLM SDK calls, TTS, geocoding, embeddings, clock, logger, prompt-file fs. All model IDs + pricing. |
| **server** | `app/` + `components/` driving adapters **+** `composition/` wiring root | The inbound HTTP/SSE edge. Parses requests, calls a use case, renders the result/stream, maps domain errors to status codes. Owns no logic. |

Hexagonal's inbound-vs-outbound port distinction collapses to: **app defines the use-case (inbound) surface; domain defines the outbound port interfaces; infra implements them; the composition root is the only place they meet.** Everything that follows reuses the blueprint's named ports, use cases, services, and errors verbatim.

### 3.1 Layer responsibilities and strict import rules

```
server  ──imports──▶  app  ──imports──▶  domain  ◀──implements──  infra
   │                                        ▲                        │
   └──────────────── composition wires app ⨯ infra ◀────────────────┘
                     (the ONLY module that imports infra)
```

- **domain** — imports **nothing** outward. No `import` of `mongoose`, `ai`, `@ai-sdk/*`, `next`, `fs`, `fetch`, or a wall-clock. Deterministic, no I/O. Holds entities, value objects, pure services, port interfaces, and domain errors. The pure functions already isolated by the explorers (`turn-numbers.ts`, `world-time.ts`, `narrator-guidance.ts`, `character-dedup.ts`, `memorable-facts.ts`, `story-signal.ts`, the reverie scoring in `reveries.ts`, the PRNG/builders in `place-population.ts`) are drop-in candidates with **no behavior change**.
- **app** — imports `domain/` only. Never SQL, never an SDK, never a framework, never a model-ID literal. Each use case loads rows via repository ports, runs pure domain services to **decide**, then hands flat write commands back to dumb repos inside a `UnitOfWork`.
- **infra** — imports `domain/` (to implement its ports) and external libs. The **only** layer allowed to `import mongoose`, `@ai-sdk/anthropic`, `@ai-sdk/xai`, `ai`, `node:fs`, `node:crypto`, or read `process.env`. Holds the single `model-registry.ts` + `pricing.ts` (collapsing the seven duplicated `claude-haiku-4-5-20251001` constants and the two `grok-4.3` literals).
- **server** — imports `app/` use cases (via the composition container) and `domain/` types/errors for mapping. Parses Zod at the edge, maps `WorldNotFound→404` etc., renders `ContextBundle`→prompt and result→HTTP/SSE. Owns no decision.
- **composition** — the **only** module importing `infra/`. Instantiates adapters, injects them into use cases, exports a container the server consumes.

### 3.2 SERVER package directory tree

```
packages/server/src/
  domain/
    entities/
      world.ts                 # World, initialState VO
      turn.ts                  # Turn (append-only), TurnMetadata VO
      character.ts             # Character, AgencyLevel, CharacterStatus
      place.ts                 # Place, GeoStatus
      scene.ts                 # Scene, SceneMood/Pace/Focus
      story.ts                 # StoryThread/Clue/Objective/Resource, TimelineEvent
      npc-intent.ts            # NpcIntent, IntentVisibility, IntentDisposition
      reverie.ts               # Reverie, FlareCandidate
      occupancy.ts             # PlaceOccupancy, OccupancyGroup, EncounterHook
    value-objects/
      context-bundle.ts        # structured narrator context (pre-render)
      archivist-patch.ts       # inferred type from the Zod schema (schema lives in infra)
      classification.ts
      daily-loop.ts
      token-budget.ts
    services/
      context-assembler.ts     # pure: 9-priority budget assembly
      patch-sanitizer.ts       # ex-archivist.ts sanitize + transition guards + transit normalize
      character-resolver.ts    # ex-archivist.ts resolve/merge/alias — returns a MERGE PLAN, issues no I/O
      place-resolver-rules.ts  # placesMatch / mergePlaces plan
      scene-transition.ts      # the v0.6.10/19 invariant — returns scene-open/close intents
      reverie-flare.ts         # computeReverieFlares, canMintReverie, prune plan
      npc-promotion.ts         # tier ladder over flat rows -> promote/demote commands
      action-classifier-rules.ts
      occupancy-sim.ts         # hashSeed/mulberry32/buildGroups/densityForCount/buildHooks
      narrator-guidance.ts
      character-dedup.ts
      world-clock.ts           # worldTimeBand
      memorable-fact-provenance.ts  # [t:N] append/strip
      story-signal.ts          # hasRichStorySignal
      cost-policy.ts           # cap comparison (limit + isOver), Clock-driven
      turn-numbering.ts        # buildTurnNumberMap
    ports/
      repositories.ts          # WorldRepository, TurnRepository, CharacterRepository, ...
      unit-of-work.ts          # UnitOfWork.run(session => ...)
      llm.ts                   # NarratorPort, StructuredAgent<I,O>
      embedding.ts             # EmbeddingPort
      tts.ts                   # SpeechSynthesizerPort
      geocoder.ts              # GeocoderPort
      clock.ts                 # ClockPort
      logger.ts                # LoggerPort
      prompt-loader.ts         # PromptLoaderPort
      background-tasks.ts      # BackgroundTasksPort (register/drain for SIGTERM)
    errors.ts                  # WorldNotFound, BudgetExceeded, ContextOverflowError, InvalidPatch, ...
  app/
    use-cases/
      advance-turn.ts          # the crown jewel (ex-chat/route.ts pipeline)
      replay-turn.ts           # completed-retry short-circuit policy
      run-meta-command.ts
      create-world.ts          # ex-worlds/new/actions.ts orchestration
      seed-world.ts            # ex-opening-turn.ts
      apply-correction.ts      # ex-world-correction/route.ts
      load-history.ts          # ex-turns/route.ts
      inspect-world.ts         # ex-world-state/route.ts
      list-corrections.ts
      summarize-usage.ts
      synthesize-narration.ts  # ex-tts/route.ts
      record-tts-usage.ts
  infra/
    persistence/mongo/
      connection.ts            # mongoose.connect, replica-set guard, build-phase no-op (ex NEXT_PHASE :memory:)
      models/                  # Mongoose schemas: World, Turn, Character, Place, Scene, Story*, NpcIntent, Reverie, PlaceProfile, OccupancySnapshot, TtsAudioCache, WorldCorrection, Counter (turn seq)
      repositories/            # *RepositoryMongo implementing the domain ports
      unit-of-work-mongo.ts    # session.withTransaction
    llm/
      anthropic-adapter.ts     # generateObject + experimental_repairText + Zod parse
      xai-adapter.ts           # streamText / generateText narrator
      model-registry.ts        # ALL model IDs (grok-4.3, claude-haiku-4-5-20251001)
      pricing.ts               # ex src/lib/pricing.ts — RATES + TTS_RATE
      agents/                  # archivist-agent, classifier-agent, reconciler-agent, npc-agent, region-agent, world-generator-agent, correction-agent (prompt build + parse, behind StructuredAgent)
    tts/xai-tts-adapter.ts     # ex src/lib/tts.ts streamSpeech/warmConnection
    geo/osm-adapter.ts         # ex src/lib/map-tools.ts fetch client (tool() wrappers stay in server)
    embedding/voyage-adapter.ts# Phase-2 slot (port defined now, impl stub)
    prompt/fs-prompt-loader.ts # ex src/lib/prompt-files.ts
    clock/system-clock.ts
    logger/console-logger.ts
    config/env.ts              # the ONLY process.env reads
  server/                      # inbound HTTP adapters (Next route handlers OR a standalone server)
    api/chat/route.ts          # parse -> AdvanceTurn -> render UI stream + dbTurnId
    api/turns/route.ts
    api/world-state/route.ts
    api/world-correction/route.ts
    api/world-corrections/route.ts
    api/usage/route.ts
    api/tts/route.ts
    api/tts/record/route.ts
    render/                    # ContextBundle->markdown, ArchivistPatch->JSON, error->Response mapper
  composition/
    container.ts               # the ONLY importer of infra/; wires adapters into use cases
```

### 3.3 File-by-file migration map

`split` = the file fans out across layers; cite the explorer `domainVsIo` findings.

| Current file | → Destination(s) | What gets split out |
|---|---|---|
| `src/lib/db.ts` | `infra/persistence/mongo/connection.ts` + `models/*` + `repositories/*` | Connection bootstrap → connection.ts; the ~40 prepared statements → typed repository methods; all row TYPE defs → `domain/entities/*`; build-phase `:memory:` guard → connection.ts replica-set/build-phase guard |
| `src/lib/migrations.ts` | `infra/persistence/mongo/` (index setup) | 25-step runner has **no Mongo analog**; becomes unique-index creation + a lightweight `migrations` collection. SQLite-only `migrations.test.ts` is dropped. |
| `src/lib/world-state.ts` | **split**: `app/use-cases/inspect-world.ts` (assembly) + `server/render/state-block.ts` (`formatStateBlock`/`formatDossierBlock`/`formatOccupancyBlock` — rendering) + `WorldStateRepository` reads | Reading and prompt-rendering are fused today; render family is an outbound adapter concern, not a "world-state lib that imports db" |
| `src/lib/worlds.ts` | **split**: `app/use-cases/create-world.ts` (the 4-statement seed orchestration) + `WorldRepository` CRUD | `createWorld` transaction → `UnitOfWork`; region extraction → `RegionAgent` infra |
| `src/lib/archivist.ts` (2223 LOC, the named anti-pattern) | **split 5 ways**: `domain/services/patch-sanitizer.ts` (`sanitizeArchivistPatch`, transition guards, `normalizeTransitPlaceName`, `extractDeterministicPatch`) + `domain/services/character-resolver.ts` (`resolveCharacter`/`mergeCharacters`/`runAliasMerges`/`charactersMatch`/`freshest`/`mergeLineBlocks` → **return a merge plan, no SQL**) + `domain/services/place-resolver-rules.ts` (`placesMatch`/`mergePlaces`) + `domain/services/scene-transition.ts` (the invariant → returns open/close intents) + `infra/llm/agents/archivist-agent.ts` (the two `generateObject` calls + Zod schemas + `buildArchivistUserContent`) + `*RepositoryMongo` (the ~50 prepares). `resolveStoryThreadId` preferQuest rule → `domain/services` (a read-resolve, must stop mutating) | Per explorer: deciding logic currently reads all rows, decides, writes inside one 370-line transaction. Re-cut so the use case loads → runs pure service → applies plan. **Extract behind tests first** (load-bearing ordering, teleport bug fixes). |
| `src/lib/npc-agent.ts` | **split**: `infra/llm/agents/npc-agent.ts` (`runNpcAgentTick` LLM + prompt) + `CharacterRepository` per-field writers + pure helpers (`repairNpcAgentText`, `shouldSkipRoutineTick`) → `domain/services` | Schemas describe untrusted LLM output → infra edge; field setters → dumb repo |
| `src/lib/npc-promotion.ts` | **split**: `domain/services/npc-promotion.ts` (tiering rules over a snapshot → command list) + `CharacterRepository` batch UPDATE | Decision currently interleaved with UPDATEs per character |
| `src/lib/reveries.ts` | **split**: `domain/services/reverie-flare.ts` (`canMintReverie`, `computeReverieFlares`, `pruneReveriesForCharacter` plan, normalizers) + `ReverieRepository` CRUD | Preserve **repoint-before-delete** ordering (CASCADE landmine) in the use case |
| `src/lib/npc-intents.ts` | `NpcIntentRepository` (already clean CRUD — the convergence template) + value types → `domain/entities/npc-intent.ts` | Just sits behind a port |
| `src/lib/intent-reconciler.ts` | `infra/llm/agents/reconciler-agent.ts` | Move inline `RECONCILER_SYSTEM` → `prompts/reconciler-system.md` (fix prompt-as-data inconsistency) |
| `src/lib/classifier.ts` | **split**: `domain/services/action-classifier-rules.ts` (`classifyWithRules` + heuristics) + `infra/llm/agents/classifier-agent.ts` (LLM fallback) | **Preserve order: rules first, LLM only on null** (cost/latency) |
| `src/lib/place-population.ts` | **split**: `domain/services/occupancy-sim.ts` (PRNG + all pure builders) + `app` orchestration in `advance-turn.ts` calling `OccupancyRepository` | `buildPlaceOccupancySnapshot` fuses reads/writes around the pure core |
| `src/lib/place-resolver.ts` | **split**: `infra/geo/osm-adapter.ts` (`lookupPlace`) + `PlaceRepository` geo write-back + `buildLookupQuery` → domain | Orchestration → `advance-turn` step |
| `src/lib/map-tools.ts` | **split**: `infra/geo/osm-adapter.ts` (Nominatim/OSRM fetch) + `server` keeps the AI-SDK `tool()` wrappers (`narratorMapTools`) calling the port | Provider env → `infra/config/env.ts` |
| `src/lib/cost-cap.ts` | **split**: `TurnRepository.todaysTokenTotal` (the SUM/json_extract → Mongo aggregation) + `domain/services/cost-policy.ts` (limit + isOver) | `DAILY_TOKEN_LIMIT` → env config |
| `src/lib/tts.ts` | **split**: `infra/tts/xai-tts-adapter.ts` (`streamSpeech`/`warmConnection`) + pure builders (`buildTtsRequestBody`/`normalizeVoiceId`/`resolveSpeed`) → domain | `TTS_MODEL_KEY` + char rate → `infra/llm/pricing.ts` |
| `src/lib/sentence-splitter.ts` | **SHARED pure package** (client + server) | Chunk boundary must be byte-identical for TTS cache hits — pure, no I/O, must NOT live in the server-only onion |
| `src/lib/world-generator.ts` | `infra/llm/agents/world-generator-agent.ts` | Model ID → registry; inline system prompt → `prompts/` |
| `src/lib/opening-turn.ts` | `app/use-cases/seed-world.ts` + narrator/archivist infra agents | Use-case-ish today but imports SDK+db+model literal directly |
| `src/lib/region-extractor.ts` | `infra/llm/agents/region-agent.ts` | One-shot adapter, no persistence |
| `src/lib/prompt.ts` + `prompt-files.ts` | `infra/prompt/fs-prompt-loader.ts` (impl `PromptLoaderPort`) + `formatPremiseBlock` → `server/render` | cwd-relative read → resolve via `import.meta.url` |
| `src/lib/pricing.ts` | `infra/llm/pricing.ts` | Per CLAUDE.md "all model IDs and pricing live in infrastructure" |
| `src/lib/turn-cost.ts` | `domain/services` (cost math) + reads pricing via injected rates, OR compute server-side and ship `TurnCost` DTO | Client must receive computed costs, not pricing tables |
| `src/lib/turn-cost-map.ts` | **SHARED** client-side glue (type-only `ai` import) | Stays client |
| `src/lib/narrator-guidance.ts`, `character-dedup.ts`, `character-identity.ts`, `world-time.ts`, `story-signal.ts`, `memorable-facts.ts`, `daily-loop.ts`, `inspector-badges.ts`, `player-profile.ts`, `genres.ts`, `turn-numbers.ts` | `domain/services` / `domain/value-objects` (pure, drop-in) | `player-profile.ts`/`narrator-guidance.ts` carry prod-world overfitting (`minerva`/`caesar`/`maya`/`usace`) — moving as-is enshrines world-specific data in pure code; generalization is a separate behavior change |
| `src/lib/llm-schema.ts` | `infra/llm/` (adapter-edge sanitization) | "Untrusted LLM output crosses a boundary once" |
| `src/lib/meta-commands.ts` | `app/use-cases/run-meta-command.ts` + `server/render` | db reads → query ports; markdown render → adapter |
| `src/lib/slash-commands.ts` | **SHARED** constant | Pure data |
| `src/app/api/chat/route.ts` (593 LOC god endpoint) | **split**: `app/use-cases/advance-turn.ts` (the 18-step pipeline + two txn boundaries) + `server/api/chat/route.ts` (parse → call → render UI stream + `dbTurnId`) + `infra/background-tasks` (SIGTERM drain registry) | `execute()` returns a `NarrationStream {chunks, completion}` value — **not** a framework `onFinish` callback. The route wires `completion` to `streamText.onFinish` so the SDK never appears in app code. ~20 captured closure vars become explicit use-case state. |
| `src/app/api/turns/route.ts` | `app/use-cases/load-history.ts` + thin route | `summarizeTurn` (pure) stays domain |
| `src/app/api/world-state/route.ts` | `app/use-cases/inspect-world.ts` + thin route | — |
| `src/app/api/world-correction/route.ts` | `app/use-cases/apply-correction.ts` + thin route | extract → apply → log → fold cost; errors → domain types |
| `src/app/api/world-corrections/route.ts` | `app/use-cases/list-corrections.ts` + thin route | — |
| `src/app/api/usage/route.ts` | `app/use-cases/summarize-usage.ts` + thin route | — |
| `src/app/api/tts/route.ts` | `app/use-cases/synthesize-narration.ts` + thin route | cache via `TtsCacheRepository`; `streamSpeech` via `SpeechSynthesizerPort` |
| `src/app/api/tts/record/route.ts` | `app/use-cases/record-tts-usage.ts` + thin route | — |
| `src/app/worlds/[worldId]/play/page.tsx` | **CLIENT** package; replace direct `lib/db` reads with a fetch against `LoadHistory` | Today a Server Component reaching into SQL — a hard cross-package edge |
| `src/app/worlds/new/actions.ts` | thin Server Action / HTTP endpoint → `app/use-cases/create-world.ts` | Orchestration moves inward; Zod stays at the edge |
| `scripts/*.{mjs,ts}` | server package; re-point at `app` use cases | DB seeding/repair are server citizens |

### 3.4 Ports (interfaces in `domain/ports/`)

**Repository ports** (one per aggregate; dumb CRUD, no deciding logic):
`WorldRepository`, `TurnRepository` (**append-only**: `insert`, `appendMetadata` deep-merge / `$inc` for `tts.chars`, `recentTurns`, `turnsBefore`, `latestUserTurnId`, `assistantMetadataInRange`, `todaysTokenTotal`; **never `update`/`delete` a row**), `CharacterRepository`, `PlaceRepository`, `SceneRepository`, `StoryDossierRepository`, `NpcIntentRepository`, `ReverieRepository`, `OccupancyRepository`, `TtsAudioCacheRepository`, `WorldCorrectionRepository`, and `UnitOfWork` (`run(fn(session))` → Mongo `session.withTransaction`).

**LLM ports:**
- `NarratorPort` — streaming creative output: `stream(bundle): NarrationStream`
- `StructuredAgent<I, O>` — factual extraction: `run(input: I): Promise<O>`. One implementation per agent (archivist, correction, classifier, reconciler, npc-agent, region, world-generator). Holds model ID + cache-control + prompt + Zod parse + `experimental_repairText`.

**Other driven ports:** `EmbeddingPort` (Phase-2 Voyage; defined now, stub impl — keeps the retrieval slot non-empty), `SpeechSynthesizerPort`, `GeocoderPort` (`lookupPlace`/`lookupRoute`), `ClockPort` (replaces every `datetime('now')` / `new Date()`), `LoggerPort`, `PromptLoaderPort`, `BackgroundTasksPort` (`register`/`drain` for SIGTERM graceful shutdown).

### 3.5 Use cases (in `app/use-cases/`) and what each composes

| Use case | Domain services | Ports |
|---|---|---|
| **AdvanceTurn** | CostPolicy, ActionClassifierRules, NpcPromotion, OccupancySim, ReverieFlare, ContextAssembler, PatchSanitizer, CharacterResolver, SceneTransition, CharacterDedup, StorySignal, MemorableFactProvenance, TurnNumbering | TurnRepo, CharacterRepo, PlaceRepo, SceneRepo, StoryDossierRepo, ReverieRepo, NpcIntentRepo, OccupancyRepo, UnitOfWork, NarratorPort, StructuredAgent(classifier/npc-agent/reconciler/archivist), GeocoderPort, ClockPort, BackgroundTasks, Logger |
| **ReplayTurn** | (retry/dedup policy) | TurnRepo (no LLM spend) |
| **RunMetaCommand** | meta-command parse | TurnRepo, WorldRepo (read) |
| **CreateWorld** | (seed assembly) | WorldRepo, PlaceRepo, CharacterRepo, SceneRepo, UnitOfWork, StructuredAgent(region/world-generator), GeocoderPort, Clock |
| **SeedWorld** | ContextAssembler | NarratorPort, StructuredAgent(archivist), TurnRepo, CostPolicy |
| **ApplyCorrection** | PatchSanitizer, CharacterResolver | StructuredAgent(correction), TurnRepo, WorldCorrectionRepo, CharacterRepo, PlaceRepo, UnitOfWork |
| **LoadHistory** | TurnNumbering, cost summarization | TurnRepo |
| **InspectWorld** | (state assembly, badge/profile derivation server-side → DTO) | WorldStateRepo (read projection) |
| **ListCorrections** | — | WorldCorrectionRepo |
| **SummarizeUsage** | cost math | TurnRepo |
| **SynthesizeNarration** | tts request builders | SpeechSynthesizerPort, TtsAudioCacheRepo |
| **RecordTtsUsage** | — | TurnRepo (`appendMetadata` `$inc`) |

AdvanceTurn owns the load-bearing ordering invariant (player turn persists **pre-stream**, fail-closed; narrator + factual work **post-stream**, fail-open) and the two transaction boundaries. **Preserve the best-effort `console.error`-and-continue semantics** for npc-agent/occupancy/geocoder/reverie/dedup/archivist — a naive "errors are domain types" pass must not convert soft degradations into hard failures.

### 3.6 Domain errors and value objects

**Errors** (`domain/errors.ts`, mapped to HTTP **only** in the inbound adapter): `WorldNotFound`→404, `EmptyPlayerAction`→400, `BudgetExceeded`→429, `ContextOverflowError`→500, `InvalidPatch`, `CorrectionExtractFailed`→502, `CorrectionApplyFailed`→500, `TextTooLong`→413, `TtsError`(status passthrough). The domain never constructs an HTTP status.

**Value objects** (`domain/value-objects/` + entity-local): `ContextBundle`, `TokenBudget`, `ArchivistPatch`/`CorrectionPatch` (inferred types; Zod schemas live at the infra edge), `NpcAgentPatch`/`PlannedAction`, `Classification`, `ReconciliationResult`, `DailyLoop`, `PlaceOccupancy`/`OccupancyGroup`/`EncounterHook`, `FlareCandidate`, `IntentVisibility`/`IntentDisposition`, `AuthoritativeState`, `RelationshipAnchor`, `TurnMetadata`. Enums that were SQLite CHECK constraints (`role`, `status`, `agency_level`, `traffic_level`, `scene_mood/pace/focus`, `expected_visibility`, `narrator_disposition`, `importance 1..5`, `intensity/confidence 0..1`) move to **domain validation + Mongoose enums/min-max**, since Mongo enforces none of them.

### 3.7 The leak test and machine-enforced boundaries

**Governing rule (the operative discipline, not the diagram):** *if adding a single feature forces you to edit two layers at once, a concern has leaked — stop and re-cut the boundary before writing the feature.*

This is currently **unbacked** — `eslint.config.mjs` extends only `next/core-web-vitals` + `next/typescript`; there is no dependency-cruiser and no `import/no-restricted-paths`. CLAUDE.md's claim that cross-layer imports "should fail CI" is aspirational. Add as **net-new tooling** in the server package, run in CI:

- **`domain/`** may not import `app/`, `infra/`, `server/`, `mongoose`, `@ai-sdk/*`, `ai`, `next`, `node:fs`, `node:crypto`, `fetch`, or any wall-clock.
- **`app/`** may import `domain/` only — never a concrete adapter, SQL, an SDK, or a model-ID literal.
- **`infra/`** and **`server/`** may import `domain/`; only **`composition/`** may import `infra/`.
- **New boundary rules for the monorepo:** the **client** package may import only the shared contracts package, never `infra/`/`app/`; **`mongoose` is forbidden outside `infra/persistence/mongo/`** (the same rule that forbade `better-sqlite3` outside the SQLite adapter); **model-ID literals are forbidden outside `infra/llm/`**; **prompt markdown rendering is forbidden outside `server/render/`**.

Back the cruiser with a guard test that greps for classic regressions: a `merge`/name-resolution branch under `infra/`, a `claude-`/`grok-` literal outside `infra/llm/`, or a `db.prepare`/raw-handle import outside a repository. Add `import "server-only"` to every infra module and route handler so a stray value-import into the client fails the build loudly (today the client is protected only by the accident that db-backed modules are reached via `import type`).

Sequence per blueprint §10: extract pure domain services → define ports + wrap repos + `UnitOfWork` → `ContextAssembler` → wrap LLM adapters + centralize model IDs → carve `AdvanceTurn` out of the route → repeat for other routes → re-point scripts. Steps 1–7 are **zero-behavior-change refactors on SQLite**; the Mongo adapter swap and the client/server split are **separate capability steps layered after**, never folded into the coupling cleanup.

## 4. Persistence: MongoDB + Mongoose

This section designs the full Mongo target from the **shipped SQLite schema** (14 tables defined by `src/lib/migrations.ts`'s 25 numbered migrations), not from the aspirational `docs/specs/database-design.md` (which describes a Postgres+JSONB model with tables — `wiki_pages`, `memory_chunks`, `users`, etc. — that do not exist). The migrations are the source of truth.

The persistence layer lives in the **server package**, behind repository ports defined in `domain/` and implemented in `infra/`. Mongoose models and `import 'mongoose'` are forbidden anywhere outside `packages/server/src/infrastructure/persistence/mongo/` (enforced by the same boundary rule that today should forbid `better-sqlite3` outside the SQLite adapter).

### 4.1 Aggregate strategy: embed within a turn's write-locality, reference across aggregates

The governing question for each SQLite table is **embed vs. reference**. Two facts from the explorer findings drive almost every decision:

1. **Every entity table already carries a denormalized `world_id`** — keep it. It is the natural shard/scope key and makes every per-world query a single indexed predicate.
2. **The `turns` table is the append-only spine**, mutated only via `metadata` JSON merges (`json_patch`/`json_set`). It is high-write, high-volume (a world can reach thousands of turns), and read by id-range pagination.

The trap to avoid is the "one giant world document" model. `turns`, `characters`, `places`, `scenes`, and the story dossier are all independently mutated *within a single turn* and grow unbounded; embedding them under a `worlds` document would create a hot document with unbounded growth and write contention on every turn. So the rule is:

- **Top-level collection** when the SQLite table is independently queried, independently mutated mid-turn, append-only, or unbounded.
- **Embedded subdocument** only when the child is a small, bounded value object owned and mutated *together with* its parent in the same write.

### 4.2 Translation table: SQLite table → Mongo collection

| SQLite table | Mongo target | Embed / Reference | Justification |
|---|---|---|---|
| `worlds` | `worlds` collection | top-level; `initial_state_json` → embedded `initialState` subdoc | Aggregate root. `current_scene_id` → `currentSceneId: ObjectId` ref (scene is its own collection). `initial_state_json` is a small fixed `{time,location,identity}` blob owned by the world — embed it. |
| `turns` | `turns` collection | top-level, append-only | The spine. Unbounded, id-range paginated, independently inserted. `metadata` TEXT-JSON → native BSON subdoc `metadata`. `world_id`/`scene_id` → `worldId`/`sceneId` refs. **Never embed under world.** |
| `characters` | `characters` collection | top-level; `daily_loop`, `traits_json` → embedded subdocs; `memorable_facts`/`observations` → arrays | Independently mutated every turn (focus/place/agency). `*_json` columns become native subdocs. The `[t:N]`-tagged free-text line lists stay as `string[]` arrays (provenance lives inside the string). |
| `places` | `places` collection | top-level; `osm_*` → embedded `geo` subdoc | Independently resolved by the geocoder. Group the `osm_display_name/street/neighborhood/lat/lng/geo_status/geo_resolved_at` columns into one `geo` subdoc. |
| `scenes` | `scenes` collection | top-level | Referenced by `turns.sceneId` and `worlds.currentSceneId`; queried by active status. Must be a collection, not embedded, because turns point at it. |
| `npc_reveries` | `npc_reveries` collection | top-level, append-only, app-pruned (cap 3/NPC) | Append-only log with `ON DELETE CASCADE` from characters and freshest-wins eviction. Keep as its own collection; the cap-3 prune is domain logic the use case runs (§4.6). Could embed under character, but the repoint-before-delete ordering and per-reverie `last_flared_turn_id` stamping argue for a collection. |
| `npc_intents` | `npc_intents` collection | top-level, append-only ledger | Durable plan ledger with a partial index (`narrator_turn_id IS NULL`). Queried independently of any character read. |
| `story_threads` | `story_threads` collection | top-level | Independently upserted; readers LEFT JOIN for `thread_title`. Mongo: keep as collection, denormalize `threadTitle` onto clues/objectives or `$lookup` at read time. |
| `story_clues` | `story_clues` collection | top-level, `threadId` ref | Independently statused (open/interpreted/spent/false_lead). |
| `story_objectives` | `story_objectives` collection | top-level | Independently statused/blocked. |
| `story_resources` | `story_resources` collection | top-level, `ownerCharacterId` ref | Independently owned/statused. |
| `timeline_events` | `timeline_events` collection | top-level, append-only | Append-only event log keyed by `turnId`/`worldTime`/`importance`. |
| `place_profiles` | embed into `places` as `profile` subdoc | **embedded** | One profile per place (`UNIQUE(world_id,place_id)`), upserted `ON CONFLICT DO NOTHING`, and always read alongside its place. Pure 1:1 ownership → embed. |
| `population_templates` | `population_templates` collection | top-level (mostly static seed data) | Keyed by `place_profile_kind`, read to build occupancy. Small, world-scoped, queried by kind — a collection (or even a static config doc), not embedded. |
| `place_occupancy_snapshots` | `place_occupancy_snapshots` collection | top-level, append-only, app-pruned | Append-only log; reader takes latest-by-id and only honors it if `scene_id` matches active scene. `occupancy_json` → native subdoc. Pruned by turn-count in code — keep the prune. |
| `tts_audio_cache` | `tts_audio_cache` collection (audio → GridFS or `Binary`) | top-level | The only binary column (`audio BLOB`). Small clips (≤8MB, 2 turns/world retained) → `BSON Binary` inline is simplest; if clips exceed 16MB BSON cap, GridFS. Compound unique key recreated as a unique index. |
| `world_corrections` | `world_corrections` collection | top-level, append-only audit | `applied_patch` TEXT-JSON → native subdoc. Self-describing audit row, read DESC. |
| `turn_states`, `turns.state_json`, `characters.reveries` | **dropped** | — | Already dead in SQLite (migration 5 / 24). Do not port. |

**Net: 15 top-level collections** (`worlds`, `turns`, `characters`, `places`, `scenes`, `npc_reveries`, `npc_intents`, `story_threads`, `story_clues`, `story_objectives`, `story_resources`, `timeline_events`, `population_templates`, `place_occupancy_snapshots`, `tts_audio_cache`, `world_corrections`) plus **2 embedded subdocs** (`place_profiles`→`places.profile`, `worlds.initialState`). All `*_json` / `daily_loop` / `occupancy_json` / `applied_patch` / `metadata` text columns drop the `JSON.parse`/`stringify` boundary and become native BSON.

### 4.3 Illustrative Mongoose schemas

These live in `packages/server/src/infrastructure/persistence/mongo/models/`. **CHECK constraints become Mongoose `enum`/`min`/`max`; functional `lower(name)` unique indexes become an explicit normalized key field** (`nameKey`) because Mongo has no functional indexes.

**`turns` — the append-only spine.**

```ts
// infrastructure/persistence/mongo/models/turn.model.ts
import { Schema, model, Types } from 'mongoose';

const TurnSchema = new Schema(
  {
    // load-bearing monotone integer sequence — see §4.5
    seq:       { type: Number, required: true },          // global, monotone, == old turns.id
    worldId:   { type: Types.ObjectId, ref: 'World', required: true, index: true },
    role:      { type: String, enum: ['user', 'assistant'], required: true },
    content:   { type: String, required: true },
    sceneId:   { type: Types.ObjectId, ref: 'Scene', default: null },
    // nested per-agent usage blocks: narrator/classifier/npc_agent/archivist/tts/...
    metadata:  { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, required: true },            // set via Clock port, not Date.now
  },
  { collection: 'turns', minimize: false, strict: true },
);

// recent/latest/before-id pagination relies on (worldId, seq) ordering
TurnSchema.index({ worldId: 1, seq: 1 });
TurnSchema.index({ sceneId: 1 });
// optimistic guard for append-only: no schema-level immutability, enforced in repo (§4.4)

export const TurnModel = model('Turn', TurnSchema);
```

**`characters` — the heavily-mutated entity.**

```ts
// infrastructure/persistence/mongo/models/character.model.ts
const DailyLoopSchema = new Schema({ /* mirrors DailyLoopSchema in daily-loop.ts */ }, { _id: false });

const CharacterSchema = new Schema(
  {
    worldId:        { type: Types.ObjectId, ref: 'World', required: true, index: true },
    name:           { type: String, required: true },
    nameKey:        { type: String, required: true },     // lower(name) — replaces functional unique idx
    description:    { type: String, default: '' },
    isPlayer:       { type: Boolean, default: false },
    currentPlaceId: { type: Types.ObjectId, ref: 'Place', default: null },
    inTransitToPlaceId: { type: Types.ObjectId, ref: 'Place', default: null },
    arrivalWorldTime: { type: String, default: null },
    status:         { type: String, enum: ['active', 'inactive', 'dead'], default: 'active' },
    agencyLevel:    { type: String, enum: ['npc','local','nearby','distant','dormant'], default: 'npc' },
    // append-only [t:N]-tagged free text — provenance is inside the string
    memorableFacts: { type: [String], default: [] },
    observations:   { type: [String], default: [] },
    aliases:        { type: [String], default: [] },
    traits:         { type: Schema.Types.Mixed, default: null }, // was traits_json
    dailyLoop:      { type: DailyLoopSchema, default: null },     // was daily_loop JSON
    appearanceCount:    { type: Number, default: 0 },
    lastSeenTurnSeq:    { type: Number, default: null },
    lastAgentTickTurnSeq: { type: Number, default: null },
    activeGoal: String, currentFocus: String, recentActivity: String,
    privateBeliefs: String, relationshipToPlayer: String, longTermAgenda: String,
    playerNotes:    String,                                 // correction-channel canon only
    updatedAt:      { type: Date, required: true },         // freshness proxy — see §4.6
    createdAt:      { type: Date, required: true },
  },
  { collection: 'characters', minimize: false },
);

// recreate UNIQUE characters_world_name (world_id, lower(name))
CharacterSchema.index({ worldId: 1, nameKey: 1 }, { unique: true });
export const CharacterModel = model('Character', CharacterSchema);
```

**`places` — entity with embedded `geo` and `profile` (the absorbed `place_profiles`).**

```ts
// infrastructure/persistence/mongo/models/place.model.ts
const GeoSchema = new Schema({
  displayName: String, street: String, neighborhood: String,
  lat: Number, lng: Number,
  status: { type: String, enum: ['unresolved','ok','not_found','unavailable'], default: 'unresolved' },
  resolvedAt: Date,
}, { _id: false });

const PlaceProfileSchema = new Schema({          // was place_profiles table (1:1)
  capacityMin: Number, capacityMax: Number,
  typicalRoles: { type: [String], default: [] }, openHours: { type: [String], default: [] },
  ambienceTags: { type: [String], default: [] }, matchTags: { type: [String], default: [] },
  encounterRules: { type: [Schema.Types.Mixed], default: [] },
  trafficLevel: { type: String, enum: ['none','low','medium','high','surge'], default: 'low' },
}, { _id: false });

const PlaceSchema = new Schema({
  worldId: { type: Types.ObjectId, ref: 'World', required: true, index: true },
  name: { type: String, required: true }, nameKey: { type: String, required: true },
  description: String, kind: String, playerNotes: String,
  geo: { type: GeoSchema, default: () => ({}) },
  profile: { type: PlaceProfileSchema, default: null },   // embedded, was a separate table
  updatedAt: { type: Date, required: true }, createdAt: { type: Date, required: true },
}, { collection: 'places', minimize: false });

PlaceSchema.index({ worldId: 1, nameKey: 1 }, { unique: true }); // was places_world_name
export const PlaceModel = model('Place', PlaceSchema);
```

The remaining 12 collections follow the same mechanical pattern (enums for CHECKs, `min:1/max:5` for `importance`, `min:0/max:1` for `intensity`/`reconciliation_confidence`, normalized `titleKey`/`nameKey` for the `story_*` `UNIQUE(world_id, lower(title|name))` constraints, and `{worldId,turnSeq,modelKey,voiceId,textHash}` unique for `tts_audio_cache`).

### 4.4 The append-only `turns` invariant under Mongo

SQLite enforces append-only by convention: `insertTurn` does `INSERT ... RETURNING`, rows are never `UPDATE`d or `DELETE`d, and the *sole* mutation is `turns.metadata` via `json_patch` (deep-merge) and `json_set` (additive into `$.tts.chars`). Mongo has no row-immutability primitive, so the invariant is enforced **in the `TurnRepository` adapter, not the model**. The repository exposes exactly three write operations and no general `update`/`replace`/`delete`:

```ts
// domain/ports/turn-repository.port.ts
export interface TurnRepository {
  insert(turn: NewTurn): Promise<PersistedTurn>;            // the only create
  mergeMetadata(seq: number, patch: AgentUsageBlock): Promise<void>; // deep-merge, mirrors json_patch
  incrementTtsChars(seq: number, chars: number): Promise<void>;      // additive, mirrors json_set $.tts.chars
  // reads:
  recent(worldId, limit): Promise<PersistedTurn[]>;
  before(worldId, seq, limit): Promise<PersistedTurn[]>;
  latestUserSeq(worldId): Promise<number | null>;
}
```

The two mutators must **deep-merge, never clobber** — multiple writers (archivist, TTS recorder, NPC reconciler) write disjoint keys into `metadata` and a naive `$set: { metadata }` would lose keys. Map directly to Mongo nested-path operators:

```ts
// mergeMetadata: deep-merge each agent block (narrator/classifier/npc_agent/archivist)
await TurnModel.updateOne(
  { seq },
  { $set: { 'metadata.archivist': block } },   // targeted path == json_patch of one agent key
);
// incrementTtsChars: additive, == json_set into $.tts.chars
await TurnModel.updateOne({ seq }, { $inc: { 'metadata.tts.chars': chars } });
```

`$set` on a leaf path and `$inc` on `metadata.tts.chars` are atomic and concurrency-safe; they reproduce the exact merge/additive semantics of `json_patch`/`json_set` without read-modify-write. Add a guard test (and optionally a `pre('updateOne')` hook) asserting that no write touches `content`, `role`, or `seq` after insert.

### 4.5 ID strategy: `_id: ObjectId` for documents, a monotone integer `seq` for turns

Use Mongo's native `_id: ObjectId` as the primary key for **every** collection (refs become `ObjectId`). **But the global-autoincrement `turns.id` is load-bearing in three ways that `ObjectId` cannot satisfy:**

1. Recent/latest/before-id pagination relies on a **strictly monotone, comparable integer** (`WHERE id < before`).
2. Per-world display turn numbers (`turn-numbers.ts:buildTurnNumberMap`) relabel ordered ids to 1-based positions at render time.
3. **`[t:N]` provenance tags are already persisted inside free text** (`memorable_facts`, `observations`, `recent_activity`) and reference these exact integers retroactively.

`ObjectId` is only *roughly* monotone (second-granularity timestamp + counter) and is not an integer, so it would break the persisted `[t:N]` strings. **Therefore keep a dedicated monotone integer `seq` on `turns`** (and reference it from other docs as `turnSeq` wherever SQLite stored a turn id FK — `opened_at_turn`, `closed_at_turn`, `source_turn_id`, `last_flared_turn_id`, etc.). Generate `seq` via a `counters` collection with an atomic findOneAndUpdate `$inc` allocated inside the turn-insert transaction:

```ts
const { value } = await CounterModel.findOneAndUpdate(
  { _id: 'turnSeq' }, { $inc: { value: 1 } },
  { upsert: true, returnDocument: 'after', session },
);
const seq = value.value; // global, monotone — preserves [t:N] semantics and id-range pagination
```

The migration (§4.9) seeds `counters.turnSeq` to `MAX(turns.id)` so new seqs continue past the existing range. Per-world display numbers stay **derived**, never stored (sort by `seq`, relabel) — do not denormalize.

### 4.6 Transactions / sessions — replacing `better-sqlite3`'s `db.transaction(fn)`

SQLite wraps multi-statement writes in `db.transaction(fn)()` (implicit BEGIN/COMMIT). The Mongo equivalent is a **session with `withTransaction`**, exposed through a `UnitOfWork` port so the application layer owns the boundary and the repositories stay dumb:

```ts
// domain/ports/unit-of-work.port.ts
export interface UnitOfWork { run<T>(work: (tx: TxContext) => Promise<T>): Promise<T>; }
// infra: mongo implementation
async run(work) {
  const session = await this.client.startSession();
  try { return await session.withTransaction(() => work({ session })); }
  finally { await session.endSession(); }
}
```

**Hard prerequisite: Mongo multi-document transactions require a replica set (or Atlas).** A single-node `mongod` cannot honor them — this is an infra deployment requirement, not a code detail. (On Railway, run Mongo as a single-node replica set, or use Atlas.)

The write paths that need a transaction map directly from the existing `db.transaction` call sites:

| Operation (SQLite call site) | Why atomic | Mongo session scope |
|---|---|---|
| `createWorld` (`worlds.ts:99`) | world+place+character+scene+counter seed | one `withTransaction` |
| `applyArchivistPatch` (`archivist.ts:1859`) | places→characters→scene→invariant→dossier, **ordering is load-bearing** | one `withTransaction` (multi-collection) |
| `recordAppearancesAndAutoPromote` (`npc-promotion.ts:74`) | batch tier writes | one `withTransaction` |
| reverie add/prune/**repoint** (`reveries.ts`) | repoint-**before**-delete or reveries are dropped | one `withTransaction`, preserve order |
| intent batch reconcile (`npc-intents.ts:202`) | attach+reconcile batch | one `withTransaction` |
| `tts` upsert+prune (`db.ts:582`) | insert then retention prune | one `withTransaction` |
| `insertTurn` + `seq` allocation | counter + turn must be atomic | one `withTransaction` |

Single-document writes (a lone character field set, a metadata merge, an append-only insert with a pre-allocated seq) are atomic in Mongo without a session and should **not** open one.

**The app-side prunes must port, not just the inserts.** `npc_reveries` (cap 3/NPC) and `place_occupancy_snapshots` (retention-by-turn-count) grow unbounded without their pruning code; the use case runs the prune inside the same `withTransaction` as the insert, exactly as SQLite did.

### 4.7 Where models live, the ports they implement, and the no-deciding-logic rule

```
packages/server/src/
  domain/
    ports/                # repository PORT interfaces (no Mongoose, no SDK)
      world-repository.port.ts, turn-repository.port.ts, character-repository.port.ts,
      place-repository.port.ts, scene-repository.port.ts, dossier-repository.port.ts,
      reverie-repository.port.ts, npc-intent-repository.port.ts, occupancy-repository.port.ts,
      tts-cache-repository.port.ts, correction-repository.port.ts, usage-repository.port.ts,
      unit-of-work.port.ts
    services/             # pure DECIDING logic, no I/O
      name-resolution.service.ts   # resolveCharacter/resolvePlace/mergeCharacters → returns a MergePlan
      patch-sanitizer.service.ts   # sanitizeArchivistPatch + transit normalization + transition invariant
      npc-promotion.service.ts, reverie-flare.service.ts, character-dedup.service.ts, ...
  infrastructure/
    persistence/mongo/
      connection.ts        # createConnection(DATABASE_URL); build-phase guard (replaces :memory:)
      models/              # the Mongoose schemas above — THE ONLY place 'mongoose' is imported
      repositories/        # *.mongo.repository.ts implementing the domain ports — dumb CRUD only
      mongo-unit-of-work.ts
  composition/             # the only place repos meet use cases
```

**The repositories are dumb CRUD.** This is the single most important constraint and it directly fixes the "largest leak" finding from §1. Today `archivist.ts`'s `resolveCharacter`/`mergeCharacters`/`mergePlaces` **read all rows, decide, then write inside one transaction** — a deciding concern leaked into the data layer. Under the target:

- `NameResolution` (pure domain service) takes the loaded rows + the patch and **returns a `MergePlan`** (`{ canonicalId, mergeOps, aliasUpdates, sceneOpenIntents }`) — it issues no writes.
- The `AdvanceTurn` / `ApplyCorrection` use case calls the service, then hands the flat `MergePlan` to `CharacterRepository.applyMerge(plan, tx)` / `SceneRepository.open(intent, tx)` inside one `UnitOfWork.run`.
- `freshest-field-wins` (relies on `updatedAt` as the freshness proxy) stays in the pure service; the repo just persists the chosen fields and the `updatedAt` the service computed (via the Clock port, replacing `datetime('now')`/`new Date()`).

A `merge`, `lower(name)` resolution, `reveals_name_of` rename, or scene-open-on-move branch appearing inside a `*.mongo.repository.ts` is a CI failure. The wall-clock `datetime('now')` embedded in ~6 files' SQL is replaced by a `Clock` port the use case passes into the service; repositories receive concrete `Date` values and never call the clock.

### 4.8 Embeddings / pgvector — explicitly Phase-2

The blueprint and `memory-architecture.md` assume **pgvector** (HNSW cosine over a `memory_chunks` table). **No embeddings provider is wired today** (no Voyage usage anywhere in `src/`), and `memory_chunks` does not exist in the shipped SQLite schema — so this is net-new, not a migration. Defer it:

- The Mongo equivalent of pgvector is **Atlas Vector Search** (`$vectorSearch` on a `memory_chunks` collection with a vector index), or a separate vector store (e.g. Qdrant) behind the same port if the deployment is self-hosted single-node Mongo without Atlas.
- Define the `MemoryRepository.searchSimilar(worldId, embedding, k)` port now and ship a **no-op adapter that returns `[]`** — the context assembler already tolerates an empty P7 (graceful degradation, identical to the SQLite path). This keeps the port surface stable so the Atlas/Qdrant adapter drops in as a sibling later with a composition-root flip.
- Self-hosted single-node Mongo cannot do `$vectorSearch` (Atlas-only), and also cannot do the multi-doc transactions of §4.6 — both push the deployment toward **Atlas or a single-node replica set + external vector store**. Flag this as a deployment decision, not a code one.

### 4.9 One-off data migration: SQLite → Mongo

A single idempotent script (`packages/server/scripts/migrate-sqlite-to-mongo.ts`, run via `tsx`) reads the live `better-sqlite3` file and bulk-inserts. Order matters because of refs and the seq counter.

```ts
// packages/server/scripts/migrate-sqlite-to-mongo.ts
import Database from 'better-sqlite3';
import { connectMongo } from '../src/infrastructure/persistence/mongo/connection';
// ...models

const sqlite = new Database(process.env.DATABASE_PATH!, { readonly: true });
await connectMongo(process.env.DATABASE_URL!);

// 1. Build an integer-id → ObjectId map per table FIRST (worlds, places, scenes, characters,
//    threads...), so FK columns can be rewritten to ObjectId refs on insert.
const idMap = { world: new Map<number, ObjectId>(), place: new Map(), scene: new Map(),
                character: new Map(), thread: new Map() };

// 2. Insert parents before children: worlds → places → scenes → characters → story_* → turns
//    → npc_reveries/npc_intents/timeline/occupancy/tts/corrections.
for (const w of sqlite.prepare('SELECT * FROM worlds').all()) {
  const _id = new ObjectId();
  idMap.world.set(w.id, _id);
  await WorldModel.create({
    _id, name: w.name, premise: w.premise,
    initialState: JSON.parse(w.initial_state_json ?? '{}'),   // TEXT-JSON → BSON
    worldTime: w.world_time, settingRegion: w.setting_region,
    currentSceneId: null,                                     // patched after scenes load
    archivedAt: w.archived_at ? new Date(w.archived_at) : null,
    createdAt: new Date(w.created_at),
  });
}

// 3. turns: PRESERVE the integer as `seq` (do NOT renumber — [t:N] tags depend on it).
const turns = sqlite.prepare('SELECT * FROM turns ORDER BY id').all();
await TurnModel.insertMany(turns.map(t => ({
  seq: t.id,                                                  // keep the global integer verbatim
  worldId: idMap.world.get(t.world_id),
  role: t.role, content: t.content,
  sceneId: t.scene_id ? idMap.scene.get(t.scene_id) : null,
  metadata: t.metadata ? JSON.parse(t.metadata) : {},        // nested per-agent shape preserved as-is
  createdAt: new Date(t.created_at),
})), { ordered: false });

// 4. Seed the seq counter so new inserts continue past the existing range.
const maxId = sqlite.prepare('SELECT MAX(id) AS m FROM turns').get().m ?? 0;
await CounterModel.updateOne({ _id: 'turnSeq' }, { $set: { value: maxId } }, { upsert: true });

// 5. tts_audio_cache: BLOB → BSON Binary (or GridFS if >16MB).
//    occupancy_json / daily_loop / traits_json / applied_patch → JSON.parse into native subdocs.
//    place_profiles rows → fold into the matching places doc's `profile` subdoc.
//    Derive nameKey/titleKey = lower(name|title) on insert (replaces functional unique indexes).

// 6. AFTER all collections inserted: createIndexes() to build the unique indexes
//    (so duplicate-key violations surface as a hard failure, validating the migration).
```

Migration discipline (from user memory `feedback_sqlite_transactions`): **back up the SQLite file first**, run against a copy, and `createIndexes()` *after* bulk insert so any latent duplicate that SQLite's `UNIQUE(world_id, lower(name))` was silently preventing surfaces as a `E11000` and is reconciled rather than silently producing dual rows. The hand-rolled `runMigrations`/`PRAGMA user_version` machinery has **no Mongo analog** — schema versioning becomes either a no-op or a lightweight `schema_versions` collection; index creation on connect (`connection.ts`) replaces the migration runner.

**Build-phase guard:** the SQLite adapter swaps to `:memory:` when `NEXT_PHASE === 'phase-production-build'` to avoid touching the volume during the Next build. The Mongo `connection.ts` needs the equivalent guard — skip connecting (or connect to an in-memory `mongodb-memory-server`) during the build phase so static page-data collection doesn't reach a live cluster.

## 5. Migration Plan, Testing & Risks

This is the riskiest section of the refactor: it bundles three orthogonal moves (Mongo swap, onion re-cut, monorepo split) onto a live app (v0.6.21 on Railway, real prod worlds). The governing principle is the blueprint's §10 discipline — **pure refactors first, capability changes last, every phase independently shippable and reversible.** We never run the Mongo swap and the god-file carve in the same PR.

### 5.1 Phased plan (P0–P7)

Each phase below leaves `npm run dev`, `npm run build`, `npm test`, and the live Railway deploy fully working. Phases P0–P1 and P4–P5 are pure refactors (zero behavior change, green tests). P2–P3 (Mongo) and P6 (split) are the capability/topology changes and are isolated behind flags or new packages.

| Phase | Goal | Behavior change? | Shippable on its own? |
|---|---|---|---|
| P0 | Monorepo skeleton + workspaces, no logic moved | No | Yes |
| P1 | Repository ports over existing SQLite (strangler-fig) | No | Yes |
| P2 | Mongo + Mongoose adapters implementing same ports, behind flag | No (flag off) | Yes |
| P3 | Backfill + dual-read verify + cutover | Storage only | Yes |
| P4 | Carve domain services out of `archivist.ts`/`world-state.ts` | No | Yes |
| P5 | Thin `chat/route.ts` into `AdvanceTurn` use case | No | Yes |
| P6 | Extract client into `apps/web` + `packages/contracts` | Topology | Yes |
| P7 | CI import-boundary enforcement + delete SQLite adapter | No | Yes |

#### P0 — Monorepo skeleton, no logic moves

Stand up npm workspaces (not pnpm/turbo — `better-sqlite3` native build + Railway nixpacks are simplest on npm's flat hoisting; the lockfile already exists). Move the entire current app under `packages/server` essentially verbatim, keep the single `@/*` alias pointing at `packages/server/src/*`. Add a `tsconfig.base.json` the package extends.

- Root `package.json`: `"workspaces": ["packages/*", "apps/*"]`, `private: true`.
- `packages/server/` gets today's `src/`, `tests/`, `prompts/`, `next.config.ts`, `vitest.config.ts`.
- Resolve the cwd coupling now (`src/lib/prompt-files.ts` `readFileSync(process.cwd()/prompts)`, `src/lib/db.ts` `DATABASE_PATH ?? cwd/chronicles.sqlite`): switch to module-relative resolution via `import.meta.url` so the process can start from any package dir. This is a prerequisite for everything after.
- Keep `serverExternalPackages: ['better-sqlite3']` in the server's `next.config.ts`.
- Decide the version-bump home: the header at `src/app/page.tsx` reads `pkg.version`. After P6 that file lives in `apps/web`; until then it reads `packages/server/package.json`. Document which package's version is the prod trust signal.

**Exit:** `npm run build && npm test` green from repo root via workspace scripts. Railway still builds the one service (now rooted at `packages/server`).

#### P1 — Repository ports over SQLite (strangler-fig)

This is the highest-leverage, lowest-risk phase and must precede Mongo. Today `src/lib/db.ts` is imported by ~23 modules in two patterns (`import { db }` raw handle + named-function imports). Define ports in `packages/server/src/domain/ports/` and a single SQLite implementation in `packages/server/src/infrastructure/persistence/sqlite/`.

Port surface (one per aggregate, from the map):

```
domain/ports/
  WorldRepository.ts        TurnRepository.ts        CharacterRepository.ts
  PlaceRepository.ts        SceneRepository.ts       DossierRepository.ts
  ReverieRepository.ts      NpcIntentRepository.ts   OccupancyRepository.ts
  TtsCacheRepository.ts     CorrectionRepository.ts  UsageRepository.ts
  UnitOfWork.ts             Clock.ts                 Logger.ts
```

Critical port-shape rules (enforce now so Mongo drops in cleanly later):

- **`TurnRepository` is append-only**: `insert(...)`, `recentTurns`, `turnsBefore`, `latestUserTurnId`, plus a single `mergeMetadata(turnId, agentKey, block)` and `incTtsChars(turnId, n)` — never a general `update`. This mirrors the `json_patch`/`json_set` semantics in `db.ts:206/214` (deep-merge per agent key, additive `$inc` for `tts.chars`). Do **not** expose a clobbering `setMetadata`.
- **Repositories are dumb CRUD.** The deciding logic still living inside `archivist.ts` (`resolveCharacter`/`mergePlaces`/`charactersMatch`/freshest-field-wins) and `npc-promotion.ts` stays put for now — P1 only wraps the *SQL*. Don't try to extract decisions in the same PR (that's P4).
- Add a `Clock` port and route the ~6 files' `datetime('now')` reads through a `clock.now()` the use case passes down. SQLite adapter can still write `datetime('now')` server-side initially; the point is the *interface* exists so Mongo writes get a deterministic timestamp.

Mechanically: replace `import { db }` callsites one module at a time, each its own PR, each green. `cost-cap.ts`'s `SUM(json_extract(...))` becomes `UsageRepository.todaysTokenTotal(clock.today())`; keep the SQL inside the adapter. Wire everything in a new `packages/server/src/composition/container.ts`.

**Exit:** zero `import ... from '@/lib/db'` outside `infrastructure/persistence/sqlite/`. Add a temporary guard test grepping for that import.

#### P2 — Mongo + Mongoose adapter behind a flag

Implement the *same* ports in `infrastructure/persistence/mongo/` with Mongoose models (the schemas designed in §4). Selection via env in the composition root: `PERSISTENCE=sqlite|mongo` (default `sqlite`). Nothing else in the codebase knows which is live.

The collection map, ID strategy, append-only invariant, unique-index translation, CHECK→enum mapping, `UnitOfWork`/replica-set requirement, prune-logic port, and build-phase guard are all specified in §4 (see §4.2–§4.7). The hard requirements for P2 in brief:

- **Preserve a numeric monotone `seq` for turns** via a `counters` collection (§4.5) — never use `ObjectId` as the ordering key; `[t:N]` provenance and per-world numbering depend on the integer.
- **Unique indexes** replace SQLite's `lower(name)` functional uniques via a normalized `nameKey`/`titleKey` field (§4.3).
- **CHECK constraints** become Mongoose `enum`/`min`/`max` plus domain validation (§3.6, §4.3) — Mongo enforces neither at storage.
- **`UnitOfWork` → `session.withTransaction`** which **requires a replica set** (§4.6). Provision Atlas or a single-node RS; flag as an infra prerequisite.
- **Prune logic ports, not just inserts** (`npc_reveries` cap 3, occupancy retention — §4.6).
- **Build-phase guard** mirroring the `NEXT_PHASE` `:memory:` dodge (§4.9).

**Exit:** full Vitest suite passes against the Mongo adapter (§5.2) with `PERSISTENCE=mongo`; prod still runs `sqlite`.

#### P3 — Backfill, dual-read verify, cutover

Per CLAUDE.md's data-repair rule: **back up first, always.** `railway ssh` into the prod container, copy `/data/chronicles.sqlite` (+ `-wal`/`-shm`) to `backups/` locally before any migration.

1. **Backfill script** `packages/server/scripts/migrate-sqlite-to-mongo.ts` (§4.9): open the SQLite snapshot read-only, stream every table into the Mongo collections via the P2 repositories (reuse the same write path — don't hand-roll inserts). Preserve integer `turns.id` → `seq`, set `counters.turns.seq = MAX(id)`. Compute `nameKey`/`titleKey` during copy.
2. **Dual-read verification** (not dual-write — too risky on a live append-only store): a `verify-parity.ts` script reads both stores and asserts row counts per collection, turn id continuity, `MAX(seq)` parity, and a sampled deep-equal on N random turns/characters/world-state assemblies (`getFullWorldState` from both must match). Run it against the prod snapshot until clean.
3. **Cutover** during a quiet window: take a fresh backup, run a final incremental backfill (only `turns` with `id >` last backfilled — turns are append-only so this is a tail copy), flip `PERSISTENCE=mongo` on Railway, redeploy. Watch `/api/usage` and a smoke turn end-to-end in the browser (CLAUDE.md "done" definition for a streamed turn).
4. **Rollback:** flip the env var back to `sqlite` and redeploy. The SQLite volume is untouched during cutover (Mongo write path is separate), so rollback is a single redeploy. Keep the SQLite adapter until P7 specifically to preserve this escape hatch.

#### P4 — Carve domain services out of the god files

Now pure-refactor the deciding logic flagged as leaked in §1.3–§1.4. `archivist.ts` (2223 LOC) and `world-state.ts` are the targets. Extract into `domain/services/`:

| New domain service | Extracted from | Behavior |
|---|---|---|
| `NameResolution` | `archivist.ts` `resolveCharacter`/`mergeCharacters`/`runAliasMerges`/`placesMatch`/`mergePlaces`/`charactersMatch`/`freshest`/`chooseLonger` | Takes row set + patch, **returns a merge plan** (canonical id + merge ops + alias updates) — does not issue SQL |
| `PatchSanitizer` | `sanitizeArchivistPatch` + transition guards + `normalizeTransitPlaceName` + `extractDeterministicPatch` | pure |
| `SceneTransition` | the `archivist.ts:2048-2157` invariant | returns scene-open/close *intents*, not UPDATEs |
| `NpcPromotion` | `npc-promotion.ts` tiering rules | decide tiers from a snapshot, return write commands |
| `ReverieFlare`, `OccupancySim`, `ActionClassifierRules`, `WorldClock`, `CharacterDedup`, `MemorableFactProvenance`, `StorySignal` | the already-pure functions across `reveries.ts`/`place-population.ts`/`classifier.ts`/`world-time.ts`/`character-dedup.ts`/`memorable-facts.ts`/`story-signal.ts` | drop-in move, no behavior change |

The narrator-markdown renderers (`formatStateBlock`/`formatDossierBlock`/`formatNarratorTurnGuidance`) are a **rendering** concern → move beside the LLM adapter (`server/render`), not into the domain. Consolidate the seven duplicated `claude-haiku-4-5-20251001` consts + `NARRATOR_MODEL='grok-4.3'` (duplicated in `route.ts:51` and `opening-turn.ts:10`) + `pricing.ts` into one `infrastructure/llm/model-registry.ts`.

**Do this behind tests written first** (see §5.2) — `applyArchivistPatch`'s ordering is load-bearing and has documented prod-bug history (Call-In Case turn 403, world 13 teleport). The watch item: making `resolveCharacter` pure changes its contract (it currently merges as a side-effect of a read); the use case must now explicitly apply the returned plan or duplicates leak.

**Generalize the overfit** (`player-profile.ts`/`narrator-guidance.ts` hardcode `minerva`/`caesar`/`maya`/`usace`): this is a *behavior change*, so do it as its own PR, not folded into the pure move.

#### P5 — Thin `chat/route.ts` into `AdvanceTurn`

Carve the 593-line god endpoint into `application/use-cases/AdvanceTurn.ts`. Per the blueprint, `AdvanceTurn.execute({worldId, playerText})` returns a `NarrationStream { chunks, completion }` value — **not** a framework `onFinish` callback. The route becomes a thin adapter: parse `messages[]`→`playerText`, call the use case, pipe `chunks` into `createUIMessageStreamResponse`, and append the `dbTurnId` metadata part after `completion` resolves (preserving the flush-after-onFinish ordering invariant the client depends on).

- The ~20 captured `onFinish` closure variables become explicit `AdvanceTurn` state.
- Pre-stream gates (meta-command, retry/replay dedup, daily cost cap, classify) and post-stream fail-open work (reconciler, archivist patch, promotion, dedup) move into the use case, owning the two transaction boundaries.
- **Preserve best-effort semantics.** Many failures are intentionally swallowed (`console.error` + continue) — do not convert these to domain errors. Only the fail-closed gates (world-not-found→404, empty-action→400, budget→429) become domain errors mapped at the route edge.
- SIGTERM in-flight-archivist draining moves to a `BackgroundTasks` port in composition root; the use case returns the archivist promise, infra tracks it.

Repeat the thin-adapter treatment for the other routes (`world-correction`→`ApplyCorrection`, `turns`→`LoadHistory`, etc.) — each its own small PR.

#### P6 — Extract client into `apps/web` + `packages/contracts`

Now the layering is clean, draw the package boundary along the already-`[ESSENTIAL]` HTTP API surface (the `/api/*` routes are pre-drawn seams).

- `apps/web/`: Next.js, React, Tailwind, `@ai-sdk/react`. Contains `Chat.tsx`, `WorldInspector.tsx`, `useNarratorAudio.ts`, pages. **No onion imports** from `'use client'` components (§2.4).
- `packages/contracts/`: framework-free DTOs + Zod schemas both sides agree on — `WorldStateDTO` (was `FullWorldState`), `TurnCostDTO`/`AgentCostDTO`/`TtsCostDTO`, `CorrectionDTO`, `OlderResponseDTO`, chat message metadata, and **`sentence-splitter.ts`** (the chunk boundary must be byte-identical client/server for TTS cache hits — shared, pure, no I/O). Full contents in §2.6.
- Move cost/pricing fully server-side: `pricing.ts` model IDs + rates are infra and must not ship in the client bundle. Server sends pre-computed `TurnCostDTO`s; client keeps only `formatUsd`-style presentation.
- Move render-only domain (`deriveCharacterBadges`/`deriveSceneBadge`, `organizePlayerProfileFacts`, `parseStateEntry` provenance strip) **server-side** so the DTO ships badges/groups/parsed text ready to render — keeps the client free of domain logic.
- The two Server Components reading SQL directly (`play/page.tsx`, `page.tsx`) and the Server Actions (`worlds/new/actions.ts` `createAndOpenWorld`) must become HTTP calls against server endpoints (a decoupled client can't invoke Next Server Actions across a package boundary). Add explicit `POST /api/worlds` etc.
- Railway topology: single service (web imports server in-process, topology A of §2.2); with Mongo the SQLite volume disappears in favor of `DATABASE_URL`.

#### P7 — Enforce boundaries in CI, delete SQLite

Add `dependency-cruiser` (net-new — it does not exist today despite CLAUDE.md implying it; full ruleset in §2.5 and §3.7). Rules:

- `domain/` may not import `infrastructure`/`application`/`next`/`ai`/`@ai-sdk/*`/`mongoose`/`fs`/wall-clock.
- `application/` imports only `domain/`.
- Only `composition/` imports `infrastructure/`.
- `mongoose` forbidden outside `infrastructure/persistence/mongo/`.
- `apps/web` (`'use client'` tree) may import **only** `packages/contracts`.

Keep the grep guard tests (model-ID literal outside `infrastructure/llm/`, merge logic under `infrastructure/`). Once Mongo has run clean in prod for a sustained window, delete the SQLite adapter, `migrations.ts`, and the `better-sqlite3` dep. Drop `serverExternalPackages: ['better-sqlite3']`.

### 5.2 Testing strategy per layer

The payoff of the refactor is that the bulk of the suite becomes fast and I/O-free.

- **Pure domain (P4 output) — fast unit tests, no DB.** `NameResolution`, `PatchSanitizer`, `SceneTransition`, `ReverieFlare`, `OccupancySim` (deterministic PRNG — golden-value tests), `NpcPromotion`, `ActionClassifierRules`, `WorldClock`, `CharacterDedup`. These take row arrays and return plans/values — trivially testable, no mocks. Several already exist as pure-function tests and migrate unchanged. **Write characterization tests for `NameResolution`/`SceneTransition`/`applyArchivistPatch` ordering *before* the P4 extraction** (golden patches → expected merge plans), seeded from the known prod-bug scenarios.
- **Use cases (P5) — fake repositories.** `AdvanceTurn`/`ApplyCorrection` tested against in-memory port doubles (a `FakeTurnRepository` Map-backed impl + `FakeClock`). LLM ports stubbed to return fixed `ArchivistPatch`/classification. This is where fail-open vs fail-closed semantics get asserted (e.g. archivist throwing → turn still persists).
- **Infra (P2) — real Mongo.** Use `mongodb-memory-server` for fast local/CI runs **but start it as a replica set** (`MongoMemoryReplSet`) so `UnitOfWork`/transactions actually exercise — a single-node memory server will silently no-op transactions and hide the replica-set requirement until prod. Test unique-index enforcement, the `counters` seq monotonicity, metadata merge (`$set` on nested paths, not clobber), `$inc` for tts.chars, and prune logic.
- **Existing Vitest migration.** All 34 tests are server-side; they move with `packages/server`. The 4 tests that open their own `better-sqlite3` (`archivist`, `call-in-replay`, `place-population`, `migrations`) get rewritten against the Mongo memory RS — except `migrations.test.ts` (synthetic SQLite v4 state) which is **deleted** post-Mongo, replaced by an index-setup test. `chat-route-parsing` becomes an `AdvanceTurn`/route-adapter test. Repoint `vitest.config.ts` `tsconfigPaths` to the server tsconfig; keep the in-memory DB env.

### 5.3 Risk table

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mongo multi-doc transactions need a replica set; single-node mongod silently can't honor `UnitOfWork` atomicity | High | High (partial commits = corrupt world state, the exact `BEGIN IMMEDIATE` hazard in user memory) | Provision Atlas or single-node RS in P2; test with `MongoMemoryReplSet`; fail-fast at boot if `rs.status()` shows no RS |
| Losing SQLite's synchronous simplicity — every `db.prepare(...).get()` becomes `await` | High | Medium (broad diff; sync call sites in pure-ish code) | The port extraction in P1 already makes every data access go through an interface; define ports as `async` from day one even on the sync SQLite adapter (wrap in `Promise.resolve`) so P2 is a no-op signature-wise |
| Append-only / turn-number races — concurrent inserts on the global `seq` counter | Medium | High (`[t:N]` provenance + per-world numbering break retroactively) | Atomic `findOneAndUpdate $inc` on `counters`; never derive seq from `count()`; keep numbers *derived* at render (`turn-numbers.ts`) not stored |
| Streaming endpoint regression — `dbTurnId` trailing-metadata depends on flush-after-onFinish ordering | Medium | High (silently breaks TTS caching + per-turn cost on client) | `AdvanceTurn` returns `{chunks, completion}`; route appends metadata after `completion` resolves; add an integration test asserting the metadata part arrives last |
| Scope creep — Mongo swap + onion carve + split done together | High | High (multiplied blast radius, hard rollback) | Enforce phase isolation: P1/P4/P5 are pure (green tests, no flag), P2/P3 storage-only (flag), P6 topology-only. Never two in one PR. Blueprint §10 discipline is the gate |
| Backfill data loss / mismatch on prod cutover | Medium | High | Backup `/data/chronicles.sqlite` before anything (CLAUDE.md rule); dual-read parity script must be clean; keep SQLite adapter through P7 so rollback = one env flip + redeploy |
| Bundle leak — no `server-only` guard; a `import type`→value change pulls `better-sqlite3`/`mongoose` into client | High during P6 | High (broken deploy build) | Add `import "server-only"` to all infra/repo modules in P1; `packages/contracts` is the only thing `apps/web`'s `'use client'` tree may import; dependency-cruiser rule in P7 |
| CHECK-constraint loss in Mongo (enums, ranges) silently accepts bad data | Medium | Medium | Mongoose `enum`/`min`/`max` + domain validation in `PatchSanitizer`; tested in P2 infra suite |
| Cost undercount — `json_extract` paths/pricing keys reimplemented for Mongo aggregation, drift on model swap | Medium | Medium (silent budget overrun) | Single `model-registry.ts` + `UsageRepository.todaysTokenTotal`; one `summarizeTurn` reader; test parity against SQLite during P3 |

### 5.4 Effort & sequencing

- **Strict serial spine:** P0 → P1 → P2 → P3, and P4 → P5 must follow P1. P2/P3 depend only on P1's ports, **not** on P4/P5 — so the Mongo track and the god-file carve track **can run in parallel** after P1 (different files: `infrastructure/persistence/mongo/` vs `domain/services/` + `application/`). This is the main parallelization win; assign two engineers.
- **P1 is the linchpin and the biggest mechanical lift** (~23 importers, two import patterns). Stage it as a codemod, one module per PR, gated on `type-check` + `vitest`. Budget the most time here.
- **P4 is the riskiest pure refactor** (`archivist.ts` ordering, prod-bug history) — gate behind characterization tests written first; do not parallelize the `NameResolution`/`SceneTransition` extraction with anything touching the same patch path.
- **P6 depends on P5** (clean use cases) and P4 (server-side renderers) but not on the Mongo cutover — it can land before or after P3 since it's topology, not storage.
- **Smallest independent wins to ship first for momentum:** the already-pure moves in P4 (`ReverieFlare`, `WorldClock`, `OccupancySim`, `CharacterDedup`) and the `model-registry.ts` consolidation — zero risk, immediate boundary improvement.
- Per-phase exit criterion is non-negotiable and identical to CLAUDE.md's "done": a turn streams end-to-end in the browser, `npm run build`/`type-check`/`test` green, and (P3+) the version header on `/` matches `package.json` on the release branch.

## Open Questions & Decisions for the Author

These are the genuine forks where the right answer depends on Andrew's preference, budget, or operational constraints — not technical defaults the plan already resolved. Each has a recommendation, but warrants an explicit call.

1. **Topology: in-process Next route handlers vs. a standalone server service.** §2.2 recommends **A** (Next route handlers in `apps/web` import `@chronicles/server` in-process — one Railway service, no extra proxy hop in front of the narrator stream). **B** (a separate Hono/Express/Nest API service) is only worth the second deploy unit if the client will later ship to a CDN/static host. *Decision: confirm A unless a CDN-hosted client is on the roadmap.*

2. **MongoDB hosting: Atlas vs. self-hosted on Railway.** This is the highest-stakes decision and it is operational, not code. **Multi-document transactions (`UnitOfWork`) require a replica set**, and **`$vectorSearch` for the Phase-2 embeddings store is Atlas-only.** A self-hosted single-node `mongod` on Railway can't do either. Options: (a) **Atlas** — transactions + vector search out of the box, external dependency + cost; (b) **Railway single-node replica set** — transactions work (`rs.initiate()`), but no `$vectorSearch`, so embeddings need an external vector store; (c) **Railway Mongo plugin** — verify it provisions a replica set, not a bare node. *Decision needed before P2. Recommendation leans Atlas if the Phase-2 memory/retrieval feature is on the horizon.*

3. **Embeddings store choice (Phase-2, but the port shape is decided now).** If MongoDB hosting lands on Atlas, `$vectorSearch` on a `memory_chunks` collection is the natural fit. If self-hosted, a sibling vector store (Qdrant, or pgvector retained as a side service) sits behind the same `MemoryRepository.searchSimilar` port. The port + no-op adapter ship now regardless; *the concrete adapter choice can wait, but it is coupled to decision #2.*

4. **Workspace tooling: confirm npm workspaces; when (if ever) to add Turborepo.** §2.1 recommends **npm workspaces** (zero lockfile migration, clean native-addon rebuilds on Railway). Turborepo is deferred — it layers on top later with no re-tooling if CI build caching ever hurts. *Decision: confirm npm; revisit Turborepo only if CI times become painful.*

5. **God-file carve-up aggressiveness — how far to push `archivist.ts` in one pass.** The 2223-line `archivist.ts` has documented prod-bug history (Call-In Case turn 403, world 13 teleport) and load-bearing transaction ordering. The plan gates the 5-way split behind characterization tests written first (P4). *Decision: how aggressive — split all five concerns in one P4 sweep, or land `PatchSanitizer`/`SceneTransition` (lower-risk, already-pure-ish) first and defer the `NameResolution` merge-plan extraction to a separate hardening pass? Recommendation: stage it; do not extract the merge path and the scene path in the same PR.*

6. **Version-of-record for the UI header post-split.** After P6, `page.tsx` lives in `apps/web`, so the trust-signal header reads `apps/web/package.json`'s version, not `packages/server`'s. *Decision: declare `apps/web` the version-of-record and keep the bump discipline there, OR add a CI assertion that `apps/web` and `packages/server` versions match. Pick one before P6 or the header silently desyncs from deployed code.*

7. **Overfit-data generalization timing.** `player-profile.ts` and `narrator-guidance.ts` hardcode specific prod worlds (`minerva`/`caesar`/`maya`/`usace`). Moving them into pure `domain/services/` as-is enshrines world-specific data in pure code. This is a *behavior change*, explicitly carved out of the pure-move PRs. *Decision: generalize during the refactor (own PR), or accept the enshrined constants as tech debt and defer? Recommendation: defer to a dedicated PR so it never rides a "no behavior change" refactor.*

8. **Dual-read verification depth before cutover (P3).** The parity script samples N random turns/characters/world-state assemblies. *Decision: what N / what coverage is "clean enough" to flip `PERSISTENCE=mongo` in prod — full table-scan deep-equal, or a sampled subset plus count/continuity checks? Higher confidence vs. longer verification window during the quiet cutover.*
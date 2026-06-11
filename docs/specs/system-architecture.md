# System Architecture

> **Status (branch `onion-arch-refactor`, 2026-06-08).** This document describes the
> post-refactor reality: an npm-workspaces monorepo whose runtime code is organized as
> a **hexagonal / onion architecture** (domain → application → infrastructure, wired in a
> composition root). The architecture below is real and merged on the branch, but it is a
> **preview branch that may be discarded**, and two things are deliberately not done yet:
> (a) the MongoDB production cutover (adapter code + backfill scripts exist; flipping
> `PERSISTENCE=mongo` in production is a manual gate), and (b) deletion of the SQLite
> adapter (waits for a Mongo soak). The planned `apps/web` client split also has **not**
> happened — the client still lives inside `packages/server`; the root `workspaces` glob
> lists `apps/*`, but `apps/` is empty. Where this doc still says "Postgres/Drizzle/pgvector"
> in a corner, read it as the *superseded* target.

## 1. System Overview

Chronicles AI is an AI-powered interactive novel engine built on a multi-agent architecture. The system accepts player input (text), orchestrates multiple specialized AI agents to generate narrative responses, and persists all world state to a structured database. The architecture is designed to scale from single-player local development to asynchronous multiplayer with shared persistent worlds.

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Story Feed   │  │  Story Input  │  │ Optional Knowledge│  │
│  │  (narrative   │  │  (text/voice) │  │ Surface (deferred)│  │
│  │   display)    │  │              │  │                   │  │
│  └───────┬──────┘  └──────┬───────┘  └───────────────────┘  │
│         │                 │                                   │
│         │   Token Stream  │   POST /api/chat                  │
└─────────┼─────────────────┼──────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                     NEXT.JS SERVER                           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  API / Server Actions                  │   │
│  │  Route Handlers (streaming)  │  Server Actions (CRUD) │   │
│  └──────────────┬───────────────┴────────────────────────┘   │
│                 │                                             │
│  ┌──────────────▼───────────────────────────────────────┐   │
│  │               STORY FLOW PIPELINE                     │   │
│  │                                                       │   │
│  │  1. Input ──► 2. Retrieval ──► 3. Conductor Decision  │   │
│  │                                       │               │   │
│  │  6. Persist ◄── 5. Extraction ◄── 4. Narration       │   │
│  └──────────────────────────────────────────────────────┘   │
│                 │                                             │
│  ┌──────────────▼───────────────────────────────────────┐   │
│  │                   AGENT SYSTEM                        │   │
│  │                                                       │   │
│  │  ┌─────────────┐  ┌────────────┐  ┌──────────────┐  │   │
│  │  │  Narrator    │  │  Character │  │   Archivist  │  │   │
│  │  │  Agent       │  │  Actor     │  │   Agent      │  │   │
│  │  │  (Grok 4.3)  │  │  (Grok)    │  │   (Haiku)    │  │   │
│  │  └──────────────┘  └────────────┘  └──────────────┘  │   │
│  │         ▲                                             │   │
│  │         │          ┌────────────┐                     │   │
│  │         └──────────│  Story     │                     │   │
│  │                    │  Conductor │                     │   │
│  │                    │  (Haiku)   │                     │   │
│  │                    └────────────┘                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                 │                                             │
│  ┌──────────────▼───────────────────────────────────────┐   │
│  │              MEMORY / RETRIEVAL LAYER                 │   │
│  │                                                       │   │
│  │  ┌─────────────┐  ┌────────────┐  ┌──────────────┐  │   │
│  │  │  Context     │  │  Embedding │  │  Retrieval   │  │   │
│  │  │  Assembler   │  │  Pipeline  │  │  Engine      │  │   │
│  │  └──────────────┘  └────────────┘  └──────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                 │                                             │
└─────────────────┼────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              DATA LAYER (behind repository ports)            │
│                                                              │
│  ┌──────────────────────┐    ┌───────────────────────────┐  │
│  │  SQLite (LIVE)        │    │  MongoDB (READY, gated)    │  │
│  │  better-sqlite3, raw  │    │  Mongoose, PERSISTENCE=    │  │
│  │  migrations on boot   │    │  mongo (not cut over)      │  │
│  │                       │    │                            │  │
│  │  worlds               │    │  same logical schema:      │  │
│  │  characters           │    │  15 collections + 2        │  │
│  │  places / scenes      │    │  embedded subdocs          │  │
│  │  turns (append-only)  │    │  counters → monotone int   │  │
│  │  dossiers / reveries  │    │  ids + turn seq            │  │
│  │  occupancy / intents  │    │  (ordering never on        │  │
│  │  corrections / usage  │    │  ObjectId)                 │  │
│  │  tts_cache / memory   │    └───────────────────────────┘  │
│  └──────────────────────┘                                   │
│   Both adapter sets satisfy the SAME ports; nothing above   │
│   infrastructure/ knows which store is live.                │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Voyage AI (External) — Phase-2 embedding slot,        │  │
│  │  unbuilt. MemoryRepository.searchSimilar() → [] today. │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 1.1 Repository Topology & Layering

The runtime is an **npm-workspaces monorepo**. The root `package.json` declares
`"workspaces": ["packages/*", "apps/*"]`, is `private`, carries `dependency-cruiser` as
its one root devDependency, and proxies every script to the server workspace
(`npm -w @chronicles/server run <x>`). A shared `tsconfig.base.json` (plus a
`tsconfig.depcruise.json` for the boundary linter) lives at the root.

Two published packages exist (`apps/*` is empty — the client split has not happened):

- **`packages/server` → `@chronicles/server`** — the Next.js 15 App Router application and
  **all runtime code**. Its `src/` is laid out as onion layers (below).
- **`packages/contracts` → `@chronicles/contracts`** — dependency-light shared Zod schemas
  (`chat`, `corrections`, `cost`, `history`, `world-state`) plus one pure util re-export
  (`./pure/sentence-splitter`, shared by the server TTS path and the client). `type: module`,
  depends on `zod` only.

Inside `packages/server/src/`, the **dependencies-point-inward** rule is physically realized:

- **`domain/`** — pure. Imports nothing outward (no `next`, `ai`, `@ai-sdk/*`,
  `better-sqlite3`, `fs`, `fetch`, or a wall-clock). Three sub-trees:
  - `domain/entities/` — entities and row TYPE definitions (`character`, `correction`,
    `npc-intent`, `occupancy`, `reverie`, `story`, `tts-cache`, `turn`, `usage`, `world`).
    The row types that used to live in `@/lib/db` moved here.
  - `domain/ports/` — 20 interfaces (+ index barrel). 13 repository ports (`world`, `turn`,
    `character`, `place`, `scene`, `dossier`, `reverie`, `npc-intent`, `occupancy`,
    `tts-cache`, `correction`, `usage`, `memory`) plus `clock`, `logger`, `narrator`,
    `speech-synthesizer`, `background-tasks`, and `unit-of-work`. **All repository methods are
    async** (return `Promise`); the SQLite adapters wrap synchronous calls in
    `Promise.resolve`. `TurnRepository` is **append-only** —
    `insert` / `recentTurns` / `turnsBefore` / `latestUserTurnId` plus `mergeMetadata` and
    `incTtsChars`; there is no general `update`/`setMetadata`.
  - `domain/services/` — the pure logic carved out of the old god files:
    `action-classifier-rules`, `character-dedup`, `memorable-fact-provenance`,
    `name-resolution`, `narrator-guidance`, `npc-promotion`, `occupancy-sim`,
    `patch-sanitizer`, `reverie-flare`, `scene-transition`, `story-signal`,
    `turn-numbering`, `world-clock`.
- **`application/use-cases/`** — orchestration only (imports `domain/`, never SQL/SDK/
  framework): `advance-turn`, `apply-correction`, `inspect-world`, `list-corrections`,
  `load-history`, `record-tts-usage`, `summarize-usage`, `synthesize-narration`.
- **`infrastructure/`** — driven adapters implementing the ports. **All model IDs and pricing
  live here** (`infrastructure/llm/model-registry.ts` + `pricing.ts`).
  - `persistence/sqlite/` — 13 `*.sqlite.ts` repositories + `unit-of-work.sqlite.ts`
    (raw `better-sqlite3`).
  - `persistence/mongo/` — the Mongoose adapter set (`connection`, `mongo-context`,
    `mongo-unit-of-work`, `build-mongo-repositories`, `models/` [the only mongoose-import
    home], `repositories/*.mongo.ts` + mappers, test-support).
  - `narrator/narrate-turn.ts` (NarratorPort → Grok narration stream),
    `tts/xai-speech-synthesizer.ts` (SpeechSynthesizer port), `clock/system-clock.ts`,
    `logging/console-logger.ts`, `background/process-background-tasks.ts` (BackgroundTasks
    port; SIGTERM drain).
- **`composition/container.ts`** — the **only** module that constructs concrete adapters
  (the dependency-injection root). It selects the store by the `PERSISTENCE` env var
  (default `sqlite`, a synchronous `getContainer()`; `mongo` is an async `initContainer()` at
  boot via dynamic import, so the SQLite path never loads mongoose) and exposes a typed
  `Container` of all ports. `server-only`.
- **`app/` (+ `pages/`), `components/`, `server/render/`** — driving adapters: Next.js
  routes/pages, React, and the server-side narrator-markdown renderer
  (`server/render/state-block.ts`).

The legacy `src/lib/` still exists mid-migration and is being drained; new logic goes in a
domain service or use case, and new persistence goes behind a repository port. These
boundaries are enforced in CI (see §6).

## 2. Core Components

### 2.1 Client Layer

The browser-based client is a Next.js App Router application serving as a Progressive Web App. It communicates with the server through two channels:

- **Server Actions** — for all CRUD mutations (creating worlds, updating characters, browsing wiki). These are direct RPC calls that bypass traditional REST routing.
- **Streaming route** — for narrator responses. A single Route Handler at `POST /api/chat` accepts player actions and returns a stream of narrator tokens. It is now a thin adapter over the `AdvanceTurn` use case (see §2.3), not the old god endpoint. Request/response shapes are the shared `@chronicles/contracts` Zod schemas. Cost/badge/profile values are derived **server-side** and sent to the client as DTOs — the client never receives raw rows.

The client renders three primary views:
1. **Story Feed** — scrolling narrative display showing the full turn history with live streaming of new narrator responses
2. **Story Input** — text input for player actions (voice input in Phase 6)
3. **Optional Knowledge Surface** — wiki pages, timeline, character sheets, story threads, and tactical state are queryable in Phase 2+ but visible UI is deferred until playtesting confirms it helps the conversation-first experience

### 2.2 Server Layer

The Next.js server handles routing, authentication (Phase 5), and orchestrates the story flow pipeline. The route handlers themselves are thin — the core business logic for agent orchestration, memory retrieval, and world-state management lives in the `application/` use cases and `domain/` services, not in the routes. Each route parses input, calls a use case, and pipes the result, owning no logic; domain errors (`WorldNotFound`, `ContextOverflowError`, …) are mapped to HTTP **only** in the route. The current route → use-case mapping:

| Route | Use case |
|-------|----------|
| `POST /api/chat` | `AdvanceTurn` (streaming; NarratorPort + NarrationStream, BackgroundTasks port for post-turn work, SIGTERM drain, an append-db-turn-id helper) |
| `/api/tts` | `SynthesizeNarration` |
| `/api/tts/record` | `RecordTtsUsage` |
| `/api/turns` | `LoadHistory` |
| `/api/usage` | `SummarizeUsage` |
| `/api/world-state` | `InspectWorld` |
| `/api/world-correction` | `ApplyCorrection` |
| `/api/world-corrections` | `ListCorrections` |

The old 593-line `src/app/api/chat/route.ts` god endpoint is gone; its responsibilities are now split across the use case, the NarratorPort adapter, and the BackgroundTasks adapter.

Key design principle: **Server Components for data fetching, Client Components for interactivity.** Pages that display world lists or wiki content are Server Components (fast, zero JS). The story play page wraps its interactive elements (feed, input) in Client Components.

### 2.3 Story Flow Pipeline

Every player turn triggers a seven-step pipeline. **Note on ordering:** The Conductor decides *whether* Living World advancement runs on a given turn (Phase 4+). The pipeline therefore runs Conductor first, then conditionally runs Living World, then re-fetches any state Living World mutated before assembling narrator context.

```
Step 1: INPUT
  Player submits text action
  ↓
Step 2: PRE-RETRIEVAL (lightweight)
  Fetch enough world/scene state for the Conductor to decide:
    - Active scene, player character, recent turn summary
    - Active NPC agendas (id, clock label, priority, secrecy, player relevance)
    - Active deadlines and immediate constraints
  ↓
Step 3: CONDUCTOR DECISION (Phase 4+; hardcoded "proceed" in Phases 1-3)
  Story Conductor evaluates:
    - Did the player state intent or assert an outcome?
    - What outcome is allowed by current state?
    - Proceed with narration? (default)
    - Advance the Living World first? (sets action = "advance_living_world")
    - Trigger scene transition? Wait for player? Activate proxy? Insert NPC interlude?
  Conductor output determines whether Step 4 runs.
  ↓
Step 4: LIVING WORLD ADVANCEMENT (conditional, Phase 4+)
  Runs ONLY if the Conductor returned action = "advance_living_world",
  OR on an explicit time skip / scene transition / return-to-location boundary.
  Does NOT run on ordinary in-scene player actions.
  When it runs:
    - Advance elapsed time and active deadlines
    - Advance major NPC agenda clocks (motivation × resources × opposition × secrecy × player interference)
    - Persist significant hidden / rumored / known world events
    - Update character locations and thread statuses
  Phases 1-3: skipped entirely (no Conductor, no Living World service).
  ↓
Step 5: FULL RETRIEVAL
  Build authoritative state (time, locality, identity, tactical state, content boundaries, constraints)
    — re-reads any state Living World just mutated
  Load relationship anchors for present major NPCs
  Retrieve relevant memories (top-N by similarity) (Phase 3+)
  Load active wiki pages, threads, visible NPC agenda consequences
  ↓
Step 6: NARRATIVE GENERATION
  Narrator Agent generates response
  Context = system prompt + authoritative state + world state + retrieved memories + player action/resolution
  Output = streamed narrative prose
  ↓
Step 7: EXTRACTION (Phase 3+)
  Archivist Agent parses narrator output
  Extracts structured data:
    - New/updated wiki entries
    - Timeline events
    - Relationship changes
    - Story thread updates
    - Tactical state deltas, scene summaries, NPC agendas (gated — see Agent System Design)
  Fails open: never blocks the player; the narrator turn is already persisted.
  ↓
Step 8: PERSISTENCE
  Save narrator turn (with token usage metadata)
  Save resolved action metadata and state deltas
  Save living world state changes and agenda clock progress
  Update wiki pages
  Append timeline events
  Update relationship graph
  Update story thread statuses
```

**MVP simplification by phase**:

| Phase | Step 2 | Step 3 (Conductor) | Step 4 (Living World) | Step 5 | Step 6 | Step 7 (Archivist) |
|-------|--------|--------------------|-----------------------| -------|--------|--------------------|
| 1     | minimal (last 20 turns + auth state) | hardcoded "proceed" | skipped | merged into Step 2 | full | skipped |
| 2     | + seeded knowledge | hardcoded "proceed" | skipped | + wiki direct lookup | full | skipped |
| 3     | + vector retrieval | hardcoded "proceed" | skipped | full | full | full (fails open) |
| 4+    | full | full Conductor | conditional on Conductor or boundary event | full | full | full (fails open) |

The pipeline grows in capability across phases without changing its fundamental shape. Conductor and Living World are explicit no-ops in Phases 1-3 — they ship as `null`-returning stubs so the call-site shape is stable from day one.

### 2.3.0 Meta-Commands (Out-of-Story Input)

Player input is not always an in-story action. Sometimes the player wants to pause, inspect state, or change the rules ("what do you know about my character?", "show me the established canon", "rewind one turn"). These must bypass the Narrator entirely — feeding them into the prompt invites the LLM to either roleplay an answer or hallucinate one.

A reserved prefix (default: `/`) routes input to a meta-command handler before Step 2 (Pre-retrieval). Handlers are deterministic code, not LLM calls:

| Command | Effect | Phase |
|---------|--------|-------|
| `/pause` | Halt narration; freeze the active turn cycle | 1 |
| `/inspect character` | Render structured `characters.traits` for the player character | 1 |
| `/inspect scene` | Render `scenes.metadata` including tactical state | 1 |
| `/canon` | List established facts about the player character, sorted by `canon_status` | 3 |
| `/rewind <n>` | Revert the last `n` turns (creates a `system_event` turn, does not delete) | 4 |
| `/rules` | Show the world's `setting_details`, content boundaries, and existence constraints | 1 |

Meta-commands never reach the Narrator, never count against the LLM cost cap, and never modify world canon except where explicitly designed to (e.g. `/rewind`). Anything that does not match a registered command is treated as in-story input. The append-only turn log is preserved: `/rewind` writes a `system_event` turn pointing at the reverted range rather than deleting rows.

The motivation for designing this in Phase 1 (rather than waiting): players will try meta-commands whether or not they are supported. Without explicit handling, the Narrator will improvise responses that contradict structured state — exactly the failure mode the rest of this architecture is designed to prevent.

### 2.3.1 Phase 1 Pipeline Slice

Phase 1 implements only the minimum story loop:

```
Player action
  ↓
Validate world, scene, character, and input
  ↓
Persist player_action turn in a transaction
  ↓
Load world + active scene + player character + authoritative state + recent turns
  ↓
Assemble narrator context within token budget
  ↓
Stream narrator response to client
  ↓
Persist narrator_response turn on finish
```

Do not build the World Seeder, Wiki Compiler, World Linter, Archivist, Conductor, Actor, vector retrieval, or wiki/timeline UI in Phase 1. Keep interfaces shaped so those capabilities can plug in later, but the MVP should remain a single-agent loop.

### 2.4 Agent System

Seven specialized agents, each with a distinct role and model tier:

| Agent | Model | Role | Phase |
|-------|-------|------|-------|
| **Narrator** | Grok 4.3 (`grok-4.3`) | Generates story prose, controls pacing/tone | 1 |
| **World Seeder** | Grok 4.3 (`grok-4.3`) | Generates seed packet, locations, factions, NPCs, mysteries, first scene | 2 |
| **Wiki Compiler** | Haiku (`claude-haiku-4-5-20251001`) | Compiles source documents into wiki/timeline/thread candidates | 2 |
| **World Linter** | Haiku (`claude-haiku-4-5-20251001`) | Flags contradictions, duplicates, missing provenance, timeline conflicts | 2 |
| **Archivist** | Haiku (`claude-haiku-4-5-20251001`) | Structured data extraction from narrative text during live play | 3 |
| **Story Conductor** | Haiku (`claude-haiku-4-5-20251001`) | Turn management, scene transitions, orchestration decisions | 4 |
| **Character Actor** | Grok 4.3 (`grok-4.3`) | Plays NPCs and proxy-controlled humans | 4 |

The two model IDs are the single source of truth in `infrastructure/llm/model-registry.ts`
(`NARRATOR_MODEL = 'grok-4.3'`, `HAIKU_MODEL = 'claude-haiku-4-5-20251001'`); the
structured-extraction agents on Haiku are the archivist, classifier, intent-reconciler,
npc-agent, region-extractor, and world-generator. Pricing (including a retained
`claude-sonnet-4-6` entry for cost math) lives beside it in `pricing.ts`. These literals
must not appear in `domain/` or `application/` (enforced by dependency-cruiser, §6).

Agents communicate through the pipeline, not directly with each other. The Conductor is the runtime supervisor — it decides which agents run and in what order during play. In the MVP, the pipeline is hardcoded (narrator only); the Conductor adds dynamic decision-making in Phase 4.

See [Agent System Design](agent-system-design.md) for detailed agent specifications.

### 2.4.1 Living World / Offscreen Agency

Major NPCs should continue to act when the player leaves the scene. Chronicles AI models this with a **Living World layer**: a lightweight simulation pass that advances only important actors, factions, deadlines, and story threads. It does not simulate every person in the world. It advances durable plans for major NPCs at meaningful boundaries such as travel, downtime, scene transitions, returning to a location, multiplayer wait windows, or explicit time skips.

Living World advancement has three responsibilities:

1. Advance world time and active deadlines.
2. Advance major NPC agenda clocks according to motivation, resources, opposition, secrecy, and player interference.
3. Persist consequences as structured state before the Narrator sees the world.

Example:

```text
The player met Lord-Castellan Dravik on Karthax.
Dravik has an active agenda: "Break from Imperial command and launch an unsanctioned crusade."
The player leaves Karthax for six in-world days.
Living World advancement moves Dravik's crusade-preparation clock from 40 to 100.
The system updates Dravik's location to "aboard the battle-barge Pax Irae", appends a rumored timeline event, and advances the related story thread.
When the player returns, the narrator receives authoritative state saying Dravik is no longer present.
```

The Narrator may dramatize the results, but it must not invent or reverse offscreen outcomes. Current reality belongs to the structured state layer.

### 2.5 Memory / Retrieval Layer

The memory layer sits between the agent system and the database. It is responsible for deciding **what the LLM remembers** on any given call. This is the architectural foundation of the entire system.

Three memory types:

| Type | What It Stores | Storage | Retrieval |
|------|---------------|---------|-----------|
| **Source** | User seeds, seed packets, expedition logs, prior adventure logs, uploaded lore, summaries | `world_sources` | Direct provenance lookup + compilation |
| **Episodic** | Scenes, player actions, dialogue, events | `turns`, `timeline_events` | Recent turns (Phase 1), vector similarity (Phase 3+) |
| **Semantic** | Character info, world lore, relationships, emotional beats, discovered truths | `worlds`, `characters`, `wiki_pages`, `relationships` | Direct DB lookup + vector similarity for wiki |
| **Procedural** | System prompts, agent rules, workflow definitions | `prompts/` directory (files) | Loaded at pipeline start |

The **Context Assembler** is the single function that builds the prompt for any agent call. It enforces a fixed **8,000-token input budget** (with **1,024 tokens reserved for narrator output**, so 7,000 tokens of usable input headroom by default) and fills it from highest-priority to lowest-priority sources:

```
Priority 1: System prompt (procedural memory)     ~500 tokens
Priority 2: Authoritative state block             ~300-600 tokens
Priority 3: Current scene + active characters     ~300-500 tokens
Priority 4: Active story threads                  ~200-300 tokens
Priority 5: Relationship anchors (present NPCs)   ~200-500 tokens
Priority 6: Retrieved semantic memories (wiki)    ~1000-1500 tokens (Phase 3+)
Priority 7: Retrieved episodic memories (chunks)  ~1000-1500 tokens (Phase 3+)
Priority 8: Recent raw turns                      ~2500-4000 tokens
Priority 9: Player action                         ~100-300 tokens
─────────────────────────────────────────────────────────────
Hard cap (input):                                 8,000 tokens
Reserved (output):                                1,024 tokens
```

**Truncation order (load-bearing rule):** if the assembled context exceeds 8,000 tokens, drop from lowest priority upward. The **system prompt (P1), authoritative state (P2), and player action (P9) are never truncated** — they are the minimum viable prompt. P8 (recent raw turns) is truncated oldest-first; P6/P7 are truncated lowest-relevance-first. If, after dropping P3-P8 entirely, the remainder still exceeds 8,000 tokens, fail the call with a `ContextOverflowError` rather than silently truncating a mandatory section.

See [Memory Architecture](memory-architecture.md) for the full retrieval pipeline design.

### 2.6 Data Layer

All persistent state lives behind the repository ports — nothing above `infrastructure/`
knows which store is live. There are two interchangeable adapter sets satisfying the same
ports:

- **SQLite (live / default)** — raw `better-sqlite3`, no ORM, migrations run on boot. This is
  the store every command and test uses by default.
- **MongoDB (ready, behind `PERSISTENCE=mongo`, not cut over)** — a full Mongoose adapter
  set. It models the same logical schema as 15 top-level collections + 2 embedded subdocs:
  CHECK constraints become mongoose enums; numeric ranges (importance 1..5, intensity 0..1)
  become min/max validators; `lower(name)` uniqueness becomes normalized `nameKey`/`titleKey`
  unique indexes per `worldId`; and a dedicated `counters` collection with atomic
  `findOneAndUpdate $inc` gives every collection a monotone **integer** id plus the turn
  sequence — **ordering never depends on `ObjectId`**. `[t:N]` provenance is preserved. The
  `UnitOfWork` is `session.withTransaction`, with replica-set fail-fast at boot.

Semantic vector search is the **Phase-2 embedding slot and is unbuilt**: in both adapters
`MemoryRepository.searchSimilar()` is a no-op returning `[]`. (The retrieval narrative below
describes the intended Phase-3+ behavior, not what runs today.)

No separate vector database. No Redis. No message queue. One live datastore behind ports.
Operational simplicity for a solo developer.

> **Superseded.** Earlier drafts targeted PostgreSQL 17 + pgvector + Drizzle ORM. That target
> is superseded by the SQLite-live / Mongo-ready arrangement above; the Mongo production
> cutover and the eventual deletion of the SQLite adapter remain manual gates on this preview
> branch.

See [Database Design](database-design.md) for the full schema.

## 3. Infrastructure Topology

### 3.1 Local Development

```
┌──────────────────────────────────────────┐
│  Host Machine                            │
│                                          │
│  Next.js Dev Server (npm run dev,        │
│    proxied to @chronicles/server)        │
│  Port 3000                               │
│                                          │
│  Datastore: SQLite file (better-sqlite3, │
│    migrations on boot) — no container    │
│  API calls to: api.x.ai (Grok)           │
│                api.anthropic.com (Haiku)  │
│  Embeddings: api.voyageai.com (Phase 2+) │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  Docker Compose (optional)               │
│   docker-compose.yml at the repo root —  │
│   a MongoDB replica set for PERSISTENCE= │
│   mongo experimentation ONLY (NOT        │
│   Postgres).                             │
└──────────────────────────────────────────┘
```

By default there is no container at all: SQLite is an on-disk file and the dev server runs on
the host for fast HMR. Docker Compose is only for exercising the Mongo adapter.

### 3.2 Production (Phase 6)

```
┌─────────────────────┐     ┌──────────────────────┐
│  Railway             │     │  Datastore            │
│                      │     │                        │
│  Next.js App         │────▶│  SQLite file on a      │
│  (@chronicles/server)│     │  Railway volume        │
│                      │     │  (migrates on boot).   │
│                      │     │  Mongo cutover is a    │
│                      │     │  manual gate.          │
└──────────┬───────────┘     └──────────────────────┘
           │
           ├──▶ api.x.ai (Grok — narrator/seeder/actor)
           ├──▶ api.anthropic.com (Haiku — extraction agents)
           └──▶ api.voyageai.com (Voyage embeddings, Phase 2+)
```

The production topology is deliberately simple: one deployment target, one live datastore,
the LLM/embedding API dependencies. Flipping production to `PERSISTENCE=mongo` (with the
backfill scripts) and then retiring the SQLite adapter are explicit, deferred gates on this
preview branch.

### 3.3 Boundary Enforcement (CI)

The onion boundaries are not just convention — they fail CI. A root
`.dependency-cruiser.cjs` declares 11 named rules: `domain-points-inward`,
`domain-no-io-or-framework`, `app-imports-domain-only`, `infrastructure-only-via-composition`,
`mongoose-only-in-mongo-adapter`, `better-sqlite3-only-in-sqlite-adapter`,
`model-registry-not-in-domain-or-app`, `client-no-server-layers`,
`client-no-native-or-server-sdk`, `contracts-pure`, and `no-circular`. Every
infrastructure / repository / composition module additionally carries a `server-only` import,
and a set of grep guards backstops the cruiser. `npm run depcruise` runs as a `pretest` step,
so the layering is checked on every test run.

## 4. Key Design Principles

### 4.1 The LLM Does Not Remember

This is the foundational insight. Every LLM call is stateless. The system decides what each agent "remembers" by selecting and injecting context. The memory layer is infrastructure, not an LLM feature.

### 4.2 Separate Creative from Factual

The Narrator and World Seeder generate creative material (subjective, stylistic, possibility-rich). The Wiki Compiler, World Linter, and Archivist extract or check structured facts (objective, schematic, provenance-aware). These are fundamentally different tasks requiring different models, prompts, and output formats. Never ask a creative agent to also be the source of canon hygiene, or a factual agent to write dramatic prose.

### 4.3 System Owns Current Reality

The Narrator writes prose, but the system owns current reality. Time, location, identity, presentation, deadlines, visible characters, active constraints, and adjudicated action outcomes are represented as structured state and injected into runtime prompts above retrieved memories. Player text expresses intent; it does not directly rewrite world state. This keeps time pressure meaningful, prevents locality drift, and stops equipment or phrasing from changing who a character is.

### 4.3.1 Major NPCs Have Momentum

Major NPCs are not static scene props. When an NPC has an active agenda, the system tracks desire, means, pressure, visibility, clock progress, and consequences. If the player ignores or leaves that NPC, the agenda may still progress. Returning to a location should reveal changed circumstances through authoritative state, timeline events, rumors, absences, occupied territory, new loyalties, or resolved story threads.

The system should prefer clock-based offscreen advancement over constant simulation. A small number of high-signal agenda updates creates the feeling of a living world without turning every player turn into a full world simulation.

### 4.4 Append-Only Story State

Turns and world sources are never edited or deleted during normal story operation. The story is an append-only log, and seeded/imported material is append-only provenance. Retries append new `system_event` and `narrator_response` turns rather than removing failed output. Wiki pages and timelines are derived views that can be regenerated from turns and sources. This simplifies consistency and makes debugging trivial (replay the turn/source log).

The only deletion exception is deleting an entire world, which cascades related data as a user-requested destructive action.

### 4.5 Token Budget Discipline

Every LLM call has an explicit token budget. The context assembler fills the budget from highest-priority to lowest-priority sources and truncates when full. No call ever dumps "the full history." This controls costs and maintains response quality (LLMs perform worse with excessively long contexts).

### 4.6 Progressive Complexity

Each phase adds capability without restructuring previous work. Phase 1's context assembler has the same interface in Phase 6 — it just pulls from more sources. Phase 1's streaming endpoint gains multiplayer turn ordering in Phase 5, but the core flow (input → narrate → persist) never changes.

## 5. Technology Decisions Summary

| Decision | Choice | Alternatives Considered | Why |
|----------|--------|------------------------|-----|
| Framework | Next.js 15 App Router | Remix, SvelteKit, plain Express | Best SSR + streaming + PWA story. Server Components reduce client JS. |
| Repo layout | npm-workspaces monorepo (`@chronicles/server`, `@chronicles/contracts`) | single app, Nx/Turborepo | Shared Zod contracts + a place for an eventual client split, with the onion layers physically realized under `packages/server/src`. |
| Architecture | Hexagonal / onion (domain → application → infrastructure, composition root) | layered MVC, framework-coupled | Pure, testable domain; swappable adapters (SQLite ↔ Mongo); boundaries enforced by dependency-cruiser. |
| LLM SDK | Vercel AI SDK (`@ai-sdk/*`) | Raw provider SDKs, LangChain | `streamText()` + `generateObject()`. Open source, MIT. |
| Narrator/seeder/actor model | Grok 4.3 (`grok-4.3`, xAI) | Claude Sonnet, GPT | Creative prose tier; IDs centralized in `infrastructure/llm`. |
| Extraction-agent model | Haiku (`claude-haiku-4-5-20251001`) | Sonnet, GPT-mini | Cheap, fast structured extraction for archivist/classifier/etc. |
| Database (live) | SQLite via raw `better-sqlite3` | Postgres+pgvector, Drizzle | Zero-ops single-file store; migrations on boot. Postgres/pgvector/Drizzle target was superseded. |
| Database (ready) | MongoDB + Mongoose (behind `PERSISTENCE=mongo`) | stay on SQLite | Same ports; counters give monotone int ids so ordering never depends on `ObjectId`. Cutover is a manual gate. |
| Styling | Tailwind + shadcn/ui | CSS Modules, Styled Components, MUI | Fast iteration. Own the component code. No runtime CSS-in-JS. |
| Validation | Zod | Yup, io-ts, ArkType | AI SDK integration for `generateObject()`; the shared `@chronicles/contracts` schemas. |
| Auth | NextAuth.js (Phase 5) | Clerk, Supabase Auth, custom | Self-hosted, flexible providers, no vendor lock-in. |
| Embeddings | Voyage AI (Phase 2+) | OpenAI, Cohere, local models | Anthropic-recommended. Slot exists; `searchSimilar()` is a no-op today. |
| Boundary linter | dependency-cruiser (11 rules) + `server-only` + grep guards | ESLint `no-restricted-paths`, convention only | Fails CI when a layer is crossed; runs as `pretest`. |
| Tests | Vitest (`npm test`, ~361 pass + 1 skip; `npm run test:mongo` on a real `MongoMemoryReplSet`) | Jest, node:test | Fast, ESM-native; SQLite suite by default, Mongo suite opt-in. |

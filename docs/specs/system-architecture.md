# System Architecture

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
│         │    SSE Stream   │   POST /api/story/stream          │
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
│  │  │  (Sonnet)    │  │  (Sonnet)  │  │   (Haiku)    │  │   │
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
│                    DATA LAYER                                │
│                                                              │
│  ┌──────────────────────┐    ┌───────────────────────────┐  │
│  │  PostgreSQL           │    │  pgvector                  │  │
│  │                       │    │                            │  │
│  │  worlds               │    │  memory_chunks.embedding   │  │
│  │  characters           │    │  wiki_pages.embedding      │  │
│  │  scenes               │    │                            │  │
│  │  turns                │    │  Cosine similarity search  │  │
│  │  world_sources        │    │  HNSW index               │  │
│  │  wiki_pages           │    │  HNSW index               │  │
│  │  timeline_events      │    │                            │  │
│  │  relationships        │    └───────────────────────────┘  │
│  │  story_threads        │                                   │
│  │  npc_agendas          │                                   │
│  │  memory_chunks        │    ┌───────────────────────────┐  │
│  │  notifications        │    │  Voyage AI (External)      │  │
│  └──────────────────────┘    │  Embedding generation      │  │
│                               └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 2. Core Components

### 2.1 Client Layer

The browser-based client is a Next.js App Router application serving as a Progressive Web App. It communicates with the server through two channels:

- **Server Actions** — for all CRUD mutations (creating worlds, updating characters, browsing wiki). These are direct RPC calls that bypass traditional REST routing.
- **SSE Stream** — for narrator responses. A single Route Handler at `/api/story/stream` accepts player actions and returns a Server-Sent Events stream of narrator tokens.

The client renders three primary views:
1. **Story Feed** — scrolling narrative display showing the full turn history with live streaming of new narrator responses
2. **Story Input** — text input for player actions (voice input in Phase 6)
3. **Optional Knowledge Surface** — wiki pages, timeline, character sheets, story threads, and tactical state are queryable in Phase 2+ but visible UI is deferred until playtesting confirms it helps the conversation-first experience

### 2.2 Server Layer

The Next.js server handles routing, authentication (Phase 5), and orchestrates the story flow pipeline. It is NOT a thin API layer — it contains the core business logic for agent orchestration, memory retrieval, and world state management.

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
| **Narrator** | Claude Sonnet 4 | Generates story prose, controls pacing/tone | 1 |
| **World Seeder** | Claude Sonnet 4 | Generates seed packet, locations, factions, NPCs, mysteries, first scene | 2 |
| **Wiki Compiler** | Claude Haiku | Compiles source documents into wiki/timeline/thread candidates | 2 |
| **World Linter** | Claude Haiku | Flags contradictions, duplicates, missing provenance, timeline conflicts | 2 |
| **Archivist** | Claude Haiku | Structured data extraction from narrative text during live play | 3 |
| **Story Conductor** | Claude Haiku | Turn management, scene transitions, orchestration decisions | 4 |
| **Character Actor** | Claude Sonnet 4 | Plays NPCs and proxy-controlled humans | 4 |

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

All persistent state lives in a single PostgreSQL instance with the pgvector extension.

- **Relational tables** store structured world state (worlds, characters, scenes, turns, sources, wiki, timeline, relationships, threads)
- **Vector columns** on `memory_chunks` and `wiki_pages` enable semantic similarity search via pgvector's HNSW indexes
- **Drizzle ORM** provides type-safe access with plain SQL migrations

No separate vector database. No Redis. No message queue. One database, one ORM, one source of truth. Operational simplicity for a solo developer.

See [Database Design](database-design.md) for the full schema.

## 3. Infrastructure Topology

### 3.1 Local Development

```
┌──────────────────────────────────────────┐
│  Docker Compose                          │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  pgvector/pgvector:pg17            │  │
│  │  Port 5432                         │  │
│  │  Volume: pgdata                    │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  Host Machine                            │
│                                          │
│  Next.js Dev Server (npm run dev)        │
│  Port 3000                               │
│                                          │
│  Connects to: localhost:5432             │
│  API calls to: api.anthropic.com         │
│  Embedding calls to: api.voyageai.com    │
└──────────────────────────────────────────┘
```

One Docker container (Postgres), one local process (Next.js). The dev server runs on the host (not in Docker) for fast HMR.

### 3.2 Production (Phase 6)

```
┌─────────────────────┐     ┌──────────────────────┐
│  Vercel / Railway    │     │  Supabase / Managed   │
│                      │     │  PostgreSQL            │
│  Next.js App         │────▶│                        │
│  (Server + Client)   │     │  pgvector enabled      │
│                      │     │  Connection pooling     │
└──────────┬───────────┘     └──────────────────────┘
           │
           ├──▶ api.anthropic.com (Claude Sonnet/Haiku)
           └──▶ api.voyageai.com (Voyage embeddings)
```

The production topology is deliberately simple: one deployment target, one database, two external API dependencies.

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
| LLM SDK | Vercel AI SDK | Raw Anthropic SDK, LangChain | `useChat()` + `streamText()` + `generateObject()`. Open source, MIT. |
| Database | PostgreSQL + pgvector | Postgres + Pinecone, MongoDB, SQLite | One DB for relational + vector. Minimal operational overhead. |
| ORM | Drizzle | Prisma, Kysely, raw SQL | Lightweight, type-safe, first-class pgvector, plain SQL migrations. |
| Styling | Tailwind + shadcn/ui | CSS Modules, Styled Components, MUI | Fast iteration. Own the component code. No runtime CSS-in-JS. |
| Validation | Zod | Yup, io-ts, ArkType | AI SDK integration for `generateObject()`. Drizzle inference. Ecosystem standard. |
| Auth | NextAuth.js (Phase 5) | Clerk, Supabase Auth, custom | Self-hosted, flexible providers, no vendor lock-in. |
| Embeddings | Voyage AI (Phase 2) | OpenAI, Cohere, local models | Anthropic-recommended. Shared embedding spaces. Cost-effective. |

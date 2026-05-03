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

Every player turn triggers a six-step pipeline:

```
Step 1: INPUT
  Player submits text action
  ↓
Step 2: RETRIEVAL
  Fetch world state from DB
  Build authoritative state (time, locality, identity, tactical state, content boundaries, constraints)
  Retrieve relevant memories (top-N by similarity)
  Load active scene, characters, threads
  ↓
Step 3: CONDUCTOR DECISION
  Story Conductor evaluates:
    - Did the player state intent or assert an outcome?
    - What outcome is allowed by current state?
    - Proceed with narration?
    - Wait for another player? (multiplayer)
    - Activate AI proxy? (multiplayer)
    - Trigger scene transition?
    - Branch to parallel scene?
  ↓
Step 4: NARRATIVE GENERATION
  Narrator Agent generates response
  Context = system prompt + authoritative state + world state + retrieved memories + player action/resolution
  Output = streamed narrative prose
  ↓
Step 5: EXTRACTION
  Archivist Agent parses narrator output
  Extracts structured data:
    - New/updated wiki entries
    - Timeline events
    - Relationship changes
    - Story thread updates
  ↓
Step 6: PERSISTENCE
  Save narrator turn (with token usage metadata)
  Save resolved action metadata and state deltas
  Update wiki pages
  Append timeline events
  Update relationship graph
  Update story thread statuses
```

**MVP simplification**: Steps 2, 3, and 5 are reduced in Phase 1. Retrieval is just "last N turns" plus the authoritative state block. Conductor is implicit (always proceed), though the context assembler still classifies player action stance so asserted outcomes do not automatically become true. Extraction is deferred entirely. The pipeline grows in capability across phases without changing its fundamental shape.

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

See [Agent System Design](03-agent-system-design.md) for detailed agent specifications.

### 2.5 Memory / Retrieval Layer

The memory layer sits between the agent system and the database. It is responsible for deciding **what the LLM remembers** on any given call. This is the architectural foundation of the entire system.

Three memory types:

| Type | What It Stores | Storage | Retrieval |
|------|---------------|---------|-----------|
| **Source** | User seeds, seed packets, expedition logs, prior adventure logs, uploaded lore, summaries | `world_sources` | Direct provenance lookup + compilation |
| **Episodic** | Scenes, player actions, dialogue, events | `turns`, `timeline_events` | Recent turns (Phase 1), vector similarity (Phase 3+) |
| **Semantic** | Character info, world lore, relationships, emotional beats, discovered truths | `worlds`, `characters`, `wiki_pages`, `relationships` | Direct DB lookup + vector similarity for wiki |
| **Procedural** | System prompts, agent rules, workflow definitions | `prompts/` directory (files) | Loaded at pipeline start |

The **Context Assembler** is the single function that builds the prompt for any agent call. It takes a token budget and fills it from highest-priority to lowest-priority sources:

```
Priority 1: System prompt (procedural memory)     ~500 tokens
Priority 2: Current scene + active characters      ~300 tokens
Priority 3: Active story threads                   ~200 tokens
Priority 4: Retrieved semantic memories (wiki)     ~1500 tokens
Priority 5: Retrieved episodic memories (turns)    ~4000 tokens
Priority 6: Player action                          ~100 tokens
─────────────────────────────────────────────────────────────
Target total:                                      ~6600 tokens
```

See [Memory Architecture](04-memory-architecture.md) for the full retrieval pipeline design.

### 2.6 Data Layer

All persistent state lives in a single PostgreSQL instance with the pgvector extension.

- **Relational tables** store structured world state (worlds, characters, scenes, turns, sources, wiki, timeline, relationships, threads)
- **Vector columns** on `memory_chunks` and `wiki_pages` enable semantic similarity search via pgvector's HNSW indexes
- **Drizzle ORM** provides type-safe access with plain SQL migrations

No separate vector database. No Redis. No message queue. One database, one ORM, one source of truth. Operational simplicity for a solo developer.

See [Database Design](02-database-design.md) for the full schema.

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

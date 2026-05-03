# Implementation Roadmap

## Overview

Five phases, each delivering independent value. Phase 1 is the MVP — a playable single-player story engine. Each subsequent phase adds capabilities without restructuring previous work.

**Rule**: Do not start a new phase until the current phase is complete, tested, and played through at least 3 complete story sessions.

---

## Phase 1: Foundation + Core Loop (MVP)

**Goal**: A user can create a world, start a story, type actions, and receive streamed narrator responses. Turns persist across browser sessions.

**Agent count**: 1 (Narrator)
**Table count**: 4 (worlds, characters, scenes, turns)
**Estimated files**: ~30 application files

### Step 1.1: Project Scaffolding

**Deliverable**: Next.js project builds and runs with Tailwind + shadcn/ui.

- [ ] Initialize Next.js 15 with App Router, TypeScript, Tailwind, ESLint
- [ ] Install dependencies: `ai`, `@ai-sdk/anthropic`, `drizzle-orm`, `postgres`, `drizzle-kit`, `zod`, `@tanstack/react-query`
- [ ] Initialize shadcn/ui: `button`, `input`, `textarea`, `card`, `badge`, `select`, `scroll-area`, `separator`
- [ ] Create root layout with font loading and global CSS
- [ ] Create `.env.example` with documented variables
- [ ] Verify: `npm run dev` shows default Next.js page with Tailwind styling

**Acceptance criteria**: Project compiles, dev server runs, Tailwind classes render correctly.

### Step 1.2: Docker + Database

**Deliverable**: Postgres + pgvector running in Docker, Drizzle connected.

- [ ] Create `docker-compose.yml` with `pgvector/pgvector:pg17`
- [ ] Create `docker/init.sql` with `CREATE EXTENSION IF NOT EXISTS vector`
- [ ] Create `drizzle.config.ts`
- [ ] Create Drizzle client singleton at `src/lib/db/index.ts`
- [ ] Define schema: `worlds.ts`, `characters.ts`, `scenes.ts`, `turns.ts`
- [ ] Create schema index at `src/lib/db/schema/index.ts`
- [ ] Run `drizzle-kit generate` to produce migration SQL
- [ ] Run `drizzle-kit migrate` to apply
- [ ] Verify: connect to DB, confirm tables exist, pgvector extension active

**Acceptance criteria**: `docker compose up` starts DB. Drizzle migration creates all 4 tables. Can insert and query a test row.

### Step 1.3: Database Query Layer

**Deliverable**: Type-safe query functions for all CRUD operations.

- [ ] `src/lib/db/queries/worlds.ts`: `createWorld()`, `getWorld()`, `listWorlds()`, `updateWorld()`, `deleteWorld()`
- [ ] `src/lib/db/queries/scenes.ts`: `createScene()`, `getActiveScene()`, `completeScene()`
- [ ] `src/lib/db/queries/turns.ts`: `createTurn()`, `getRecentTurns()`, `getTurnCount()`, `getNextTurnNumber()`
- [ ] `src/lib/db/queries/characters.ts`: `createCharacter()`, `getCharacter()`, `getPlayerCharacter()`

**Acceptance criteria**: Each query function is typed, tested against the running database, and handles not-found cases.

### Step 1.4: World CRUD (Server Actions + Pages)

**Deliverable**: User can create worlds and see them listed.

- [ ] `src/lib/actions/world-actions.ts`: Server Actions with Zod validation
- [ ] `src/app/worlds/page.tsx`: World list page (Server Component)
- [ ] `src/app/worlds/new/page.tsx`: Create world form
- [ ] `src/components/world/WorldCard.tsx`: World preview card
- [ ] `src/components/world/CreateWorldForm.tsx`: Form with validation
- [ ] Creating a world also creates initial scene + player character (transaction)

**Acceptance criteria**: Navigate to `/worlds/new`, fill form, submit. Redirected to play page. Navigate back to `/worlds` and see the world listed.

### Step 1.5: Narrator Agent

**Deliverable**: Narrator generates streamed prose responses.

- [ ] `prompts/narrator-system.md`: System prompt template
- [ ] `src/lib/ai/prompts.ts`: Prompt template loader with variable interpolation
- [ ] `src/lib/ai/context-assembler.ts`: Assembles context from DB state (token-budgeted)
- [ ] `src/lib/ai/narrator.ts`: Calls `streamText()` with assembled context
- [ ] Token estimation function (`estimateTokens()`)

**Acceptance criteria**: Given a world, scene, character, and recent turns, the narrator returns a streamed prose response. Context stays within token budget. Prompt template loads correctly with interpolated variables.

### Step 1.6: Streaming Endpoint

**Deliverable**: End-to-end streaming from player input to narrator response.

- [ ] `src/app/api/story/stream/route.ts`: Route Handler
- [ ] Request validation with Zod
- [ ] Persist player turn BEFORE streaming starts
- [ ] Persist narrator turn AFTER stream completes (`onFinish`)
- [ ] Token usage metadata saved in `turns.metadata`
- [ ] Basic rate limiting (30 turns/minute/world)
- [ ] Error handling: partial content saved on stream failure

**Acceptance criteria**: POST to `/api/story/stream` with valid payload returns SSE stream. Player turn and narrator turn both appear in DB after completion. Token counts in metadata.

### Step 1.7: Story Play UI

**Deliverable**: Full play experience in the browser.

- [ ] `src/app/worlds/[worldId]/play/page.tsx`: Server Component that loads initial state
- [ ] `src/components/story/StoryContainer.tsx`: Client Component wrapping `useChat()`
- [ ] `src/components/story/StoryFeed.tsx`: Scrolling turn display with auto-scroll
- [ ] `src/components/story/TurnEntry.tsx`: Renders player actions and narrator responses
- [ ] `src/components/story/StreamingTurn.tsx`: Animated streaming display
- [ ] `src/components/story/StoryInput.tsx`: Textarea with submit (Enter), newline (Shift+Enter)
- [ ] Input disabled while streaming
- [ ] Loading skeleton for initial page load

**Acceptance criteria**: Navigate to play page, see existing turns. Type action, see streamed narrator response appear token-by-token. Refresh page, all turns still visible.

### Step 1.8: Error Handling + Polish

**Deliverable**: Robust error handling, responsive layout, loading states.

- [ ] Stream failure → error message + "Retry" button
- [ ] Empty state for new worlds (no turns yet)
- [ ] Responsive layout (mobile + desktop)
- [ ] World dashboard page at `/worlds/[worldId]`
- [ ] Custom error classes at `src/lib/utils/errors.ts`
- [ ] Input validation (empty, too long, whitespace-only)

**Acceptance criteria**: All error cases handled gracefully. Mobile layout works. Page refresh preserves state. No unhandled errors in console.

### Phase 1 Completion Criteria

- [ ] `docker compose up` → `npm run dev` → create world → play 20+ turns
- [ ] Refresh browser — all turns persist
- [ ] Mobile layout is usable
- [ ] Token usage tracked in DB
- [ ] No errors in console during normal play
- [ ] **Play 3 complete story sessions** before starting Phase 2

---

## Phase 2: Memory + Knowledge System

**Goal**: The world builds a persistent knowledge base. Wiki pages, timeline, and relationships are auto-extracted from the narrative. Semantic search enables long-term memory.

**New agents**: Archivist
**New tables**: wiki_pages, timeline_events, relationships, story_threads, memory_chunks
**New dependencies**: `voyageai` (embedding client)

### Step 2.1: Archivist Agent

- [ ] `prompts/archivist-system.md`: System prompt template
- [ ] Zod schema for Archivist structured output
- [ ] `src/lib/ai/archivist.ts`: Calls `generateObject()` with Haiku
- [ ] Async execution after narrator turn (non-blocking)
- [ ] Retry logic (up to 2 retries on schema validation failure)

### Step 2.2: Knowledge Tables + Migrations

- [ ] `wiki_pages` schema + migration
- [ ] `timeline_events` schema + migration
- [ ] `relationships` schema + migration
- [ ] `story_threads` schema + migration
- [ ] `memory_chunks` schema + migration (with vector column)
- [ ] HNSW indexes on vector columns
- [ ] Query functions for all new tables

### Step 2.3: Embedding Pipeline

- [ ] Install and configure Voyage AI client
- [ ] `src/lib/ai/embeddings.ts`: Embed text → vector
- [ ] Embed memory chunks on creation
- [ ] Embed wiki pages on creation/update
- [ ] Vector similarity search functions

### Step 2.4: Enhanced Context Assembly

- [ ] Update context assembler to include retrieved memories
- [ ] Update context assembler to include relevant wiki pages
- [ ] Update context assembler to include active threads
- [ ] Token budget allocation across all source types
- [ ] Relevance score threshold filtering

### Step 2.5: Knowledge UI

- [ ] Sidebar component (desktop: right panel, mobile: bottom tabs)
- [ ] Wiki panel: list + detail view
- [ ] Timeline panel: chronological event display
- [ ] Character panel: character cards with relationship info
- [ ] Thread panel: active/resolved thread list

### Phase 2 Completion Criteria

- [ ] Archivist extracts structured data after each narrator turn
- [ ] Wiki pages appear in sidebar after relevant narrative events
- [ ] Timeline updates with significant events
- [ ] Semantic search returns relevant memories for player actions
- [ ] Narrator references facts from 50+ turns ago (beyond raw turn window)

---

## Phase 3: Full Agent Orchestra

**Goal**: The Story Conductor manages pacing and scene transitions. NPCs have their own voice via the Character Actor agent. Story threads are actively tracked.

**New agents**: Story Conductor, Character Actor
**New tables**: none (schema additions to existing tables)

### Step 3.1: Story Conductor Agent

- [ ] `prompts/conductor-system.md`: System prompt template
- [ ] Zod schema for Conductor decision output
- [ ] `src/lib/ai/conductor.ts`: Calls `generateObject()` with Haiku
- [ ] Replace hardcoded "always proceed" with conductor decisions
- [ ] Conductor runs BEFORE narrator in pipeline

### Step 3.2: Character Actor Agent

- [ ] `prompts/actor-system.md`: System prompt template
- [ ] `src/lib/ai/actor.ts`: Calls `streamText()` with Sonnet
- [ ] NPC action insertion into turn history
- [ ] Actor triggered by conductor's `npc_interlude` decision

### Step 3.3: Scene Management

- [ ] Automatic scene transitions (conductor-driven)
- [ ] Scene opening generation (narrator called with scene context)
- [ ] Scene list UI on world dashboard
- [ ] Manual scene creation option

### Step 3.4: Story Thread Tracking

- [ ] Active threads displayed in context to narrator
- [ ] Thread resolution detection by Archivist
- [ ] Thread UI in sidebar

### Phase 3 Completion Criteria

- [ ] Conductor makes scene transition decisions naturally
- [ ] NPCs speak in their own voice (distinct from narrator)
- [ ] Scene transitions feel organic, not abrupt
- [ ] Story threads are tracked and resolved

---

## Phase 4: Multiplayer

**Goal**: Multiple users share a world. AI proxy controls inactive players. Async turn system with notifications.

**New tables**: users, player_characters, notifications
**New dependencies**: `next-auth` (authentication)

### Step 4.1: Authentication

- [ ] NextAuth.js setup (email + OAuth providers)
- [ ] `users` table + migration
- [ ] Auth middleware on protected routes
- [ ] Login/signup pages

### Step 4.2: Multi-User World Sharing

- [ ] `player_characters` table + migration
- [ ] World invitation system
- [ ] World ownership (creator = owner)
- [ ] Character creation for new players joining a world

### Step 4.3: AI Proxy System

- [ ] Proxy mode settings per player character (manual/soft/full)
- [ ] Proxy activation logic (timeout-based)
- [ ] Actor agent with proxy constraints
- [ ] Proxy action UI indicators

### Step 4.4: Async Turn System

- [ ] Turn ordering for multiple players
- [ ] Configurable wait window before proxy activation
- [ ] Conductor evaluates which player should act next

### Step 4.5: Notifications

- [ ] `notifications` table + migration
- [ ] Real-time notification delivery (SSE)
- [ ] Notification types: turn waiting, proxy activated, world invite
- [ ] Notification UI (bell icon, dropdown)

### Phase 4 Completion Criteria

- [ ] Two users can play in the same world asynchronously
- [ ] AI proxy takes over after configurable inactivity
- [ ] Proxy actions respect character personality and constraints
- [ ] Notifications alert players when it's their turn

---

## Phase 5: Polish + Deploy

**Goal**: Production-ready deployment with voice I/O and PWA support.

### Step 5.1: Production Database

- [ ] Migrate to Supabase or managed Postgres
- [ ] Connection pooling setup
- [ ] Database backup strategy
- [ ] Environment-specific configuration

### Step 5.2: Voice I/O

- [ ] TTS integration (ElevenLabs or similar)
- [ ] Voice output toggle per user
- [ ] Voice input via Web Speech API (optional)
- [ ] Audio playback controls

### Step 5.3: PWA

- [ ] `next-pwa` or manual service worker
- [ ] Web app manifest
- [ ] Offline reading mode (cached turns)
- [ ] Install prompt

### Step 5.4: Performance + Cost Optimization

- [ ] Anthropic prompt caching (`cache_control`) for static system prompts
- [ ] Cost tracking dashboard (per-world, per-session)
- [ ] Per-world cost caps with user warnings
- [ ] Response time monitoring

### Step 5.5: Deployment

- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Staging environment
- [ ] Production deployment (Vercel, Railway, or Docker-based)
- [ ] Domain + SSL
- [ ] Error monitoring (Sentry or similar)

### Phase 5 Completion Criteria

- [ ] Application accessible via public URL
- [ ] Voice narration works end-to-end
- [ ] PWA installable on mobile
- [ ] Cost tracking visible to user
- [ ] Error monitoring in place

---

## Dependency Graph

```
Phase 1 ────────────────────────────────────────��────┐
  1.1 Scaffolding                                     │
    └──▶ 1.2 Docker + DB                             │
          └──▶ 1.3 Query Layer                        │
                ├──▶ 1.4 World CRUD                   │
                └──▶ 1.5 Narrator Agent               │
                      └──▶ 1.6 Streaming Endpoint     │
                            └──▶ 1.7 Story Play UI    │
                                  └──▶ 1.8 Polish     │
                                                       │
Phase 2 ◄──────────────────────────────────────────────┘
  2.1 Archivist Agent ──────────┐
  2.2 Knowledge Tables ─────────┼──▶ 2.4 Enhanced Context
  2.3 Embedding Pipeline ───────┘         │
                                          └──▶ 2.5 Knowledge UI

Phase 3 ◄──────────────────────────────────────────────
  3.1 Conductor ──┐
  3.2 Actor ──────┼──▶ 3.3 Scene Management
                  │         │
                  └─────────┼──▶ 3.4 Thread Tracking

Phase 4 ◄──────────────────────────────────────────────
  4.1 Auth ──▶ 4.2 Multi-User ──▶ 4.3 Proxy System
                                        │
                    4.4 Turn System ◄────┘
                         │
                         └──▶ 4.5 Notifications

Phase 5 ◄──────────────────────────────────────────────
  5.1 Prod DB ──────────┐
  5.2 Voice ────────────┼──▶ 5.5 Deployment
  5.3 PWA ──────��───────┤
  5.4 Cost Optimization ┘
```

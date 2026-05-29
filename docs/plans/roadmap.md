# Implementation Roadmap

## Overview

Six phases, each delivering independent value. Phase 1 is the MVP — a playable single-player story engine. Each subsequent phase adds capabilities without restructuring previous work.

**Rule**: Do not start a new phase until the current phase is complete, tested, and played through at least 3 complete story sessions.

**SDK rule**: Pin the AI SDK major version before implementing streaming. The default target is AI SDK 5+ UI message streams; if implementation chooses AI SDK 4, update `docs/specs/api-design.md` before coding.

---

## Phase 1: Foundation + Core Loop (MVP)

**Goal**: A user can create a world, start a story, type actions, and receive streamed narrator responses. Turns persist across browser sessions.

**Agent count**: 1 (Narrator)
**Table count**: 4 (worlds, characters, scenes, turns)
**Estimated files**: ~30 application files

### Step 1.1: Project Scaffolding

**Deliverable**: Next.js project builds and runs with Tailwind + shadcn/ui.

- [ ] Initialize Next.js 15 with App Router, TypeScript, Tailwind, ESLint
- [ ] Install dependencies: `ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`, `drizzle-orm`, `postgres`, `drizzle-kit`, `zod`, `@tanstack/react-query`
- [ ] Pin the chosen AI SDK major version in `package.json` and confirm streaming APIs match `docs/specs/api-design.md`
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
- [ ] Turn creation uses a transaction-safe sequence strategy (advisory lock or equivalent)
- [ ] World query helpers expose `setting_details.clock` and active deadlines
- [ ] World query helpers expose `setting_details.content_boundaries` as authoritative agent constraints
- [ ] Character query helpers expose `traits.location`, `traits.identity`, and `traits.presentation`
- [ ] Scene query helpers expose `scenes.metadata.tactical_state` for objectives, threats, allies, casualties, resources, clocks, and extraction status

**Acceptance criteria**: Each query function is typed, tested against the running database, and handles not-found cases.

### Step 1.4: World CRUD (Server Actions + Pages)

**Deliverable**: User can create worlds and see them listed.

- [ ] `src/lib/actions/world-actions.ts`: Server Actions with Zod validation
- [ ] `src/app/worlds/page.tsx`: World list page (Server Component)
- [ ] `src/app/worlds/new/page.tsx`: Create world form
- [ ] `src/components/world/WorldCard.tsx`: World preview card
- [ ] `src/components/world/CreateWorldForm.tsx`: Form with validation
- [ ] Creating a world also creates initial scene + player character (transaction)
- [ ] Player character creation validates curated name parts, rejects numbers/symbol handles, and stores `traits.name_profile`
- [ ] The create-world form offers generated family/house/regimental name choices when the world has a naming policy

**Acceptance criteria**: Navigate to `/worlds/new`, fill form, submit. Redirected to play page. Navigate back to `/worlds` and see the world listed. Invalid handles such as names with numbers or decorative symbols are rejected, while accepted names store structured `name_profile` data.

### Step 1.5: Narrator Agent

**Deliverable**: Narrator generates streamed prose responses.

- [ ] `prompts/narrator-system.md`: System prompt template
- [ ] `src/lib/ai/prompts.ts`: Prompt template loader with variable interpolation
- [ ] `src/lib/ai/context-assembler.ts`: Assembles context from DB state (token-budgeted)
- [ ] `src/lib/ai/authoritative-state.ts`: Builds compact time, locality, identity, presentation, visible NPC, tactical state, and constraint block
- [ ] Context assembler includes compact relationship anchors for present major NPCs when available
- [ ] Lightweight action classifier: `stance` (`attempt`, `strong_intent`, `asserted_outcome`, `unclear`) plus `input_mode` (`tactical_intent`, `asserted_outcome`, `cinematic_framing`, `emotional_interiority`, `meta_or_unclear`)
- [ ] `src/lib/ai/narrator.ts`: Calls `streamText()` with assembled context
- [ ] Token estimation function (`estimateTokens()`)

**Acceptance criteria**: Given a world, scene, character, authoritative state, relationship anchors, and recent turns, the narrator returns a streamed prose response. Context stays within token budget. Prompt template loads correctly with interpolated variables. The narrator preserves current location, time pressure, tactical state, character identity, content boundaries, relationship continuity, and explicit negative facts even when older prose falls out of context. Narration uses "you" for the player and does not blur player/NPC first-person perspective.

### Step 1.6: Streaming Endpoint

**Deliverable**: End-to-end streaming from player input to narrator response.

- [ ] `src/app/api/story/stream/route.ts`: Route Handler
- [ ] Request validation with Zod
- [ ] Persist player turn BEFORE streaming starts
- [ ] Persist narrator turn AFTER stream completes (`onFinish`)
- [ ] Token usage metadata saved in `turns.metadata`
- [ ] If action stance is `asserted_outcome`, persist `turns.metadata.resolution` with the accepted, modified, or rejected outcome and classified `input_mode`
- [ ] Basic rate limiting (30 turns/minute/world)
- [ ] Error handling: partial content saved on stream failure
- [ ] Retry behavior appends a `system_event` and fresh narrator turn; no failed turns are deleted

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
- [ ] Sanitize or safely render narrator output; never render LLM text as trusted HTML
- [ ] Reject out-of-world route access by verifying world, scene, and character relationships

**Acceptance criteria**: All error cases handled gracefully. Mobile layout works. Page refresh preserves state. No unhandled errors in console.

### Phase 1 Test Requirements

- [ ] DB integration tests cover core query functions and transaction-safe turn numbering
- [ ] Server Action tests cover Zod validation and create-world transaction behavior
- [ ] Streaming route test covers validation, player-turn persistence, narrator-turn persistence, and error metadata
- [ ] Context assembler tests cover token budget limits and recent-turn ordering
- [ ] Authoritative state tests cover time/deadline injection, player location, identity vs. presentation, and `not_facts`
- [ ] Action classifier tests cover "I attempt to strike", "I strike", "I cut off the enemy's leg", "everything changes in a burst of light", and "I am devastated"
- [ ] Tactical state tests cover objective status, wounded allies, casualties, resources, and extraction clocks in the authoritative state block
- [ ] Content boundary tests verify restricted content is passed into agent context as authoritative state
- [ ] Playwright smoke test covers create world -> submit action -> streamed response -> refresh persistence
- [ ] Accessibility smoke test verifies keyboard submission and story-feed live region behavior
- [ ] Meta-command handler test: `/pause`, `/inspect character`, `/rules` route to deterministic handlers and never invoke the Narrator. Unknown `/` prefix falls through to in-story input.
- [ ] Adopt `docs/reference/example-chat-narrative.md` as a regression fixture. Phase 1 must demonstrate the player cannot author identity changes that bypass adjudication (the "kitchen maid → newspaper editor → heiress" sequence should be visible in `playerCharacterFacts` once Phase 3 ships, and `/canon` should expose the accumulation). Phase 2+ Linter runs must produce a `player_self_contradiction` issue on the contradictory cluster. Phase 4+ Actor must produce in-character pushback when a player presses against a major NPC's declared `traits.boundaries` (validated against the Jaron marriage-proposal turn).

### Phase 1 Completion Criteria

- [ ] `docker compose up` → `npm run dev` → create world → play 20+ turns
- [ ] `npm run lint`, `npm run type-check`, and `npm test` pass
- [ ] Playwright smoke test passes locally
- [ ] Refresh browser — all turns persist
- [ ] Mobile layout is usable
- [ ] Token usage tracked in DB
- [ ] No errors in console during normal play
- [ ] **Play 3 complete story sessions** before starting Phase 2

---

## Phase 2: World Seeding + LLM Wiki Compiler

**Goal**: A new world can begin with usable depth before the first player turn. User seed text and optional simulated expedition logs are treated as immutable source material, then compiled into a persistent wiki, timeline, relationships, and unresolved story threads.

**New agents**: World Seeder, Wiki Compiler, World Linter
**New tables**: world_sources, wiki_pages, timeline_events, relationships, story_threads, memory_chunks
**New dependencies**: `voyageai` (embedding client)

### Step 2.1: Source Documents + Canon Model

- [ ] `world_sources` schema + migration for immutable seed text, generated seed packets, simulated expedition logs, prior adventure logs, and imported lore
- [ ] Add canon metadata to compiled knowledge: `canon_status`, `confidence`, `source_ids`, `last_verified_at`
- [ ] Query functions for creating/listing source documents and linking sources to compiled knowledge
- [ ] Define source types: `user_seed`, `seed_packet`, `expedition_log`, `prior_adventure_log`, `uploaded_lore`, `play_turn`, `system_summary`

### Step 2.2: World Seeder Agent

- [ ] `prompts/world-seeder-system.md`: System prompt template
- [ ] Zod schema for seed packet output
- [ ] `src/lib/ai/world-seeder.ts`: Calls `generateObject()` with Sonnet
- [ ] Seed packet includes world bible, starter locations, factions, NPCs, timeline anchors, mysteries, and initial story threads
- [ ] Seed packet includes initial agenda clocks for major NPCs whose offscreen action would change future locations, factions, or story threads
- [ ] Seed packet includes faction/culture naming styles and structured NPC `nameProfile` values
- [ ] Name generation consults a per-world name registry and penalizes exact or near-duplicate given/family names
- [ ] Persist the seed packet as a `world_sources` row before compiling it into knowledge tables

### Step 2.3: Simulated Expeditions

- [ ] Generate 3-8 scout or historical POV characters for optional world-depth passes
- [ ] Each expedition creates a short adventure log focused on one region, faction, conflict, or rumor
- [ ] Persist each expedition log as immutable `world_sources` material
- [ ] Hard cap expedition count, token budget, and total estimated cost per seeding run
- [ ] Expeditions create history, pressure, rumors, and contradictions; they must not resolve the world's central playable conflict

### Step 2.4: LLM Wiki Compiler

- [ ] `prompts/wiki-compiler-system.md`: Compiler prompt for turning sources into wiki/timeline/relationship/thread candidates
- [ ] Compiler uses the Archivist output schema shape where possible
- [ ] Compiler persists reviewed major NPC agendas as `npc_agendas` rows when Phase 4 schema is available
- [ ] Store compiled entries as `soft` canon by default unless explicitly promoted
- [ ] Preserve source provenance for every compiled wiki page, timeline event, relationship, thread, and memory chunk
- [ ] Extract emotional events, relationship moments, tactical state deltas, and scene summaries from prior adventure logs where supported by source text
- [ ] Embed compiled wiki pages and memory chunks

### Step 2.5: World Linter Agent

- [ ] `prompts/world-linter-system.md`: System prompt template
- [ ] Zod schema for contradiction, duplicate, stale fact, and timeline issue reports
- [ ] `src/lib/ai/world-linter.ts`: Calls `generateObject()` with Haiku
- [ ] Linter flags conflicts without deleting or overwriting source material
- [ ] UI/API path to mark linter findings as accepted, ignored, or converted into intentional mystery

### Step 2.6: Seeding Review UI

- [ ] Seeding screen in world creation flow with progressive status for seed packet, expeditions, compiler, and linter
- [ ] Review queue for accepting, rejecting, or recategorizing generated knowledge
- [ ] Canon controls: `hard`, `soft`, `rumor`, `myth`, `false`, `disputed`
- [ ] First play scene is generated only after review or explicit "accept all soft canon"

### Phase 2 Completion Criteria

- [ ] Creating a seeded world produces 10+ wiki page candidates, 5+ timeline anchors, 3+ factions, 5+ NPCs, and 3+ unresolved story threads
- [ ] Major seeded NPCs with independent goals have draft agenda clocks available for review
- [ ] Every compiled knowledge entry links back to one or more source documents
- [ ] Simulated expeditions enrich the setting without solving the player's main conflict
- [ ] Linter flags at least duplicate-title and contradiction cases in tests
- [ ] Narrator can start play using accepted seeded knowledge

---

## Phase 3: Memory + Knowledge System

**Goal**: The world builds a persistent knowledge base. Wiki pages, timeline, and relationships are auto-extracted from the narrative. Semantic search enables long-term memory.

**New agents**: Archivist
**New tables**: none if Phase 2 is complete
**New dependencies**: none if Phase 2 is complete

### Step 3.1: Archivist Agent

- [ ] `prompts/archivist-system.md`: System prompt template
- [ ] Zod schema for Archivist structured output
- [ ] `src/lib/ai/archivist.ts`: Calls `generateObject()` with Haiku
- [ ] Async execution after narrator turn (non-blocking)
- [ ] Retry logic (up to 2 retries on schema validation failure; **fails open** after that — log and stop, never surface to UI)
- [ ] **Fails-open contract** (see [Agent System Design § Archivist Fails-Open Contract](../specs/agent-system-design.md)): Archivist never blocks the player. The narrator turn is already persisted before Archivist runs.
- [ ] **Cost-cap skip**: if per-world per-session cost cap is within 10% of being hit, skip Archivist extraction for this turn (log `archivist_skipped_cost_cap`)
- [ ] **Skip-on-trivial heuristic**: skip when player action + narrator response < ~150 tokens combined and contain no new proper nouns (log `archivist_skipped_trivial`)
- [ ] **Backfill job** (`archivist:backfill`): re-runs extraction over turns missing `archivist_run_at` timestamp; this is the only retry path beyond the inline 2 retries
- [ ] Persist player/narrator turns as `play_turn` source documents or source references for provenance
- [ ] Extract emotional events, relationship moments, tactical state deltas, and scene-boundary summaries
- [ ] Extract newly established major NPC independent agendas only when criteria are met (see § NPC Agenda Extraction Criteria in [Agent System Design](../specs/agent-system-design.md))
- [ ] Merge tactical state deltas into `scenes.metadata.tactical_state` through deterministic application code

### Step 3.2: Knowledge Table Refinement

- [ ] Confirm Phase 2 knowledge tables support live play extraction
- [ ] Add any missing query helpers for updating wiki pages, timeline events, relationships, story threads, `npc_agendas`, and memory chunks
- [ ] Preserve canon status on updates; gameplay can promote facts to `hard` canon when directly established in play
- [ ] Add query helpers for reading/updating tactical state metadata and scene summaries

### Step 3.3: Embedding Pipeline

- [ ] `src/lib/ai/embeddings.ts`: Embed text → vector
- [ ] Embed memory chunks on creation
- [ ] Embed wiki pages on creation/update
- [ ] Vector similarity search functions

### Step 3.4: Enhanced Context Assembly

- [ ] Update context assembler to include retrieved memories
- [ ] Update context assembler to include relevant wiki pages
- [ ] Update context assembler to include active threads
- [ ] Update context assembler to include visible NPC agenda consequences and exclude hidden offscreen events
- [ ] Update context assembler to always prioritize relationship anchors for present major NPCs above generic retrieved memories
- [ ] Token budget allocation across all source types
- [ ] Relevance score threshold filtering
- [ ] Prefer `hard` canon, include `soft` canon sparingly, and label `rumor`/`myth`/`disputed` entries clearly in narrator context

### Step 3.5: Knowledge Surface (Deferred/Optional)

- [ ] Keep the primary play surface conversation/narration-first
- [ ] Expose wiki, timeline, relationship, thread, and tactical-state data through server actions/query helpers before committing to an always-visible UI
- [ ] Optional later: add inspectable knowledge/timeline surfaces if playtesting shows they help more than they distract

### Phase 3 Completion Criteria

- [ ] Archivist extracts structured data after each narrator turn
- [ ] Wiki/timeline/relationship/thread data is persisted and queryable after relevant narrative events
- [ ] Timeline updates with significant events
- [ ] Scene summaries capture objectives, outcomes, casualties, wounds, resources spent, relationship shifts, and unresolved consequences
- [ ] Tactical state remains consistent beyond the raw turn window
- [ ] Semantic search returns relevant memories for player actions
- [ ] Narrator references facts from 50+ turns ago (beyond raw turn window)
- [ ] Gameplay-established facts can promote seeded soft canon to hard canon

---

## Phase 4: Full Agent Orchestra

**Goal**: The Story Conductor manages pacing, scene transitions, and living-world advancement. NPCs have their own voice via the Character Actor agent. Major NPCs can pursue offscreen agendas so the world changes while the player is elsewhere.

**New agents**: Story Conductor, Character Actor
**New table/columns**: npc_agendas, timeline_events.visibility

### Step 4.1: Story Conductor Agent

- [ ] `prompts/conductor-system.md`: System prompt template
- [ ] Zod schema for Conductor decision output
- [ ] `src/lib/ai/conductor.ts`: Calls `generateObject()` with Haiku
- [ ] Replace hardcoded "always proceed" with conductor decisions
- [ ] Conductor runs BEFORE narrator in pipeline
- [ ] Conductor adjudicates asserted outcomes against authoritative state and emits `resolution`
- [ ] Conductor distinguishes tactical intent, asserted outcomes, cinematic framing, and emotional interiority
- [ ] Conductor advances or preserves in-world deadlines instead of allowing arbitrary time drift
- [ ] Conductor emits `advance_living_world` when travel, downtime, scene transitions, return-to-location, explicit time skips, or multiplayer waits should advance offscreen consequences

### Step 4.2: Living World Advancement

- [ ] `npc_agendas` schema + migration
- [ ] Add `timeline_events.visibility` with `known`, `rumored`, and `hidden`
- [ ] Query helpers for creating, listing, and updating active NPC agendas
- [ ] `src/lib/world/living-world.ts`: deterministic advancement service for simple elapsed-time clock updates
- [ ] Optional LLM structured advancement path for ambiguous agenda outcomes
- [ ] Advance only major NPC agendas by priority and player relevance; do not simulate all NPCs
- [ ] Persist agenda clock changes, status changes, character location patches, timeline events, story thread updates, and memory chunks before narrator context assembly
- [ ] Hidden agenda events are excluded from player-facing narrator context unless discovered or made plausible by the current scene
- [ ] Returning to a location loads visible consequences: absent NPCs, changed control, public rumors, new threats, and resolved/offscreen thread state

### Step 4.3: Character Actor Agent

- [ ] `prompts/actor-system.md`: System prompt template
- [ ] `src/lib/ai/actor.ts`: Calls `streamText()` with Sonnet
- [ ] NPC action insertion into turn history
- [ ] Actor triggered by conductor's `npc_interlude` decision

### Step 4.4: Scene Management

- [ ] Automatic scene transitions (conductor-driven)
- [ ] Scene opening generation (narrator called with scene context)
- [ ] Scene list UI on world dashboard
- [ ] Manual scene creation option
- [ ] Scene transition flow can trigger Living World advancement before the new scene opening is narrated

### Step 4.5: Story Thread Tracking

- [ ] Active threads displayed in context to narrator
- [ ] Thread resolution detection by Archivist
- [ ] Thread data queryable through server actions; visible UI remains optional until conversation-first playtesting says it is needed
- [ ] Story threads can link to NPC agendas through metadata and reflect offscreen progress notes

### Phase 4 Completion Criteria

- [ ] Conductor makes scene transition decisions naturally
- [ ] Player phrasing cannot unilaterally author success in contested actions
- [ ] Time pressure remains consistent across turns and affects available outcomes
- [ ] NPCs speak in their own voice (distinct from narrator)
- [ ] Scene transitions feel organic, not abrupt
- [ ] Story threads are tracked and resolved
- [ ] Major NPC agendas advance during travel/downtime/return-to-location events
- [ ] Returning to a previously visited location can reveal changed NPC locations, rumors, faction control, or completed offscreen actions
- [ ] Hidden offscreen events do not leak into narrator prose before discovery

---

## Phase 5: Multiplayer

**Goal**: Multiple users share a world. AI proxy controls inactive players. Async turn system with notifications.

**New tables**: users, player_characters, notifications
**New dependencies**: `next-auth` (authentication)

### Step 5.1: Authentication

- [ ] NextAuth.js setup (email + OAuth providers)
- [ ] `users` table + migration
- [ ] Auth middleware on protected routes
- [ ] Login/signup pages

### Step 5.2: Multi-User World Sharing

- [ ] `player_characters` table + migration
- [ ] World invitation system
- [ ] World ownership (creator = owner)
- [ ] Character creation for new players joining a world

### Step 5.3: AI Proxy System

- [ ] Proxy mode settings per player character (manual/soft/full)
- [ ] Proxy activation logic (timeout-based)
- [ ] Actor agent with proxy constraints
- [ ] Proxy action UI indicators

### Step 5.4: Async Turn System

- [ ] Turn ordering for multiple players
- [ ] Configurable wait window before proxy activation
- [ ] Conductor evaluates which player should act next

### Step 5.5: Notifications

- [ ] `notifications` table + migration
- [ ] Real-time notification delivery (SSE)
- [ ] Notification types: turn waiting, proxy activated, world invite
- [ ] Notification UI (bell icon, dropdown)

### Phase 5 Completion Criteria

- [ ] Two users can play in the same world asynchronously
- [ ] AI proxy takes over after configurable inactivity
- [ ] Proxy actions respect character personality and constraints
- [ ] Notifications alert players when it's their turn

---

## Phase 6: Polish + Deploy

**Goal**: Production-ready deployment with voice I/O and PWA support.

### Step 6.1: Production Database

- [ ] Migrate to Supabase or managed Postgres
- [ ] Connection pooling setup
- [ ] Database backup strategy
- [ ] Environment-specific configuration

### Step 6.2: Voice I/O

- [ ] TTS integration (ElevenLabs or similar)
- [ ] Voice output toggle per user
- [ ] Voice input via Web Speech API (optional)
- [ ] Audio playback controls

### Step 6.3: PWA

- [ ] `next-pwa` or manual service worker
- [ ] Web app manifest
- [ ] Offline reading mode (cached turns)
- [ ] Install prompt

### Step 6.4: Performance + Cost Optimization

- [ ] Anthropic prompt caching (`cache_control`) for static system prompts
- [ ] Cost tracking dashboard (per-world, per-session)
- [ ] Per-world cost caps with user warnings
- [ ] Response time monitoring

### Step 6.5: Deployment

- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Staging environment
- [ ] Production deployment (Vercel, Railway, or Docker-based)
- [ ] Domain + SSL
- [ ] Error monitoring (Sentry or similar)

### Phase 6 Completion Criteria

- [ ] Application accessible via public URL
- [ ] Voice narration works end-to-end
- [ ] PWA installable on mobile
- [ ] Cost tracking visible to user
- [ ] Error monitoring in place

---

## Dependency Graph

```
Phase 1 ----------------------------------------------------+
  1.1 Scaffolding                                          |
    -> 1.2 Docker + DB                                     |
         -> 1.3 Query Layer                                |
              -> 1.4 World CRUD                            |
              -> 1.5 Narrator Agent                        |
                   -> 1.6 Streaming Endpoint               |
                        -> 1.7 Story Play UI               |
                             -> 1.8 Polish                 |
                                                            |
Phase 2 <---------------------------------------------------+
  2.1 Source Documents ----+
  2.2 World Seeder --------+--> 2.4 LLM Wiki Compiler
  2.3 Expeditions ---------+             |
                                        +--> 2.5 World Linter
                                        |
                                        +--> 2.6 Seeding Review UI

Phase 3
  3.1 Archivist Agent ----+
  3.2 Knowledge Refinement +--> 3.4 Enhanced Context
  3.3 Embedding Pipeline -+             |
                                        +--> 3.5 Knowledge Surface (optional)

Phase 4
  4.1 Conductor ----------+
                          +--> 4.2 Living World
  4.3 Actor --------------+          |
                          +--> 4.4 Scene Management
                          |          |
                          +----------+--> 4.5 Thread Tracking

Phase 5
  5.1 Auth --> 5.2 Multi-User --> 5.3 Proxy System
                                        |
                    5.4 Turn System <---+
                         |
                         +--> 5.5 Notifications

Phase 6
  6.1 Prod DB -----------+
  6.2 Voice -------------+--> 6.5 Deployment
  6.3 PWA ---------------+
  6.4 Cost Optimization -+
```

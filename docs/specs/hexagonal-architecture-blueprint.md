# Chronicles AI — System Design Blueprint (Hexagonal Architecture)

> **What this document is.** The architecture blueprint for Chronicles AI, organized around
> **hexagonal architecture (ports & adapters)** and **separation of concerns**. It describes the
> domain, the boundaries, and the seams precisely enough to **rebuild the system from scratch**
> with clean dependency direction — and, as of the `onion-arch-refactor` branch, it now also
> describes the *realized* layout rather than only the target.
>
> **Status (branch `onion-arch-refactor`, 2026-06-08).** The "onion / hexagonal" refactor this
> document prescribed is **largely complete and merged on this branch**: the layers in §4 are
> physically realized under `packages/server/src/`, the god `/api/chat` route is carved into
> `AdvanceTurn` + `NarratorPort`/`NarrationStream` + a `BackgroundTasks` port + a SIGTERM drain,
> model IDs/pricing live in `infrastructure/llm/`, `composition/container.ts` is the sole adapter
> constructor, and the CI boundary rules (§6.6) are live. The migration tracker in §10 marks what
> is done and what remains.
>
> **This is a PREVIEW branch ("may be discarded").** The architecture below is real and merged on
> the branch, but two things are deliberately **not** done yet: (a) the MongoDB production cutover
> (the Mongoose adapter set + backfill scripts exist, but the live/default store is still SQLite;
> cutover is a manual gate), and (b) deletion of the SQLite adapter (waits for a Mongo soak). Also:
> the planned `apps/web` client split did **not** happen — the React client still lives inside
> `packages/server`; the root `workspaces` glob lists `apps/*` but `apps/` is empty.
>
> The original target stack (Postgres + pgvector + Drizzle + Voyage embeddings + Sonnet narrator)
> is **superseded**: the live store is **SQLite (raw `better-sqlite3`)** with a full **Mongo +
> Mongoose** adapter ready behind a `PERSISTENCE` flag; the narrator is **Grok-4.3**; vector
> retrieval is a no-op slot (Phase 2, unbuilt). Where this doc once said "the shipped 594-line
> route" or "the documented Postgres target," it has been reconciled to that reality.
>
> **How to read it.** §1–§3 establish the domain and the principles. §4 is the core: the layered
> structure with concrete port interfaces. §5 re-frames the turn pipeline as a clean use case.
> §6 covers cross-cutting concerns. §7–§8 cover persistence and the agent system as swappable
> adapters. §9 gives a concrete directory layout. §10 is the migration tracker (now mostly done).
> §11 catalogs the coupling smells this design existed to kill.

---

## 1. The Domain in One Page

Chronicles AI is a **multiplayer interactive-novel engine**. A player types an action in natural
language; a **Narrator** LLM streams back prose; a set of **factual** agents quietly extract
structured world state from that prose so the world stays coherent across hundreds of turns. The
LLM is treated as **stateless** — the system, not the model, decides what is remembered and what
is injected into each prompt.

### 1.1 Ubiquitous language (the glossary the code should speak)

| Term | Definition | Invariants |
|---|---|---|
| **World** | A persistent play instance. Owns everything else. | The aggregate root. All other entities are scoped by `worldId`. |
| **Turn** | One entry in the append-only story log: a player action, a narrator response, an NPC action, or a system event. | **Append-only.** Never edited or deleted after creation. Retries append new turns. |
| **Scene** | A bounded narrative context with a location, mood, pace, and tactical state. | Opened/closed by turn references. "Current scene is sticky" — the protagonist doesn't move without narration depicting travel. |
| **Place** | A named physical location (bar, hospital, street). | Resolved case-insensitively by canonical name. May carry a population profile. |
| **Character** | An NPC or the player. Has `identity` (what it *is*) vs `presentation` (what *appears*). | Exactly one `is_player` per world (single-player). Identity ≠ presentation: equipment/rumor never changes identity. |
| **Memorable fact** | An append-only one-sentence fact about a character, tagged with provenance `[t:N]`. | Never retracted; append-only. |
| **Story dossier** | The playable pressure of the world: **threads** (quests/mysteries/threats), **clues**, **objectives**, **resources**, **timeline events**. | Story pressure lives in structured rows, *not* only in prose. |
| **Memory chunk** | A semantic unit (scene summary, character moment…) embedded for vector retrieval. | Embedded at write time; retrieved by similarity at read time. (Target/Phase 3.) |
| **Reverie** | A charged NPC memory with `match_tags`; "flares" when a scene echoes it. Invisible to the narrator's prose. | Max 3 per NPC, long cooldown. Procedural flaring, not LLM. |
| **NPC agenda** | A long-term NPC goal with a progress **clock** that advances offscreen ("living world"). | Returning to a place should reveal changed circumstances. (Target/Phase 4.) |
| **Authoritative state** | The structured "what is true *now*": time, location, identity, present characters, constraints, tactical state, last resolved outcome. | Ground truth. The narrator may embellish but must never contradict it. |
| **Relationship anchor** | A durable compact memory per (NPC, player) pair: known identity, trust, promises, threats. | Prevents NPCs forgetting who the player is once the intro falls out of context. |

### 1.2 The two halves of the domain — the master separation

This is the **single most important separation of concerns** in the whole system, and the
architecture should make it structurally impossible to violate:

```
   CREATIVE  (writes prose, imagines possibility)        FACTUAL  (extracts truth, enforces canon)
   ─────────────────────────────────────────────        ───────────────────────────────────────────
   Narrator        — streams the story                   Archivist   — prose → structured state
   World Seeder    — invents the world bible             Wiki Compiler / Linter — canon hygiene
   Character Actor — speaks NPC dialogue                  Conductor   — adjudicates outcomes
                                                          Classifier  — labels player intent

   Never ask a creative agent to manage canon.   Never ask a factual agent to write drama.
   Prose is never the source of truth.           Truth is never decided by hallucinated prose.
```

Everything downstream — schemas, prompts, model choice, context budgets — descends from this line.

---

## 2. Why Hexagonal Architecture Here

The *pre-refactor* system failed along predictable axes (catalogued in §11): one HTTP route
orchestrated ~11 concerns and made 5 LLM calls; every module imported `db.ts` and wrote raw SQL;
LLM calls, prompt assembly, Zod parsing, and DB mutations lived together in single files. That made
the system **hard to test in isolation, impossible to swap providers, and fragile under partial
failure**. On the `onion-arch-refactor` branch those violations are resolved (§10); §11 now reads
as the review rubric that keeps them from coming back.

Hexagonal architecture (a.k.a. **ports & adapters**) fixes exactly this by enforcing one rule:

> **The domain depends on nothing. Everything depends on the domain.**
> The domain defines *ports* (interfaces). The outside world provides *adapters* (implementations).
> Dependencies point **inward**.

```
                      ┌─────────────────────── DRIVING (inbound) ADAPTERS ───────────────────────┐
                      │  Next.js route handlers · Server Actions · React UI · CLI scripts · cron  │
                      └───────────────────────────────────┬──────────────────────────────────────┘
                                                           │  call inbound ports (use cases)
                                                           ▼
        ┌────────────────────────────────────────────────────────────────────────────────────────┐
        │                          APPLICATION LAYER  (use cases / orchestration)                  │
        │   AdvanceTurn · CreateWorld · ApplyCorrection · LoadHistory · InspectWorld · SeedWorld    │
        │   — orchestrates domain services + ports; owns transactions; no framework, no SQL, no SDK │
        └───────────────────────────────────────────────┬────────────────────────────────────────┘
                                                         │  uses
                                                         ▼
        ┌────────────────────────────────────────────────────────────────────────────────────────┐
        │                                   DOMAIN CORE  (pure)                                     │
        │  Entities: World, Turn, Scene, Place, Character, Thread, Reverie, NpcAgenda               │
        │  Value objects: AuthoritativeState, Classification, ArchivistPatch, TokenBudget,          │
        │                 ContextBundle, RelationshipAnchor, Occupancy                              │
        │  Domain services (PURE): ContextAssembler, ReverieFlare, OccupancySim, NpcPromotion,      │
        │                 ActionClassifierRules, MemorableFactProvenance, CharacterDedup, WorldClock │
        │  Ports (interfaces only — no implementations live here)                                   │
        └───────────────────────────────────────────────┬────────────────────────────────────────┘
                                                         │  ports implemented by
                                                         ▼
        ┌─────────────────────────────────── DRIVEN (outbound) ADAPTERS ────────────────────────────┐
        │  SQLite repos (live) / Mongo repos (ready) · XaiNarrator · Haiku agents · XaiTts ·          │
        │  SystemClock · ConsoleLogger · ProcessBackgroundTasks   (model IDs + pricing live here)     │
        └────────────────────────────────────────────────────────────────────────────────────────────┘
```

The payoff, concretely (and now realized on this branch):

- **Swap the datastore by writing one new adapter.** Demonstrated: a full **Mongo + Mongoose**
  adapter set sits beside the SQLite one (`infrastructure/persistence/{sqlite,mongo}/`), both
  satisfying the same ports, selected by the `PERSISTENCE` env var in `composition/container.ts`.
  Nothing above `infrastructure/` knows which store is live. (Postgres+pgvector was the old target;
  it is superseded — see §7.)
- **Swap the LLM provider by writing one new adapter.** Model IDs and pricing now live in exactly
  one place (`infrastructure/llm/model-registry.ts` + `pricing.ts`); they are no longer scattered
  string literals, and CI forbids them in `domain/`/`application/`.
- **Test the turn pipeline with zero LLM calls and zero DB** by injecting fakes for the ports.
- **Partial failures are explicit**: the application layer decides what fails open (Archivist)
  vs. what fails closed (Narrator), instead of silent `.catch()` calls.

### 2.1 Separation of concerns is the whole point — hexagonal is just the scaffolding

Ports and adapters are the *mechanism*. The **principle** is **separation of concerns**, and it is
the reason this document exists. A "concern" is an axis of change — *how we speak HTTP*, *how we
store rows*, *which LLM we call*, *what a turn means*, *how we render a prompt*. The rule is simple
and absolute:

> **Every distinct reason-to-change lives in exactly one place, and unrelated reasons never share a
> module.**

When two concerns are fused in one function, three things break at once: a change along one axis
silently risks the other, the pair cannot be tested or swapped independently, and a failure in one
corrupts the other. Every violation this codebase *once* shipped was the *same* mistake — two
concerns sharing a home. The refactor split each of these into its own module (§10); the table
below is preserved as the cautionary record of what the layering rules exist to prevent:

| Fused in the pre-refactor code | The concerns that got tangled | What the fusion cost |
|---|---|---|
| `api/chat/route.ts` | HTTP transport + turn orchestration + 5 LLM calls + DB writes + process/SIGTERM lifecycle | Can't exercise a turn without HTTP + a real DB + live keys; one streaming bug can drop persistence. |
| `archivist.ts` | prompt building + inference + parsing + domain sanitization + SQL writes | The valuable rules (sticky scene, alias merge) are trapped behind both an LLM and a database. |
| `db.ts` + every caller | the persistence mechanism + each caller's domain logic | The schema leaked everywhere; swapping the store touched the whole app; scripts bypassed invariants. |
| `world-state.ts` | DB reads + narrator-prompt rendering | "What does the narrator see?" can only be answered by reading two unrelated halves together. |
| `cost-cap.ts` | budget policy + the storage schema | The budget rule can't change without touching persistence. |

The layering rules in §3 exist to make each of these *structurally impossible*, not merely
discouraged. Keep one test in mind as you build: **if adding a single feature ever forces you to edit
two layers at once, a concern has leaked — stop and re-cut the boundary before writing the feature.**
That discipline, not the diagram, is what this blueprint is asking you to keep.

---

## 3. Layering Rules (the contract)

1. **Domain core is pure.** No `import` of `better-sqlite3`, `ai`, `next`, `fs`, `fetch`, or a
   wall-clock. No I/O. Deterministic given its inputs. This is where every rule in §1.1 lives and is
   enforced.
2. **Ports are interfaces, defined by the domain/application, named for the domain's needs**
   (`TurnRepository`, `Narrator`, `EmbeddingProvider`) — never for the technology
   (`SqliteClient`, `AnthropicSDK`).
3. **Adapters depend inward only.** A repository adapter imports domain types to satisfy a port; the
   domain never imports the adapter. Dependency injection wires them at the edge (a composition root).
4. **The application layer is the only place orchestration and transactions live.** Use cases are
   the script of "what happens"; domain services are the "how" of individual decisions.
5. **Framework code (Next.js, React) is an adapter, not a home for logic.** A route handler
   translates HTTP ↔ use-case call and nothing more. A Server Component reads via a query port; it
   does not write SQL.
6. **All untrusted input crosses a boundary explicitly.** Player text and LLM output are both
   untrusted; sanitization/validation happens at the adapter→domain boundary, once.
7. **Domain logic never sinks into an adapter.** A repository is dumb CRUD — `get`, `append`,
   `upsertByName`. Any rule that *decides* something (resolving a character by name variant, merging
   aliases, freshest-field-wins, the sticky-scene / scene-open-on-move invariant) is a domain service
   the use case runs *before* it hands plain rows to a repository. A `merge` branch or a
   name-resolution heuristic found inside `infrastructure/` is a leaked concern — the most common way
   this architecture quietly rots.
8. **Structure and rendering are different concerns.** The domain produces *structured* values
   (`ContextBundle`, `ArchivistPatch`); serializing them into a provider-specific prompt string or an
   HTTP payload is an adapter's job. The domain must not know the narrator's markdown dialect or an
   HTTP status code.

---

## 4. The Architecture, Layer by Layer

### 4.1 Domain core

#### Entities & value objects

Plain TypeScript types + pure constructors/guards. No persistence concerns, no `id` generation
strategy baked in (the repository assigns ids). Example shape:

```ts
// domain/world/world.ts
export interface World {
  readonly id: WorldId;
  readonly name: string;
  readonly premise: string;
  readonly genre: Genre;
  readonly tone: string;
  readonly setting: SettingDetails;   // clock, deadlines, contentBoundaries, tech limits, region
  readonly status: 'active' | 'archived';
}

// domain/turn/turn.ts — APPEND-ONLY by construction
export type TurnRole = 'player' | 'narrator' | 'npc' | 'system';
export interface Turn {
  readonly id: TurnId;
  readonly worldId: WorldId;
  readonly sceneId: SceneId | null;
  readonly role: TurnRole;
  readonly content: string;
  readonly turnNumber: number;        // per-world display number
  readonly metadata: TurnMetadata;    // usage, classification, resolution, streamError
  readonly createdAt: Timestamp;
}
```

**Value objects worth calling out** (these are where the system's intelligence lives, and they must
be pure so they're trivially testable):

- `AuthoritativeState` — the pinned "truth now" block (time, location, identity, presentation,
  present characters, constraints, tactical state, last resolved outcome).
- `Classification` — `{ stance, inputMode }` describing how to read the player's text (intent vs.
  asserted outcome vs. meta).
- `ArchivistPatch` — the discriminated-union diff the Archivist emits; the domain owns its Zod
  schema and its *application* rules (merge aliases, sticky scene, append-only facts).
- `ContextBundle` — the assembled, budget-checked narrator context.
- `TokenBudget` — the 8K/1K budget with pinned vs. droppable sections.

#### Domain services (pure functions / pure classes)

These were once pure-ish logic entangled with I/O; the refactor extracted them as **pure** services
under `packages/server/src/domain/services/` — this was most of the testability win. The mapping
below names each realized service and the pre-refactor `lib/` file it was carved out of:

| Domain service (now in `domain/services/`) | Responsibility | Carved out of |
|---|---|---|
| `ContextAssembler` | Take state + recent turns + retrieved memories + budget → ordered `ContextBundle`; drop P8→P3 by priority; throw `ContextOverflowError` if pinned sections (system prompt, authoritative state, player action) exceed budget. | scattered across `prompt.ts`, `world-state.ts`, `narrator-guidance.ts` |
| `ReverieFlare` | Score reveries by tag-overlap × intensity → top-K flares. Pure. | `reveries.ts` (`computeReverieFlares`, `canMintReverie`) |
| `OccupancySim` | Deterministic PRNG (cyrb53 + mulberry32) → reproducible crowd snapshot per place. | `place-population.ts` |
| `ActionClassifierRules` | Heuristic stance/mode detection; only escalate to the LLM port when undecidable. | `classifier.ts` |
| `NpcPromotion` | Decide tier transitions (`npc → local → nearby → distant → dormant`) from appearances. | `npc-promotion.ts` |
| `CharacterDedup` | Detect likely-duplicate character rows. | `character-dedup.ts` |
| `MemorableFactProvenance` | Append/strip `[t:N]` provenance. | `memorable-facts.ts` |
| `WorldClock` | Time-band math, deadline advancement. | `world-time.ts`, `daily-loop.ts` |
| `PatchSanitizer` | Normalize an `ArchivistPatch` against existing state (resolve places, merge aliases, detect name reveals, enforce sticky scene). | inside `archivist.ts` (entangled with LLM + DB) |

> **The realized set is larger than this illustrative table.** `domain/services/` also holds
> `name-resolution`, `narrator-guidance`, `scene-transition`, `story-signal`, and `turn-numbering`
> — additional pure decisions carved out of the same god files. All are deterministic and
> unit-tested with no mocks.

> **The move is done:** the old `archivist.ts` mixed (1) prompt assembly, (2) the LLM call, (3)
> parsing, (4) sanitization, and (5) DB writes. Those are now, respectively: a prompt template, a
> structured-agent port call, Zod validation at the boundary, the pure `patch-sanitizer` domain
> service, and an apply step in `AdvanceTurn` that calls repositories. Five concerns, five homes.

#### Ports defined by the domain/application

Ports are **TypeScript interfaces** colocated with the layer that needs them. Group them by role.

> **Realized:** `domain/ports/` holds **20 interfaces** (with an `index.ts` barrel). The 13
> repository ports — world, turn, character, place, scene, dossier, reverie, npc-intent, occupancy,
> tts-cache, correction, usage, memory — plus `clock`, `logger`, `narrator`, `speech-synthesizer`,
> `background-tasks`, and `unit-of-work`. **Every repository method is async** (returns a `Promise`);
> the SQLite adapters wrap their synchronous `better-sqlite3` calls in `Promise.resolve(...)` to
> satisfy the same shape the Mongo adapters need. The signatures below are illustrative shorthand;
> the realized names sometimes differ (see the `TurnRepository` note).

**Outbound (driven) ports — the domain's needs of the outside world:**

```ts
// ── Persistence (one port per aggregate; storage-agnostic) ──────────────
export interface WorldRepository {
  get(id: WorldId): Promise<World | null>;
  create(input: NewWorld): Promise<World>;
  listActive(): Promise<WorldSummary[]>;
  listArchived(): Promise<WorldSummary[]>;
  setStatus(id: WorldId, status: World['status']): Promise<void>;
}

// APPEND-ONLY by construction. Realized method names (turn-repository.ts):
//   insert · recentTurns · turnsBefore · latestUserTurnId · mergeMetadata · incTtsChars.
// There is deliberately NO general update / setMetadata / delete — only append + metadata-merge.
export interface TurnRepository {
  insert(turn: NewTurn): Promise<Turn>;                       // the ONLY write
  recentTurns(worldId: WorldId, limit: number): Promise<Turn[]>;
  turnsBefore(worldId: WorldId, beforeId: TurnId, limit: number): Promise<Turn[]>;
  latestUserTurnId(worldId: WorldId): Promise<TurnId | null>;
  mergeMetadata(id: TurnId, patch: Partial<TurnMetadata>): Promise<void>; // usage stamping only
  incTtsChars(worldId: WorldId, turnId: TurnId, chars: number): Promise<void>;
}

export interface CharacterRepository { /* get/list/upsertByName/merge/appendFact/move */ }
export interface PlaceRepository      { /* getByName/list/upsert/markGeoStatus */ }
export interface SceneRepository      { /* active/open/close/list */ }
export interface DossierRepository    { /* threads/clues/objectives/resources/timeline */ }
export interface ReverieRepository    { /* add/getForCharacters/stampFlared */ }
export interface MemoryRepository     { /* insertChunk/searchSimilar (vector) */ }
export interface UsageRepository      { /* todaysTokens / record */ }

// A transaction boundary the application layer can demand:
export interface UnitOfWork {
  run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>; // BEGIN IMMEDIATE … COMMIT/ROLLBACK
}

// ── LLM & friends (provider-agnostic) ───────────────────────────────────
export interface Narrator {                       // CREATIVE, streaming
  stream(ctx: ContextBundle, opts: GenOpts): AsyncIterable<NarratorChunk>;
}
export interface StructuredAgent<I, O> {          // FACTUAL, structured output
  run(input: I): Promise<{ output: O; usage: TokenUsage }>;
}
export interface EmbeddingProvider { embed(texts: string[]): Promise<number[][]>; } // Phase-2 slot, not yet a port
export interface Geocoder          { resolve(placeName: string, region?: string): Promise<GeoPoint | null>; } // Phase-2 slot
export interface SpeechSynthesizer { synthesize(text: string, voice: VoiceId): Promise<AudioStream>; } // realized

// ── Plumbing ─────────────────────────────────────────────────────────────
export interface Clock  { now(): Timestamp; }     // realized; never read the wall clock in the domain
export interface Logger { /* structured, secret-redacting */ }                       // realized
export interface BackgroundTasks { /* register/drain post-stream work; SIGTERM owner */ } // realized (§5.0)
// (Prompt templates are loaded at runtime; a dedicated PromptRegistry port is not yet broken out.)
```

> **Repositories stay dumb — this is rule 7 made concrete.** The interfaces above are deliberately
> CRUD-shaped. The hard part of the old `applyArchivistPatch` — resolve each character against
> existing rows by name/alias, detect a `reveals_name_of` rename, collapse a merge with
> freshest-field-wins, enforce that a player-location change opens a scene — is **domain logic**, and
> it belongs in pure services (`PatchSanitizer`, a `CharacterResolver`) that the use case runs to turn
> the raw patch into a flat set of row writes. `CharacterRepository.merge(into, from)` then executes
> exactly the two SQL statements it is told to and decides nothing. Reads interleaved with writes
> (resolve-by-name, then upsert) happen in the **use case** inside one `UnitOfWork` — never hidden
> inside a repository, which is how that logic would silently become untestable and storage-locked
> again.

**Inbound (driving) ports — the use cases the outside world is allowed to call** (see §5). The
realized set under `application/use-cases/` is: `AdvanceTurn`, `ApplyCorrection`, `InspectWorld`,
`ListCorrections`, `LoadHistory`, `RecordTtsUsage`, `SummarizeUsage`, `SynthesizeNarration`. (Replay
is handled inside `AdvanceTurn` as an idempotency guard, not a separate use case; world creation /
seeding still flows through Server Actions and has not yet been promoted to a standalone use case.)

### 4.2 Application layer (use cases)

A use case is a class with injected ports and a single public method. It contains the **orchestration
script and the transaction boundaries** — and nothing technology-specific. The crown jewel is
`AdvanceTurn` (§5). The wiring happens in a **composition root**
(`packages/server/src/composition/container.ts`, `server-only`) that constructs adapters and injects
them — the only place where concrete classes meet. It selects the store by the `PERSISTENCE` env var
(default `'sqlite'` via a synchronous `getContainer()`; `'mongo'` via an async `initContainer()` at
boot that dynamically imports the Mongoose adapters, so the SQLite path never loads `mongoose`) and
exposes a typed `Container` of all ports.

```ts
// application/advance-turn.ts
export class AdvanceTurn {
  constructor(private readonly p: {
    worlds: WorldRepository; turns: TurnRepository; scenes: SceneRepository;
    characters: CharacterRepository; dossier: DossierRepository; memory: MemoryRepository;
    reveries: ReverieRepository; usage: UsageRepository; uow: UnitOfWork;
    narrator: Narrator; classifier: StructuredAgent<ClassifyIn, Classification>;
    npcAgent: StructuredAgent<NpcIn, NpcPlan>; archivist: StructuredAgent<ArchivistIn, ArchivistPatch>;
    embeddings: EmbeddingProvider; prompts: PromptRegistry; clock: Clock; log: Logger;
    assembler: ContextAssembler; budget: CostPolicy;
  }) {}

  // returns a stream the inbound adapter pipes to the client; schedules post-stream work
  async execute(cmd: AdvanceTurnCommand): Promise<NarrationStream> { /* see §5 */ }
}
```

### 4.3 Adapters

**Driving (inbound) adapters** translate the outside world into use-case calls and own *no* logic.
All now live under `packages/server/src/`, and request/response shapes are the shared
`@chronicles/contracts` Zod schemas:

- `app/api/chat/route.ts` → parse request, call `AdvanceTurn`, pipe the stream out. (The old
  ~593-line god route is gone; this is now a thin adapter.)
- `app/api/turns/route.ts` → `LoadHistory`.
- `app/api/world-state/route.ts` → `InspectWorld`.
- `app/api/world-correction/route.ts` → `ApplyCorrection`.
- `app/api/world-corrections/route.ts` → `ListCorrections`.
- `app/api/usage/route.ts` → `SummarizeUsage`.
- `app/api/tts/route.ts` → `SynthesizeNarration`; `app/api/tts/record/route.ts` → `RecordTtsUsage`.
- `app/worlds/**/actions.ts` (Server Actions) → world creation, archive/unarchive (not yet promoted
  to standalone use cases — see §4.1).
- `scripts/*.mjs` (copy-world, merge-characters, seed-*, backfill) → should call the *same* use
  cases / repositories rather than bespoke SQL. (Re-pointing all scripts at the application layer is
  the one remaining loose end of step 7 — see §10.)

**Driven (outbound) adapters** implement the ports (all under `infrastructure/`):

- `infrastructure/persistence/sqlite/*` — 14 `*.sqlite.ts` repository classes (one per port) +
  `unit-of-work.sqlite.ts`, each owning its prepared statements; the unit of work wraps multi-step
  writes in `BEGIN IMMEDIATE` (the project's hard-won rule about partial commits). **The sibling
  `infrastructure/persistence/mongo/*` is the realized drop-in** (Mongoose connection, context,
  unit-of-work, `build-mongo-repositories`, `models/index.ts` as the only mongoose-import home, and
  `repositories/*.mongo.ts` + mappers + test-support).
- `infrastructure/llm/model-registry.ts` + `pricing.ts` — the **single** source of model IDs and
  pricing. The narrator-stream adapter is `infrastructure/narrator/narrate-turn.ts` (implements the
  `Narrator` port); the structured-extraction agents call Haiku via the same registry.
- `infrastructure/tts/xai-speech-synthesizer.ts` (`SpeechSynthesizer`),
  `infrastructure/clock/system-clock.ts` (`Clock`), `infrastructure/logging/console-logger.ts`
  (`Logger`), `infrastructure/background/process-background-tasks.ts` (`BackgroundTasks`, SIGTERM
  drain). A geocoder and an embeddings adapter are Phase-2 slots, not yet realized.

---

## 5. The Turn Pipeline as a Use Case (the heart of the system)

This was once a ~593-line route handler. It is now `AdvanceTurn`: one orchestration script that
reads like prose, delegates every decision to a domain service or a port, and makes its failure
modes explicit.

### 5.0 Who owns the stream and the work that trails it (the seam the old route got wrong)

The single hardest coupling in the old `api/chat/route.ts` was *not* the step list — it was that the
response **stream**, the **post-stream persistence**, and the **process-shutdown drain** were all
entangled in one handler, via the AI SDK's `onFinish` callback and a module-scoped
`process.once('SIGTERM', …)` listener that awaited in-flight archivist promises. That is three
concerns (transport, persistence, runtime lifecycle) in one closure. Separating turn *logic* from
turn *transport* meant giving that lifecycle an explicit owner — a value the use case returns, not a
callback the framework owns. This is now realized:

```ts
export interface NarrationStream {
  chunks: AsyncIterable<NarratorChunk>;   // the inbound adapter pipes this to the client
  completion: Promise<TurnResult>;        // resolves AFTER post-stream work (steps 12–18) settles
}
```

- `AdvanceTurn.execute()` starts the narrator stream, returns `chunks` immediately, and internally
  awaits the stream's end to run the post-stream steps — resolving `completion` only once they finish
  (or settle-with-logged-error, since they fail-open). The ordering invariant below thus lives
  *inside the use case*, testable with fake ports, not inside a streaming callback that needs a live
  model to exercise.
- **Background work is owned by the application layer, not the web framework.** A small
  `BackgroundTasks` port (realized as `infrastructure/background/process-background-tasks.ts`) tracks
  the in-flight post-stream promises; the **composition root** is the one place that wires its drain
  to a single `SIGTERM` handler. The use case never imports `process`; the route never reaches into
  archivist internals. (Both did before the refactor.)
- The inbound adapter's only job: pipe `chunks`, and — if the host must guarantee durability before
  exit — register `completion` with `BackgroundTasks`. One concern each.

### 5.1 Ordering — pre-stream vs. post-stream (a load-bearing invariant)

> **Player actions are persisted BEFORE streaming starts; the narrator response AFTER the stream
> completes. Everything factual (Archivist, embeddings, NPC bookkeeping) happens AFTER the stream,
> fail-open.** This is what keeps the player unblocked and the story append-only.

```
AdvanceTurn.execute(cmd):

  ── PRE-STREAM (synchronous, fail-closed) ──────────────────────────────────────
  1. Guard:  meta-command?  → MetaCommandHandler (deterministic, no LLM). return.
  2. Guard:  idempotency — does (player text, latest turns) match a completed turn?
             → ReplayTurn (stream persisted narrator turn back). return.
  3. Guard:  CostPolicy.withinDailyBudget(usage.todaysTokens())?  else → BudgetExceeded.
  4. classifier.run(...)            → Classification {stance, inputMode}   [LLM, cheap]
  5. uow.run: turns.append(player turn, metadata={classification})         [TX]
  6. npcAgent.run(...)              → NpcPlan (updates + planned actions)   [LLM]
             persist intents + NPC state deltas
  7. geocoder/occupancy (deferred, .catch → log): resolve places; OccupancySim snapshot
  8. Load AuthoritativeState (scenes, characters, dossier, anchors, occupancy)
  9. memory.searchSimilar(embed(playerText))   → top-K chunks   [Phase 3+; skipped in MVP]
 10. ContextBundle = assembler.assemble(systemPrompt, authState, scene, threads,
                       anchors, memories, recentTurns, playerAction, TokenBudget)
                     → throws ContextOverflowError if pinned sections overflow

  ── STREAM (fail-closed; this is the only thing the player waits on) ────────────
 11. stream = narrator.stream(ContextBundle, {maxTokens: 1024, temperature: 0.8})
             → return this stream to the inbound adapter immediately;
               accumulate full text + usage as it flushes.

  ── POST-STREAM (scheduled after stream completes; fail-OPEN, never blocks) ─────
 12. uow.run: turns.append(narrator turn, metadata={usage, model}); link to player turn  [TX]
 13. archivist.run(playerText, narratorText, priorState, occupancy)  → ArchivistPatch   [LLM]
 14. patch = PatchSanitizer.sanitize(rawPatch, existingState)        [PURE domain service]
 15. uow.run: apply patch — upsert places/characters, append facts, upsert dossier,
              insert timeline + memory chunks, open/close scene                          [TX]
 16. intentReconciler.run(...) → label each NPC intent staged|modified|ignored|contradicted [LLM]
 17. embeddings.embed(new memory chunks) → memory.store(vectors)    [Phase 3+]
 18. CharacterDedup.check(...) → log candidates
      ↑ steps 13–18 each wrapped so a failure is logged and swallowed; the turn already stands.
```

### 5.2 Why this is better than the god endpoint

- **Each step is a named port call or a pure service** → unit-testable with fakes; the whole
  pipeline is testable end-to-end with *zero* real LLM/DB.
- **Fail-open vs. fail-closed is explicit and centralized** (pre-stream throws; post-stream
  swallows-and-logs) instead of scattered `.catch(() => {})`.
- **Transactions are explicit** (`uow.run`) at each write, honoring the `BEGIN IMMEDIATE` rule, so
  a mid-patch failure can't partial-commit.
- **Provider/model and store choice are invisible here.** Swapping the narrator model or flipping
  SQLite→Mongo (via `PERSISTENCE`) changes a single adapter / the composition root, never this file.
- **Idempotency and meta-commands are guards at the top**, not interleaved with LLM logic.

---

## 6. Cross-Cutting Concerns

### 6.1 Context assembly & the token budget — the most important domain service

The 8K-input / 1K-output budget is the discipline that keeps narrator quality stable past 50 turns.
It must be **one pure function** the rest of the system cannot bypass:

| Priority | Section | ~Tokens | Pinned? | Drop order |
|---|---|---:|:--:|---|
| P1 | System prompt | 500 | **Yes** | never |
| P2 | Authoritative state (time/location/identity/tactical) | 300–600 | **Yes** | never |
| P3 | World premise / boundaries | 200–300 | no | last |
| P4 | Scene + present characters | 300–500 | no | … |
| P5 | Relationship anchors (present NPCs) | 200–500 | no | lowest-relevance first |
| P6 | Active story threads | 200–300 | no | background before urgent |
| P7 | Retrieved memory chunks (vector) | 1000–1500 | no | lowest-score first |
| P8 | Recent raw turns | 2000–2700 | no | **oldest first** |
| P9 | Player action | 100–300 | **Yes** | never |

Rule: truncate from the bottom (P8→P3) until under budget; if P1+P2+P9 alone exceed the budget,
**throw `ContextOverflowError`** — never silently truncate a pinned section. Inputs in, bundle out,
deterministic, no I/O → trivially unit-tested. (Pre-refactor this logic was smeared across three
files and hard to reason about; it now lives in pure domain services.)

**Assembly and rendering are two concerns — keep them apart (rule 8).** `ContextAssembler` returns a
*structured* `ContextBundle` — ordered, budget-checked sections — and stops there. Turning that
bundle into the narrator's literal prompt text (the `## STATE` / `### NEARBY` / `⚡ FLARING SUBTEXT`
markdown) is a provider-specific *rendering* step that belongs next to the LLM adapter (or in a
`PromptRegistry` template), **not** in the domain core. The reason is a clean change-axis split: the
prompt dialect changes when you swap models, while the selection-and-budget logic does not. Keep them
separate and a Grok→Sonnet prompt reformat never touches the domain, and the budgeting stays
unit-testable without asserting on a single character of markdown.

### 6.2 Cost & budget policy

`CostPolicy` (application service) + `pricing` table (adapter) + `UsageRepository`. Every LLM port
call returns `TokenUsage`; the use case stamps it onto `turns.metadata`. The daily cap is checked
once, pre-stream (step 3). Cost is a first-class cross-cutting concern, not a query-time
afterthought.

### 6.3 Prompt management

Prompts stay **git-diffable on disk** (`prompts/*.md`) and are loaded through a `PromptRegistry`
port (cache-then-serve). Templates declare their variables; the application layer fills them. This
keeps creative/factual prompt text out of code and lets prompts evolve without redeploys of logic.

### 6.4 Trust boundaries (security as separation)

- **Player text** is untrusted: it is *intent*, never authority. It crosses into the domain only as
  a `Classification` + a quoted action block; the Conductor/Classifier decides outcomes, the
  narrator describes the *resolved* outcome — never the player's assertion ("I kill the king" is an
  attempt, not a fact). Today's MVP skips this and lets players author outcomes; the re-design
  restores it as a domain rule.
- **LLM output** is untrusted: sanitized before render (XSS) and validated against Zod at the
  adapter boundary before it ever reaches a domain service.
- **Secrets** (API keys, `DATABASE_URL`) live only in adapters/config, never in the domain, never in
  logs (the `Logger` adapter redacts).

### 6.5 Error taxonomy

Domain errors (`ContextOverflowError`, `BudgetExceeded`, `WorldNotFound`, `InvalidPatch`) are
defined in the domain and mapped to transport concerns (HTTP status, UI message) **only in the
inbound adapter**. The domain never throws an HTTP 502.

### 6.6 Boundary enforcement in CI (realized)

The layering rules above are no longer just prose — they are machine-checked. `.dependency-cruiser.cjs`
(with `tsconfig.depcruise.json`) defines **11 named rules**: `domain-points-inward`,
`domain-no-io-or-framework`, `app-imports-domain-only`, `infrastructure-only-via-composition`,
`mongoose-only-in-mongo-adapter`, `better-sqlite3-only-in-sqlite-adapter`,
`model-registry-not-in-domain-or-app`, `client-no-server-layers`, `client-no-native-or-server-sdk`,
`contracts-pure`, and `no-circular`. They are backed by a `server-only` import on every
infra/repo/composition module and by grep guards for the classic regressions. `npm run depcruise`
runs as a `pretest` step, so a cross-layer import fails the build. (This is the realized form of the
self-enforcement demanded in §10.)

---

## 7. Persistence Design (storage-agnostic, then SQLite vs. Mongo)

The domain knows **aggregates and repositories**, not tables. The schema below is the canonical
model; each storage adapter maps it to its own physical form.

```
World (root)
 ├── Turn        (append-only; role, content, turn_number, metadata JSON)
 ├── Scene       (location, mood/pace/focus, tactical_state JSON, open/close turn refs)
 ├── Place       (canonical name, kind, description, geo_status, population profile)
 ├── Character   (is_player, identity vs presentation, traits JSON, memorable_facts, player_notes)
 │     ├── Reverie     (text, match_tags, intensity)         — append-bounded (max 3)
 │     └── NpcAgenda   (goal, clock{progress,max}, secrecy)  — Phase 4 / living world
 ├── Dossier
 │     ├── StoryThread     (kind, status, relevance_tags, stakes)
 │     ├── StoryClue       (thread ref, detail, status)
 │     ├── StoryObjective  (thread ref, status, blocker)
 │     ├── StoryResource   (owner, kind, status)
 │     └── TimelineEvent   (importance 3–5, summary)
 ├── MemoryChunk  (type, content, embedding vector(1024))    — Phase 3 / vector retrieval
 └── WorldCorrection (player correction → archivist reply)
```

**Two adapters, one port set** (both realized; Postgres+pgvector+Drizzle is **superseded** as the
target — the second store is **MongoDB + Mongoose**):

| Concern | SQLite adapter (**live / default**) | Mongo adapter (**ready, behind `PERSISTENCE=mongo`**) |
|---|---|---|
| Driver | `better-sqlite3`, synchronous (wrapped in `Promise.resolve`) | Mongoose, async; replica-set fail-fast at boot |
| IDs / ordering | autoincrement integer | a `counters` collection with atomic `findOneAndUpdate $inc` gives every collection a monotone **integer** id + turn seq — ordering **never** depends on `ObjectId` |
| Shape | 1 table per aggregate; JSON columns as `TEXT` + `JSON.parse` | 15 top-level collections + 2 embedded subdocs |
| Constraints | SQL `CHECK` (importance 1–5, intensity 0–1); `lower(name)` uniqueness | mongoose enums + min/max; normalized `nameKey`/`titleKey` unique indexes per `worldId` |
| Provenance | `[t:N]` tags preserved | `[t:N]` tags preserved |
| Vector search | no-op `MemoryRepository.searchSimilar()` → `[]` (P7 slot) | no-op `searchSimilar()` → `[]` (P7 slot) |
| Transactions | `BEGIN IMMEDIATE` (avoid partial commits) | `UnitOfWork` = `session.withTransaction` |
| Migrations | hand-rolled, run on boot | schema is the Mongoose models; no separate migration step |

Because the application layer only sees `TurnRepository`, `MemoryRepository`, etc., the store swap is
"implement the sibling adapter folder + flip the composition root via the `PERSISTENCE` env var,"
not "rewrite the app" — and that sibling now exists. **Caveat (preview branch):** the Mongo cutover
in production has *not* run; the live/default store remains SQLite, and the SQLite adapter is not
deleted (it waits for a Mongo soak — see §10). Vector retrieval (P7) degrades gracefully in **both**
adapters: `searchSimilar()` returns an empty set and the `ContextAssembler` simply has nothing to
place in P7 (the embedding slot is Phase-2, unbuilt).

---

## 8. The Agent System as Swappable Adapters

Every agent is a port (`Narrator` or a structured-extraction agent); its prompt is a template; its
model is an adapter detail. All model IDs live in `infrastructure/llm/model-registry.ts`:
`NARRATOR_MODEL = 'grok-4.3'` (the narrator/seeder) and `HAIKU_MODEL =
'claude-haiku-4-5-20251001'` (the structured-extraction agents). The roster, with the
creative/factual split and current build status:

| Agent | Port | Half | Model | Schema | Status |
|---|---|---|---|---|---|
| **Narrator** | `Narrator` | Creative | `grok-4.3` | none (prose) | ✅ built |
| **Classifier** | structured | Factual | Haiku | `Classification` | ✅ built (heuristic-first) |
| **NPC Agent** | structured | Creative-ish | Haiku | `NpcPlan` | ✅ built |
| **Intent Reconciler** | structured | Factual | Haiku | `PerIntentResult[]` | ✅ built |
| **Archivist** | structured | Factual | Haiku | `ArchivistPatch` | ✅ built |
| **Region Extractor** | structured | Factual | Haiku | region data | ✅ built |
| **World Generator / Seeder** | structured | Creative | Grok / Haiku | `WorldSeedPacket` | ✅ built |
| **Wiki Compiler** | structured | Factual | → Haiku | `CompiledKnowledge` | ◻ designed |
| **World Linter** | structured | Factual | → Haiku | `WorldLintReport` | ◻ designed |
| **Character Actor** | structured | Creative | → Grok | dialogue/action | ◻ designed |
| **Story Conductor** | structured | Factual | → Haiku | `ConductorDecision` | ◻ stub (`"proceed"`) |

> The narrator-stream adapter is `infrastructure/narrator/narrate-turn.ts`. The Sonnet narrator from
> the old target is superseded by Grok-4.3; `pricing.ts` still carries a `claude-sonnet-4-6` entry
> for cost math on any residual Sonnet calls.

The **Conductor** and **Living World** are *intentional no-op stubs* in early phases — the inbound
shape of `AdvanceTurn` already accounts for them (steps 4 and the optional living-world advance), so
turning them on later adds an adapter, not a pipeline rewrite. This is the "progressive complexity"
principle made structural: **the use-case interface is stable from Phase 1 to Phase 6; capability
grows behind the ports.**

Non-LLM "agents" (`ReverieFlare`, `OccupancySim`, `NpcPromotion`) are **pure domain services**, not
ports — they have no external dependency and must stay deterministic and unit-tested.

---

## 9. Directory Layout (realized)

The project is an **npm-workspaces monorepo** (root `package.json` → `"workspaces":
["packages/*","apps/*"]`, with `tsconfig.base.json` shared and `tsconfig.depcruise.json` for the
linter). All runtime code lives in **`packages/server`**; `apps/` is empty (the `apps/web` client
split was planned but **not** done — the React client still ships inside `packages/server`).

```
packages/
├── contracts/                      # @chronicles/contracts — dependency-light, type:module, deps: zod only
│   └── src/  { chat.ts, corrections.ts, cost.ts, history.ts, world-state.ts, index.ts,
│              pure/sentence-splitter.ts }   # ONE pure util re-export, shared by server TTS + client
│
└── server/                         # @chronicles/server — the Next.js 15 App Router app
    └── src/
    ├── domain/                     # PURE. no next/ai/@ai-sdk/better-sqlite3/fs/fetch/clock imports.
    │   ├── entities/   { character, correction, npc-intent, occupancy, reverie, story,
    │   │                 tts-cache, turn, usage, world, index }   # row TYPE defs moved here off lib/db
    │   ├── services/   # pure domain services
    │   │   { action-classifier-rules, character-dedup, memorable-fact-provenance, name-resolution,
    │   │     narrator-guidance, npc-promotion, occupancy-sim, patch-sanitizer, reverie-flare,
    │   │     scene-transition, story-signal, turn-numbering, world-clock }
    │   └── ports/      # 20 interfaces ONLY (+ index barrel)
    │       { world, turn, character, place, scene, dossier, reverie, npc-intent, occupancy,
    │         tts-cache, correction, usage, memory  (repositories) ;
    │         clock, logger, narrator, speech-synthesizer, background-tasks, unit-of-work }
    │
    ├── application/use-cases/       # orchestration + transactions. no SQL/SDK/framework.
    │   { advance-turn, apply-correction, inspect-world, list-corrections, load-history,
    │     record-tts-usage, summarize-usage, synthesize-narration }
    │
    ├── infrastructure/             # driven adapters. implement ports. ALL model IDs/pricing here.
    │   ├── persistence/sqlite/  { 14× *.sqlite.ts repos, unit-of-work.sqlite.ts }   # live/default
    │   ├── persistence/mongo/   { connection, mongo-context, mongo-unit-of-work,
    │   │                          build-mongo-repositories, models/index.ts (only mongoose home),
    │   │                          repositories/*.mongo.ts + mappers, test-support }  # ready, flagged
    │   ├── llm/        { model-registry.ts, pricing.ts }   # SINGLE source of model IDs + pricing
    │   ├── narrator/   { narrate-turn.ts }                 # NarratorPort → grok narration stream
    │   ├── tts/        { xai-speech-synthesizer.ts }
    │   ├── clock/      { system-clock.ts }
    │   ├── logging/    { console-logger.ts }
    │   └── background/ { process-background-tasks.ts }     # BackgroundTasks port; SIGTERM drain
    │
    ├── composition/   { container.ts }   # the ONLY place adapters meet use cases; server-only;
    │                                     #   selects store by PERSISTENCE env
    │
    ├── app/                        # Next.js — driving adapters ONLY (thin)
    │   ├── api/{chat,turns,usage,world-state,world-correction,world-corrections,tts,tts/record}/route.ts
    │   ├── worlds/…  + actions.ts (Server Actions)
    │   └── page.tsx / layout.tsx
    │
    ├── components/                 # React — presentation only; reads via DTOs, never SQL
    ├── server/render/  { state-block.ts }   # server-side narrator-markdown renderer (driving adapter)
    └── (prompts/  — git-diffable templates, loaded at runtime)

(root)  .dependency-cruiser.cjs · docker-compose.yml (Mongo experimentation, NOT Postgres)
```

The dependency rule is no longer just a convention — it is enforced in CI (§6.6): `domain/` may
import only from `domain/`; `application/` may import `domain/`; `infrastructure/` and `app/` may
import `domain/` + `application/`; nothing imports `app/` or `infrastructure/` except `composition/`.
The client may not import any server layer or native/SDK module; `contracts` stays pure.

---

## 10. Migration Tracker (largely complete on `onion-arch-refactor`)

This was the incremental path from the pre-refactor code. On the `onion-arch-refactor` branch the
structural cleanup (the equivalent of original steps 1–7) is **done and merged**, the boundary is
**self-enforcing in CI**, and the second-store capability is **built but not cut over**. Status is
tracked below against the project's internal phase labels (P0–P7).

> **The separation-of-concerns refactors changed *where* code lives, not what the product does, and
> shipped behind a green test suite (Vitest) with zero behavior change.** The capability work
> (second store, stubbed agents) was kept separate so the architecture cleanup was never held hostage
> to a feature rewrite. Every violation in §11 is eliminated.

**Done (merged on this branch):**

1. **✅ Domain folder + pure services extracted** (P1). `reverie-flare`, occupancy PRNG
   (`occupancy-sim`), classifier rules, `patch-sanitizer`, `memorable-fact-provenance`, `world-clock`,
   `name-resolution`, `scene-transition`, `story-signal`, `turn-numbering`, `narrator-guidance` all
   live in `domain/services/`, unit-tested in isolation. Row TYPE defs moved to `domain/entities/`.
2. **✅ Ports defined + persistence behind repositories** (P2). 20 ports in `domain/ports/`; the old
   `db.ts` is replaced by 14 `*.sqlite.ts` repositories + a `unit-of-work.sqlite.ts` enforcing
   `BEGIN IMMEDIATE`. All repo methods are async.
3. **✅ Context assembly + narrator guidance** extracted to pure domain services with the §6.1 budget
   discipline.
4. **✅ LLM calls behind adapters** (P4). Model IDs + pricing centralized in `infrastructure/llm/`;
   the narrator-stream adapter is `infrastructure/narrator/narrate-turn.ts`. Provider/model choice is
   a single-adapter change.
5. **✅ `AdvanceTurn` carved out of `/api/chat/route.ts`** (P5). The ~593-line god route is gone; the
   route is parse→call→pipe with `NarratorPort`/`NarrationStream`, a `BackgroundTasks` port, and a
   SIGTERM drain. Fail-open/fail-closed is explicit per §5.1.
6. **✅ Other routes/actions converted** (P5–P6): `ApplyCorrection`, `ListCorrections`, `LoadHistory`,
   `InspectWorld`, `SummarizeUsage`, `SynthesizeNarration`, `RecordTtsUsage`. Cost/badge/profile
   derivation moved **server-side via DTOs** (P6) — the client receives derived values, not raw rows.
   Shared request/response shapes live in `@chronicles/contracts`.
7. **✅ CI boundary enforcement stood up** (P7-tooling). `.dependency-cruiser.cjs` with 11 named rules
   + `server-only` imports + grep guards; `npm run depcruise` runs as `pretest` (§6.6).
8. **✅ Second-store adapter built** (P3, code). A full **Mongo + Mongoose** adapter set satisfies the
   same ports behind `PERSISTENCE=mongo`; both stores pass their suites (`npm test` for SQLite,
   `npm run test:mongo` against a real `MongoMemoryReplSet`).

**Remaining (deliberately not done on this preview branch):**

- ◻ **P3 — Mongo production cutover.** The adapter and backfill scripts exist; the live/default store
  is still SQLite. Cutover is a **manual gate** (data backfill + soak), not yet executed.
- ◻ **P7 — delete the SQLite adapter.** Waits for a Mongo soak in production; until then both adapter
  sets are retained side by side.
- ◻ **`apps/web` client split.** Planned but not done — the React client still lives inside
  `packages/server`; `apps/` is empty. The `workspaces` glob already lists `apps/*` for when it lands.
- ◻ **Re-point all `scripts/*.mjs` at the application layer** (the tail of step 7) and **turn on the
  stubbed agents** (Conductor, Wiki Compiler, World Linter, Character Actor, Living World) — each a
  new adapter slotting into an interface the pipeline already exposes.

**The boundary is self-enforcing, as this section demanded.** A directory layout alone does not keep
concerns apart — the next hurried change re-tangles them. The dependency rule from §9 is locked into
CI via `dependency-cruiser` checks that **fail the build** when: `domain/` imports `infrastructure/`,
`app/`, `ai`, `better-sqlite3`, `next`, `fetch`, or a wall-clock; `application/` imports a concrete
adapter instead of a port; anything but `composition/` imports `infrastructure/`; `mongoose` appears
outside the Mongo adapter; `better-sqlite3` outside the SQLite adapter; or a model-ID literal appears
in `domain/`/`application/`. It is paired with the test split from §9 — pure domain tests with **no**
mocks, application tests against **fake ports** — and grep guards for the classic regressions.
**Separation of concerns that a machine doesn't check is a comment, not an invariant** — and comments
rot.

---

## 11. Coupling Smells This Design Existed To Kill

A checklist of what the **pre-refactor** code did and what the rules forbid — now a review rubric to
keep the resolved violations from returning. All but the last two are eliminated on this branch
(✅); the remaining two are known gaps tracked in §10.

| Smell (pre-refactor) | Where it lived | Rule / status |
|---|---|---|
| **God endpoint** — one route did retry, budget, classify, NPC tick, occupancy, narrate, reconcile, archive, apply, dedup (~593 lines, 5 LLM calls). | `app/api/chat/route.ts` | ✅ Route is a thin adapter; orchestration lives in `AdvanceTurn` (§5). |
| **Raw SQL everywhere** — every module imported `db.ts`; type-cast `.get() as Turn`. | `lib/db.ts` + all callers | ✅ Repositories behind ports; domain never sees SQL. |
| **Mixed-concern modules** — `archivist.ts` did prompt + LLM + parse + sanitize + DB write. | `lib/archivist.ts` | ✅ Five concerns → five homes (template, port, boundary validation, `patch-sanitizer`, use-case apply). |
| **Context assembly smeared** across three files; hard to reason about what the narrator saw. | `prompt.ts`, `world-state.ts`, `narrator-guidance.ts` | ✅ Pure domain services with the §6.1 budget table. |
| **Silent `.catch(() => {})`** swallowing failures with no taxonomy. | several routes | ✅ Explicit fail-open (post-stream) vs fail-closed (pre-stream); domain error types. |
| **No transaction boundaries** — multi-step writes could partial-commit. | world creation, patch apply | ✅ `UnitOfWork` (`BEGIN IMMEDIATE` in SQLite; `session.withTransaction` in Mongo). |
| **Model IDs as scattered string literals**; provider lock-in. | seven agent modules + two narrator call sites | ✅ All model IDs + pricing in `infrastructure/llm/`; CI forbids them in domain/app. |
| **Players can author outcomes** ("I kill the king" accepted). | MVP narrator path | ◻ Still open — Conductor/Classifier resolution is a stub (§8). |
| **Scripts reach straight into the DB**, bypassing invariants. | `scripts/*.mjs` | ◻ Still open — re-pointing scripts at the application layer is the tail of step 7 (§10). |

---

### Appendix A — The four non-negotiable invariants (print these on the wall)

1. **The LLM does not remember.** The system selects and injects context; the model is stateless.
2. **Prose is never the source of truth; truth is never decided by prose.** Creative and factual
   agents never cross wires.
3. **Turns are append-only.** Player action persisted *before* the stream, narrator response
   *after*; everything factual happens after, fail-open.
4. **Dependencies point inward.** Domain depends on nothing; adapters depend on the domain; the
   composition root is the only place they meet.

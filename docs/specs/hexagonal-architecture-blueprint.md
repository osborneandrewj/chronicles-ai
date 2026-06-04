# Chronicles AI — System Design Blueprint (Hexagonal Architecture)

> **What this document is.** A re-architecture blueprint for Chronicles AI, organized around
> **hexagonal architecture (ports & adapters)** and **separation of concerns**. It describes the
> domain, the boundaries, and the seams precisely enough to **rebuild the system from scratch**
> with clean dependency direction — instead of the current "god endpoint + raw-SQL-everywhere"
> shape.
>
> It is written against the *actual* shipped system (SQLite, Grok-4.3 narrator + Haiku helpers,
> a 594-line `/api/chat` route, no repository layer) and the *documented* target
> (Postgres + pgvector, Sonnet, Voyage embeddings, an 8K context assembler). Where those two
> disagree, this blueprint takes the documented intent as the goal and the shipped code as the
> thing being refactored away from.
>
> **How to read it.** §1–§3 establish the domain and the principles. §4 is the core: the layered
> structure with concrete port interfaces. §5 re-frames the turn pipeline as a clean use case.
> §6 covers cross-cutting concerns. §7–§8 cover persistence and the agent system as swappable
> adapters. §9 gives a concrete directory layout. §10 is the incremental migration path from
> today's code. §11 catalogs the coupling smells this design exists to kill.

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

The current system fails along predictable axes (catalogued in §11): one HTTP route orchestrates
~11 concerns and makes 5 LLM calls; every module imports `db.ts` and writes raw SQL; LLM calls,
prompt assembly, Zod parsing, and DB mutations live together in single files. This makes the
system **hard to test in isolation, impossible to swap providers, and fragile under partial
failure**.

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
        │  SqlitePort / PostgresPort (repositories) · AnthropicLLM · XaiLLM · VoyageEmbeddings ·      │
        │  NominatimGeocoder · XaiTtsAdapter · SystemClock · PinoLogger                               │
        └────────────────────────────────────────────────────────────────────────────────────────────┘
```

The payoff, concretely:

- **Swap SQLite → Postgres+pgvector** by writing one new adapter. The documented migration becomes
  a config change, not a rewrite.
- **Swap Grok → Sonnet** (or run them side by side) by writing one new `LlmPort` adapter. Model IDs
  stop being scattered string literals.
- **Test the turn pipeline with zero LLM calls and zero DB** by injecting fakes for the ports.
- **Partial failures become explicit**: the application layer decides what fails open (Archivist)
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
corrupts the other. Every violation this codebase shipped is the *same* mistake — two concerns
sharing a home:

| Fused in the code today | The concerns that got tangled | What the fusion costs |
|---|---|---|
| `api/chat/route.ts` | HTTP transport + turn orchestration + 5 LLM calls + DB writes + process/SIGTERM lifecycle | Can't exercise a turn without HTTP + a real DB + live keys; one streaming bug can drop persistence. |
| `archivist.ts` | prompt building + inference + parsing + domain sanitization + SQL writes | The valuable rules (sticky scene, alias merge) are trapped behind both an LLM and a database. |
| `db.ts` + every caller | the persistence mechanism + each caller's domain logic | The schema leaks everywhere; SQLite→Postgres touches the whole app; scripts bypass invariants. |
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

These already exist in the codebase as pure-ish logic but are entangled with I/O. Extract them as
**pure** services — this is most of the testability win:

| Domain service | Responsibility | Currently in |
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

> **Note the move:** today `archivist.ts` mixes (1) prompt assembly, (2) the LLM call, (3) parsing,
> (4) sanitization, and (5) DB writes. In this design those become, respectively: a prompt template,
> an `Archivist` port call, schema validation at the boundary, the pure `PatchSanitizer` domain
> service, and a `applyPatch` step in the use case that calls repositories. Five concerns, five homes.

#### Ports defined by the domain/application

Ports are **TypeScript interfaces** colocated with the layer that needs them. Group them by role.

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

export interface TurnRepository {
  append(turn: NewTurn): Promise<Turn>;          // the ONLY write; no update/delete
  recent(worldId: WorldId, limit: number): Promise<Turn[]>;
  before(worldId: WorldId, cursor: TurnId, limit: number): Promise<Turn[]>;
  latestPlayerAndNarrator(worldId: WorldId): Promise<{ player?: Turn; narrator?: Turn }>;
  attachMetadata(id: TurnId, patch: Partial<TurnMetadata>): Promise<void>; // usage stamping only
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
export interface EmbeddingProvider { embed(texts: string[]): Promise<number[][]>; }
export interface Geocoder          { resolve(placeName: string, region?: string): Promise<GeoPoint | null>; }
export interface SpeechSynthesizer { synthesize(text: string, voice: VoiceId): Promise<AudioStream>; }

// ── Plumbing ─────────────────────────────────────────────────────────────
export interface Clock  { now(): Timestamp; }     // never read the wall clock in the domain
export interface Logger { /* structured, secret-redacting */ }
export interface PromptRegistry { load(name: PromptName): PromptTemplate; } // prompts/*.md
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

**Inbound (driving) ports — the use cases the outside world is allowed to call** (see §5):
`AdvanceTurn`, `ReplayTurn`, `CreateWorld`, `ApplyCorrection`, `LoadHistory`, `InspectWorld`,
`SummarizeUsage`, `SynthesizeNarration`.

### 4.2 Application layer (use cases)

A use case is a class with injected ports and a single public method. It contains the **orchestration
script and the transaction boundaries** — and nothing technology-specific. The crown jewel is
`AdvanceTurn` (§5). The wiring happens in a **composition root** (`src/composition/container.ts`)
that constructs adapters and injects them — the only place where concrete classes meet.

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

**Driving (inbound) adapters** translate the outside world into use-case calls and own *no* logic:

- `src/app/api/chat/route.ts` → parse request, call `AdvanceTurn.execute()`, pipe the stream out.
  (Today: 594 lines doing 11 things. Target: ~30 lines.)
- `src/app/api/turns/route.ts` → `LoadHistory`.
- `src/app/api/world-state/route.ts` → `InspectWorld`.
- `src/app/api/world-correction/route.ts` → `ApplyCorrection`.
- `src/app/api/usage/route.ts` → `SummarizeUsage`.
- `src/app/api/tts/route.ts` → `SynthesizeNarration`.
- `src/app/worlds/**/actions.ts` (Server Actions) → `CreateWorld`, archive/unarchive.
- `scripts/*.mjs` (copy-world, merge-characters, seed-*, backfill) → call the *same* use cases /
  repositories, not bespoke SQL. (Today they reach straight into the DB — they should become thin
  CLIs over the application layer, which is how you guarantee a script can't corrupt invariants the
  app enforces.)

**Driven (outbound) adapters** implement the ports:

- `infrastructure/persistence/sqlite/*` — one repository class per port, each owning its prepared
  statements. A single `SqliteUnitOfWork` wraps multi-step writes in `BEGIN IMMEDIATE` (see the
  project's hard-won rule about partial commits). **A future `infrastructure/persistence/postgres/*`
  is a drop-in sibling.**
- `infrastructure/llm/anthropic.ts`, `infrastructure/llm/xai.ts` — implement `Narrator` and
  `StructuredAgent`. All model IDs and pricing live here, behind the port.
- `infrastructure/embeddings/voyage.ts`, `infrastructure/geocode/nominatim.ts`,
  `infrastructure/tts/xai.ts`, `infrastructure/clock/system.ts`, `infrastructure/log/pino.ts`.

---

## 5. The Turn Pipeline as a Use Case (the heart of the system)

Today this is a 594-line route handler. Re-framed, it is one orchestration script that reads like
prose, delegates every decision to a domain service or a port, and makes its failure modes explicit.

### 5.0 Who owns the stream and the work that trails it (the seam the old route got wrong)

The single hardest coupling in `api/chat/route.ts` is *not* the step list — it is that the response
**stream**, the **post-stream persistence**, and the **process-shutdown drain** are all entangled in
one handler, via the AI SDK's `onFinish` callback and a module-scoped `process.once('SIGTERM', …)`
listener that awaits in-flight archivist promises. That is three concerns (transport, persistence,
runtime lifecycle) in one closure. Separating turn *logic* from turn *transport* means giving that
lifecycle an explicit owner. Make it a value the use case returns, not a callback the framework owns:

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
  `BackgroundTasks` port (`register(p: Promise<unknown>): void`, `drain(): Promise<void>`) tracks the
  in-flight post-stream promises; the **composition root** is the one place that wires its `drain()`
  to a single `SIGTERM` handler. The use case never imports `process`; the route never reaches into
  archivist internals. (Today both do.)
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
- **Provider/model choice is invisible here.** Swapping Grok→Sonnet or SQLite→Postgres changes a
  single adapter, never this file.
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
deterministic, no I/O → trivially unit-tested. (Today this logic is smeared across three files and
hard to reason about.)

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

---

## 7. Persistence Design (storage-agnostic, then SQLite vs. Postgres)

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

**Two adapters, one port set:**

| Concern | SQLite adapter (today) | Postgres adapter (target) |
|---|---|---|
| Driver | `better-sqlite3`, synchronous | `postgres` (postgres-js), async — **never `pg`** |
| IDs | autoincrement integer | UUID |
| JSON columns | `TEXT` + `JSON.parse` | `JSONB` |
| Vector search | none (skip P7) / brute-force | `pgvector`, HNSW index, cosine |
| Transactions | `BEGIN IMMEDIATE` (avoid partial commits) | standard `BEGIN`/serializable where needed |
| Migrations | hand-rolled `migrations.ts` | Drizzle `db:generate` + `db:migrate` |

Because the application layer only sees `TurnRepository`, `MemoryRepository`, etc., the documented
SQLite→Postgres migration is "implement the sibling adapter folder + flip the composition root,"
not "rewrite the app." Vector retrieval (P7) degrades gracefully: the SQLite adapter returns an
empty similarity set and the `ContextAssembler` simply has nothing to place in P7.

---

## 8. The Agent System as Swappable Adapters

Every agent is a port (`Narrator` or `StructuredAgent<I,O>`); its prompt is a template; its model is
an adapter detail. The roster, with the creative/factual split and current build status:

| Agent | Port | Half | Model (today → target) | Schema | Status |
|---|---|---|---|---|---|
| **Narrator** | `Narrator` | Creative | Grok-4.3 → Sonnet 4 | none (prose) | ✅ built |
| **Classifier** | `StructuredAgent` | Factual | Haiku 4.5 | `Classification` | ✅ built (heuristic-first) |
| **NPC Agent** | `StructuredAgent` | Creative-ish | Haiku 4.5 | `NpcPlan` | ✅ built |
| **Intent Reconciler** | `StructuredAgent` | Factual | Haiku 4.5 | `PerIntentResult[]` | ✅ built |
| **Archivist** | `StructuredAgent` | Factual | Claude (`generateObject`) | `ArchivistPatch` | ✅ built |
| **World Seeder** | `StructuredAgent` | Creative | → Sonnet | `WorldSeedPacket` | ◻ designed |
| **Wiki Compiler** | `StructuredAgent` | Factual | → Haiku | `CompiledKnowledge` | ◻ designed |
| **World Linter** | `StructuredAgent` | Factual | → Haiku | `WorldLintReport` | ◻ designed |
| **Character Actor** | `StructuredAgent` | Creative | → Sonnet | dialogue/action | ◻ designed |
| **Story Conductor** | `StructuredAgent` | Factual | → Haiku | `ConductorDecision` | ◻ stub (`"proceed"`) |

The **Conductor** and **Living World** are *intentional no-op stubs* in early phases — the inbound
shape of `AdvanceTurn` already accounts for them (steps 4 and the optional living-world advance), so
turning them on later adds an adapter, not a pipeline rewrite. This is the "progressive complexity"
principle made structural: **the use-case interface is stable from Phase 1 to Phase 6; capability
grows behind the ports.**

Non-LLM "agents" (`ReverieFlare`, `OccupancySim`, `NpcPromotion`) are **pure domain services**, not
ports — they have no external dependency and must stay deterministic and unit-tested.

---

## 9. Proposed Directory Layout

```
src/
├── domain/                         # PURE. no next/ai/better-sqlite3/fetch imports.
│   ├── world/        { world.ts, settings.ts }
│   ├── turn/         { turn.ts, metadata.ts }
│   ├── scene/        { scene.ts, tactical-state.ts }
│   ├── place/        { place.ts }
│   ├── character/    { character.ts, identity.ts, presentation.ts, reverie.ts, npc-agenda.ts }
│   ├── dossier/      { thread.ts, clue.ts, objective.ts, resource.ts, timeline.ts }
│   ├── context/      { authoritative-state.ts, context-bundle.ts, token-budget.ts }
│   ├── services/     # pure domain services
│   │   { context-assembler.ts, reverie-flare.ts, occupancy-sim.ts, npc-promotion.ts,
│   │     action-classifier-rules.ts, patch-sanitizer.ts, character-dedup.ts,
│   │     memorable-facts.ts, world-clock.ts }
│   ├── errors.ts                   # ContextOverflowError, BudgetExceeded, WorldNotFound…
│   └── ports/        # interfaces ONLY
│       { repositories.ts, llm.ts, embeddings.ts, geocoder.ts, tts.ts, clock.ts,
│         logger.ts, prompt-registry.ts, unit-of-work.ts }
│
├── application/                    # use cases. orchestration + transactions. no SQL/SDK/framework.
│   { advance-turn.ts, replay-turn.ts, create-world.ts, seed-world.ts, apply-correction.ts,
│     load-history.ts, inspect-world.ts, summarize-usage.ts, synthesize-narration.ts,
│     cost-policy.ts, meta-command-handler.ts }
│
├── infrastructure/                 # driven adapters. implement ports.
│   ├── persistence/sqlite/   { *-repository.ts, unit-of-work.ts, migrations.ts, prepared.ts }
│   ├── persistence/postgres/ { … sibling, target … }
│   ├── llm/                  { anthropic.ts, xai.ts, model-registry.ts, pricing.ts }
│   ├── embeddings/voyage.ts
│   ├── geocode/nominatim.ts
│   ├── tts/xai.ts
│   ├── clock/system.ts
│   └── log/pino.ts
│
├── composition/                    # the ONLY place adapters meet use cases
│   { container.ts }                # build adapters from env, inject into use cases
│
├── app/                            # Next.js — driving adapters ONLY (thin)
│   ├── api/{chat,turns,usage,world-state,world-correction,tts}/route.ts
│   ├── worlds/{new,[worldId]/play}/…  + actions.ts (Server Actions → use cases)
│   └── page.tsx / layout.tsx
│
├── components/                     # React — presentation only; read via query ports
│   { Chat.tsx, WorldInspector.tsx, … }
│
└── prompts/  (repo root)           # git-diffable templates, loaded via PromptRegistry
    { narrator-system.md, archivist-system.md, archivist-correction.md, npc-agent-system.md, … }

scripts/   # thin CLIs over application/ + repositories — never bespoke SQL
tests/     # mirror src/: domain/ (pure, fast, no mocks) · application/ (fakes for ports) · infra/ (real adapters)
```

The dependency rule is checkable with a lint boundary: `domain/` may import only from `domain/`;
`application/` may import `domain/`; `infrastructure/` and `app/` may import `domain/` +
`application/`; nothing imports `app/` or `infrastructure/` except `composition/`.

---

## 10. Migration Path From Today's Code

The point of this blueprint is to be *recreatable*, but you can also walk the current code toward it
incrementally without a big-bang rewrite. Suggested order (each step independently shippable).

> **Steps 1–7 are pure separation-of-concerns refactors: they change *where* code lives, not what the
> product does, and must ship behind a green test suite with zero behavior change.** Steps 8–9 add
> *capability* (Postgres/pgvector, the stubbed agents) and are deliberately **not** part of fixing the
> coupling — keep them separate so the architecture cleanup is never held hostage to a feature
> rewrite. If you only ever do steps 1–5, you have already eliminated every violation in §11.

1. **Introduce the domain folder & extract pure services first** (no behavior change). Move
   `computeReverieFlares`, occupancy PRNG, classifier rules, `PatchSanitizer`, memorable-fact
   provenance, world-clock math into `domain/services/` and unit-test them in isolation. This is
   pure refactor with the biggest immediate testability payoff.
2. **Define ports + wrap `db.ts` in repositories.** Keep `db.ts` as the SQLite adapter's internals;
   expose `TurnRepository` etc. Add a `SqliteUnitOfWork` enforcing `BEGIN IMMEDIATE`. Route callers
   through repositories.
3. **Extract the `ContextAssembler`** out of `prompt.ts`/`world-state.ts`/`narrator-guidance.ts`
   into one pure service with the budget table from §6.1, and put a test around overflow behavior.
4. **Wrap LLM calls in `Narrator`/`StructuredAgent` adapters.** Centralize model IDs and pricing in
   `infrastructure/llm/`. Now Grok↔Sonnet is a config flip.
5. **Carve `AdvanceTurn` out of `/api/chat/route.ts`.** Move the 11-step orchestration into the use
   case; reduce the route to parse→call→pipe. Make fail-open/fail-closed explicit per §5.1.
6. **Repeat for the other routes/actions** (`CreateWorld`, `ApplyCorrection`, `LoadHistory`,
   `InspectWorld`, `SummarizeUsage`).
7. **Re-point scripts at the application layer.** `merge-characters`, `copy-world`, seeders, and
   backfills call use cases/repositories, not raw SQL.
8. **Stand up the Postgres adapter as a sibling** and the Voyage embedding adapter; flip the
   composition root behind an env flag. Vector retrieval (P7) lights up with no pipeline change.
9. **Turn on the stubbed agents** (Conductor, Seeder, Compiler, Linter, Actor, Living World) one at
   a time — each is a new adapter slotting into an interface the pipeline already exposes.

**Make the boundary self-enforcing, or it will erode.** A directory layout alone does not keep
concerns apart — the next hurried change re-tangles them. Lock the dependency rule from §9 into CI
with an `import/no-restricted-paths` or `dependency-cruiser` check that **fails the build** when:
`domain/` imports `infrastructure/`, `app/`, `ai`, `better-sqlite3`, `next`, `fetch`, or a wall-clock;
`application/` imports a concrete adapter instead of a port; or anything but `composition/` imports
`infrastructure/`. Pair it with the test split from §9 — pure domain tests that use **no** mocks, and
application tests that run the use case against **fake ports**. Add one guard test that greps for the
classic regressions (a `merge`/name-resolution branch under `infrastructure/`, a model-ID string
literal outside `infrastructure/llm/`, prompt markdown outside the renderer). **Separation of concerns
that a machine doesn't check is a comment, not an invariant** — and comments rot.

---

## 11. Coupling Smells This Design Exists To Kill

A checklist of what the current code does and what the target forbids — useful as a review rubric:

| Smell (today) | Where | Target rule |
|---|---|---|
| **God endpoint** — one route does retry, budget, classify, NPC tick, occupancy, narrate, reconcile, archive, apply, dedup (594 lines, 5 LLM calls). | `app/api/chat/route.ts` | Route is a thin adapter; orchestration lives in `AdvanceTurn` (§5). |
| **Raw SQL everywhere** — every module imports `db.ts`; type-cast `.get() as Turn`. | `lib/db.ts` + all callers | Repositories behind ports; domain never sees SQL. |
| **Mixed-concern modules** — `archivist.ts` does prompt + LLM + parse + sanitize + DB write. | `lib/archivist.ts` | Five concerns → five homes (template, port, boundary validation, `PatchSanitizer`, use-case apply). |
| **Context assembly smeared** across three files; hard to reason about what the narrator sees. | `prompt.ts`, `world-state.ts`, `narrator-guidance.ts` | One pure `ContextAssembler` with the budget table. |
| **Silent `.catch(() => {})`** swallows failures with no taxonomy. | several routes | Explicit fail-open (post-stream) vs fail-closed (pre-stream); domain error types. |
| **No transaction boundaries** — multi-step writes can partial-commit. | world creation, patch apply | `UnitOfWork` with `BEGIN IMMEDIATE`; one TX per logical write. |
| **Model IDs as scattered string literals**; provider lock-in. | `chat/route.ts:51`, various `lib/*` | All model IDs + pricing behind LLM adapters. |
| **Players can author outcomes** ("I kill the king" accepted). | MVP narrator path | Player text = intent; Conductor/Classifier resolve; narrator describes resolved outcome. |
| **Scripts reach straight into the DB**, bypassing invariants. | `scripts/*.mjs` | Scripts are thin CLIs over the application layer. |

---

### Appendix A — The four non-negotiable invariants (print these on the wall)

1. **The LLM does not remember.** The system selects and injects context; the model is stateless.
2. **Prose is never the source of truth; truth is never decided by prose.** Creative and factual
   agents never cross wires.
3. **Turns are append-only.** Player action persisted *before* the stream, narrator response
   *after*; everything factual happens after, fail-open.
4. **Dependencies point inward.** Domain depends on nothing; adapters depend on the domain; the
   composition root is the only place they meet.

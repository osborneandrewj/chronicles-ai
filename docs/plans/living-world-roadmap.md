# Living-World Roadmap — Chronicles AI

*Where the app is going: a single player adventures through a small, bounded, **living** world, leaves with a book.*

**Status:** vision roadmap · **Date:** 2026-06-05 · **Versioning:** 0.x (minor = feature milestone, patch = fix — see `docs/RELEASING.md`). This roadmap is the product spine; it sits above the per-milestone docs in `docs/plans/milestones/`.

> Derived from a 6-strand parallel design study of the current codebase (audit + spatial + seeding + director + player-model + book). Architecture vocabulary follows the onion layout (`domain/` entities + pure services + ports, `application/use-cases/`, `infrastructure/` adapters, `composition/`).

---

## 1. North star

A single player explores a small, **hand-defined, bounded** world (first concrete target: a **casino**) via text. The world is populated by "living" NPCs who simulate their own lives — relationships, backstory, drama — and keep living whether or not the player is present. Before the player enters, the world is **seeded** by running the simulation forward so the player walks into a world *with history and ongoing drama*. A narrator/**director** ensures the player always has access to interesting stories with real arcs and **satisfying conclusions**, while still letting them abandon a thread and wander off. The app builds a deep **player profile** from in-world behavior so adventures feel tailored. When an adventure concludes, the player can receive a printed **book** of it, with chapters.

## 2. Strategic decisions (locked 2026-06-05)

1. **Geo: support both as co-equal.** Real-world OSM-anchored worlds stay first-class; bounded designed interiors are added *alongside* via a `spatial_mode` discriminator. The narrator only ever sees one mode per world; geocoding is skipped for interiors, graph injection is skipped for real-world worlds.
2. **Seeding: hybrid (authored substrate + lived simulation).** A cheap generation pass lays the cast + relationships + open threads; a **tiered** forward-sim then *lives* the drama for a few hundred ticks. Target: **< ~$1 and < ~3 min per world.**
3. **Sequencing: walking skeleton first.** v0.2 is one thin end-to-end slice through *all six pillars* (tiny casino → minimal seed → enter & play → conclude → small PDF). Each pillar then gets a depth milestone. Validates the whole loop and the architecture before deepening.

## 3. Current state (what already exists)

| Pillar | Maturity | Reuse note |
|---|---|---|
| 1. Living NPCs | **Substantial** | `npc-agent` (batches *all* NPCs into ONE Haiku call), reveries (deterministic flares), agency tiers + `shouldSkipRoutineTick`, daily loops, intents + reconciler. **The biggest existing asset.** |
| 2. Bounded spatial world | **Partial, pointed wrong** | `places` are flat geocoded *points* (OSM); no zone graph, no adjacency/sightlines. Same-`place_id` ⇒ co-present + mutually omniscient (source of teleport/omniscience bugs). |
| 3. Seeding / pre-sim | **None (designed)** | Pipeline is player-turn-coupled; no headless tick driver, no world-clock advance, **no `character_relationships` table** (the key missing primitive). |
| 4. Narrative director | **Partial, reactive** | Story dossier (threads/clues/objectives/resources/timeline) records arcs *after the fact*; resolves only by accident. No phase machine, no conclusion driver. |
| 5. Player modeling | **Partial, overfit** | `player-profile.ts` is a UI grouping of *character* facts, hardcoded to prod worlds (`minerva/caesar/maya`). No behavioral model of the human. Signals (classifier stance, guidance move-type) are computed every turn and discarded. |
| 6. Book / export | **None** | Canonical assistant-turn prose is publication-grade (player actions already woven in); scenes + threads give chapter boundaries; the TTS pipeline is the artifact-generation precedent. |

**Reframe — the cost fear is beatable.** Naive seeding (one LLM call per NPC per tick) ≈ **$30 + ~4 hrs**. But the NPC tick *already batches all NPCs into one call*, and most ticks are routine. Keep routine ticks **deterministic** (rules/drift/loops — zero tokens), spend LLM only past a **drama threshold**, and seeding lands at **~$0.50–1.00 / a few minutes.**

**Landmines to fix on the way:** (a) OSM real-geo vs designed interiors → `spatial_mode` discriminator; (b) overfit `player-profile.ts` → generic, behavior-derived model; (c) turn-coupled `[t:N]` provenance → a synthetic-tick identity scheme for player-less simulation.

## 4. The dependency spine

```
Walls   →   History   →   Arcs-that-conclude   →   Tailoring   →   Reward
(spatial)   (seeding)        (director)            (player model)    (book)
                       └──── "conclusion signal" threads director → book ────┘
```
The single missing concept that unlocks both endings *and* the book's final chapter: an arc **phase machine** (`setup → rising → climax → resolution → concluded`) plus an explicit **"adventure complete"** event.

---

## 5. Roadmap

### v0.2.0 — The Walking Skeleton: "Enter the Casino, Leave with a Booklet"
**Goal:** the thinnest end-to-end loop through every pillar — prove the architecture and the whole experience, shallow but real. Demo: seed a tiny casino, walk in, play a short arc, type `/finish`, download a little chaptered PDF.

Thin slice per pillar:
- **Spatial (thin):** ~5–8 hand-authored zones (entrance, floor, poker room, bar, cashier, back office) with **adjacency only** (no sightlines yet); `spatial_mode='interior'` (skips geocoding); occupant `zoneId`; `MovementService.resolveMove` enforces legal moves **pre-narration**; new `server/render/spatial-block.ts` injects *current zone + named exits + same-zone occupants* with an authoritative "exits are fixed, don't invent doors" directive.
- **Seeding (thin):** offline `SeedWorld` script — one generation pass creating ~6–10 NPCs + a minimal **`character_relationships`** graph + 2–3 open threads + a handful of `timeline_events` (pre-history), then a few **deterministic** forward ticks (daily loops + relationship drift, **no LLM drama yet**). Player enters a populated casino with *some* history.
- **Director (stub):** `/finish` meta-command + `worlds.concluded_at` marker; pre-seeded threads can reach `resolved`. Full phase machine deferred — arcs ride the existing dossier + soft guidance for now.
- **Player model (stub):** a cold-start **archetype pick** at world creation (e.g. Schemer / Brawler / Diplomat / Explorer) that biases the seed's cast/drama. No per-turn inference yet. De-overfit `player-profile.ts` to generic, structural heuristics (kill the hardcoded world nouns).
- **Book (thin):** pure `buildChapters` (scene-cluster ranges, titled from scene/thread); per-chapter **faithful** Haiku copyedit (strip residual meta, normalize POV/tense — *never* add plot); front matter (title, the player character, dramatis personae, casino map); `@react-pdf/renderer` → cached PDF download. No illustrations/print.

**Exit:** a streamed turn works in the seeded interior casino; movement is legal/authoritative; `/finish` produces a downloadable chaptered PDF; `npm run build`/`type-check`/`test` green; version reads `v0.2.0` on the release branch.

### v0.3.0 — A World With History (seeding depth) — *the headline*
The tiered **forward simulation** that *lives* the drama. `world-clock.advanceTicks`; `classifyTick(snapshot) → {deterministic | dramatic, involvedNpcIds}` (generalizes `shouldSkipRoutineTick` + flares + co-location + intent deadlines); an `LlmDramaPort` (batched, threshold-gated, reuses the NPC-tick batching) resolving dramatic beats; pure `applyRelationshipDrift`; a contradiction-linter final pass; `sim_cursor` for resumability. Hits the **<$1 / <3 min** budget. Player now enters a world with *lived*, emergent history.

### v0.4.0 — Stories That Conclude (director depth)
Promote the dossier to an **arc machine**: add `phase`, `tension` (the arc clock), `foregrounded` + cooldown, and a `thread_cast` join. Pure deterministic `Director` service emits a structured `DirectorBeat` (decision only — the narrator still renders soft subtext); one-foreground invariant + cast-collision guard; **conclusion detection** → real "adventure complete" signal (so the book gets a true final chapter); abandoned threads `conclude-offscreen` (the living world resolves them, surfaced later). `DirectorDecisionPort` seam left for a gated-Haiku "brain" later.

### v0.5.0 — Built For You (player-model depth)
`PlayerModel` entity (continuous traits + affinities + mood) fed by **already-computed** signals (classifier stance, guidance move-type — near-zero added cost) via `update-player-model` as a post-stream, fail-open background task; EWMA/decay + confidence; periodic scene-boundary Haiku rollup. Feeds the seeder (tailored cast) and director (arc prioritization). Internal-only; behavior-derived; honors the no-PII / no-defaulted-orientation rules.

### v0.6.0 — Spatial depth + co-equal geo polish
Sightlines/audibility (cross-zone witnessing — *who can see into the pit from the bar*), multi-floor traversal cost, NPC pathfinding across the graph, dynamic access (a key card unlocking the vault edge), LLM-assisted layout generation behind the validator, and a real token-counting context assembler for large maps. Polish the OSM real-world mode so both spatial modes are genuinely first-class.

### v0.7.0 — The Book, bound (export depth)
EPUB adapter (same `BookExporter` port), AI cover + chapter-head illustrations (one image-gen call from premise), richer appendix (timeline, resolved threads, relationship map), an authored epilogue from the director, and — only if validated — print-on-demand (Lulu/Blurb) behind the port.

> Order after the skeleton follows leverage: **seeding depth** and **director depth** are the heart (lived drama + shapely, concludable stories); spatial/player-model/book depth layer on. Re-sequence freely as play reveals what's most missing.

---

## 6. Key new primitives (introduced across the roadmap)

| Layer | New pieces |
|---|---|
| `domain/entities/` | `Zone`, `SpatialEdge`, `Sightline`, `SpatialGraph`, `Occupant`; `RelationshipGraph`; `DirectorBeat` + arc `phase`; `PlayerModel`; `Book`/`Chapter`/`FrontMatter` |
| `domain/services/` (pure) | `MovementService`, `VisibilityService`, `SpatialProjection`, `GraphValidator`; `classifyTick`, `applyRelationshipDrift`, `world-clock.advanceTicks`; `Director`; `player-signal`; `buildChapters`, `chaptering` |
| `application/use-cases/` | `MovePlayer`, `LoadSpatialView`, `SeedWorldLayout`; `SeedWorld`/`RunSimulation`; `DirectStory`; `UpdatePlayerModel`; `CompileBook` |
| `domain/ports/` | `SpatialGraphRepository`, `RelationshipRepository`, `PlayerModelRepository` (+ read query port), `DirectorDecisionPort`, `LlmDramaPort`, `ManuscriptEditor`, `BookExporter` |
| new tables | `zones`, `spatial_edges`, `sightlines`; `character_relationships`; `thread_cast`; story-thread cols (`phase`/`tension`/`foregrounded`); `player_model` (JSON/world); `concluded_at`, `sim_cursor` on `worlds`; book artifact cache |

## 7. Cost & budget discipline (cross-cutting)
- **Tiered everything:** deterministic by default; LLM only past a drama/phase/drift threshold (the existing classifier-rules-first, reverie-cooldown, archivist `hasRichStorySignal` gates are the templates).
- **Seeding:** < ~$1 / < ~3 min per casino (batched, threshold-gated beats; one generation pass).
- **Director:** pure/deterministic on the critical path (zero added latency); gated Haiku brain only later, firing ~1 turn in 4–6.
- **Player model:** rides already-computed signals; LLM only at scene boundaries.
- **Book:** per-chapter light copyedit (faithful, diff-bounded), never a global rewrite; cache the artifact keyed by turn-range hash.

## 8. Open decisions still to settle (per pillar — recommendations in parens)
- **Spatial:** zone granularity room-level vs sub-zone *(room-level for v1)*; default visibility "your zone only" vs cross-zone witnessing in the first casino *(own-zone for skeleton)*; movement strictly pre-narration authoritative *(yes — it's the point)*.
- **Seeding:** what one "tick" represents (an hour? a time-band?) and target depth (100 vs 300) *(time-band, ~150 for the skeleton)*; relationship graph as a structured table *(yes — required)*; offline script vs queued job + "world warming up" UX *(offline script first)*.
- **Director:** is the director allowed to *force* a climax after a long stall, or only escalate pressure *(tunable; escalate-hard, force-only-after-stall)*; one foregrounded arc vs two *(strictly one to start)*.
- **Player model:** explicit archetype pick vs infer from genre *(archetype pick — one click, big payoff)*; fully internal vs opt-in inspector telemetry *(internal first)*; track moral-lean at all *(as a gameplay trait only, never surfaced in fiction)*.
- **Book:** editorial model Haiku (cheap) vs Grok (voice fidelity) *(one-chapter A/B)*; renderer `@react-pdf` (no Chromium) vs Playwright *(@react-pdf for the Railway image)*; "no new prose, ever" faithfulness rule *(inviolable for v1; epilogue only once a director exists)*.

## 9. Relationship to existing plans
- Supersedes the framing of the older `docs/plans/roadmap.md` (Phase 1–6 MVP plan) for forward work, but reuses its **World Seeder / world-bible / linter** design (`agent-system-design.md §3`) as the *generation* half of hybrid seeding — don't build it twice.
- Converges with the **parked Emergent-NPCs Stage B** dissonance/awakening design (`docs/superpowers/notes/2026-06-02-…`): seeded drama and in-play drama should eventually share one engine.
- Assumes the onion architecture from `ONION_ARCH_REFACTOR.md` as the foundation (use-cases, ports, pure domain services).

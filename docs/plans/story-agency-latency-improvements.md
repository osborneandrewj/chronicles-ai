# Story Arcs, NPC Agency, Spatial Presence & Turn Latency — Improvement Plan

**Status:** implemented (core tracks O/A/M/B3/C1–C4, 2026-08-12) — remaining polish: C5–C6 planning-only/speculative agent, B2 subworld relationship seed, A7 director_state schema, prod Threshold antagonist backfill  
**Branch (recommended):** `feat/director-and-closure` · `feat/travel-with-time` · then `feat/agency-depth` · `feat/turn-latency-a6`  
**Shipped as:** v0.11.0 (MINOR — Director + structured travel + closure + latency instrumentation)  

**Trigger:** 2026-08 live-campaign audit of the only recently played pairs — local **Meridian Directive / Sequence Vigil**, remote **Threshold Accord / Cluster Psi-1** — plus follow-on diagnosis of hub sim-ops leakage and **teleport / pop-in NPCs**.  
**Related plans:**  
- [`plot-lifecycle-continuity.md`](./plot-lifecycle-continuity.md) (implemented — lifecycle invariants; this plan *uses* them)  
- [`thread-bootstrap-and-npc-plans.md`](./thread-bootstrap-and-npc-plans.md) (bootstrap + plan-retry; scene agency mostly fixed)  
- [`turn-latency-and-narrator-pacing.md`](./turn-latency-and-narrator-pacing.md) (Track A0–A5 shipped; **A6 still open**)  
- [`hub-sim-logs-and-antagonist-ops.md`](./hub-sim-logs-and-antagonist-ops.md) (implemented plumbing; local Meridian backfilled 2026-08-12; prod still needs ensure-on-path)  
- [`living-world-roadmap.md`](./living-world-roadmap.md) (north star; Director was v0.4.0; spatial depth v0.6.0)  
- [`dialogue-depth-and-character-voice.md`](./dialogue-depth-and-character-voice.md) (implemented craft; orthogonal to multi-session goals)  
- Archive: [`starship-bounded-world-plan.md`](./archive/starship-bounded-world-plan.md) (deck graph + `npc-movement`; long-jump teleport still present)

**Versioning on ship:**  
- Track A (Director + closure) → **MINOR**  
- Track M (travel with time) → **MINOR** (player-visible spatial law)  
- Track B (agency depth) → **MINOR** (or same minor if stacked with M)  
- Track C (latency) → **PATCH** if pure restructure, **MINOR** if speculative cost policy changes  
- Ops (Mongo `dbName`) → ship with whichever PR touches connection  

---

## Evaluation of this plan (2026-08-12)

### Still correct (keep)

| Claim | Why it still holds |
|---|---|
| Live fixtures are only the four campaigns | Fossils (Scout Vessel, old SQLite) still mislead |
| Scene NPC initiation is healthy | 86–95% stage rates; do not re-open cold-open work |
| Arc payoff is the product hole | ~696 player turns → almost no resolved threads/objectives |
| Director must be pure / deterministic | Structure problem, not “not enough prose” |
| Close harder than open | Over-open / under-close on Meridian + Threshold |
| Speculative full NPC agent is unsafe until write-free | Agent still mutates before return |
| Latency needs instrumentation first | No `prestream_ms` baseline yet |

### Gaps in the original draft (now fixed in this revision)

| Gap | Fix in this doc |
|---|---|
| No **spatial presence** track | **Track M** — travel costs real in-world time; no pop-in |
| Agency depth treated as goals/graph only | Physical movement is half of “alive”; M precedes deep B projects |
| Hub sim-ops treated as fully broken | Local Meridian partially repaired; false-death exit + report path diagnosed |
| `nextPlaceId` long-jump unmentioned | Called out under M1 as a known teleport |
| Transit fields assumed “done” | Documented as **prompt law**, not clock/graph law |
| Ship order over-serialized A before anything spatial | A and M can **parallelize**; both are P0 for felt quality |

### Progress already landed (do not re-do)

| Item | Status |
|---|---|
| Sequence Vigil false-death exit (`you die with him` in dialogue) | **Fixed** — quote strip + conditional death lookahead (`detect-subworld-exit`) |
| Exit metadata includes `reportId` | **Shipped** in `narrate-turn` |
| Antagonist name extract + create-not-promote-senior | **Fixed** in `link-antagonist` |
| Local Meridian backfill: SimRunReport, Lira Voss, player model, operator clearance | **Done** via `scripts/backfill-meridian-sim-ops.ts` |
| Prod Threshold / Psi-1 report + antagonist ensure | **Still open** (A5 + O1) |

### Priority re-rank after travel feedback

Product aims, in felt order for the next ship train:

1. **Stories conclude** (Track A) — without this, every session is infinite open tags.  
2. **Bodies occupy space in time** (Track M) — without this, “living world” reads as stage magic.  
3. **Inner life / projects / graphs** (Track B) — builds on M so projects include *going somewhere*.  
4. **Faster turns** (Track C) — measure, then cut serial work; never block A/M.

---

## Goal

Make the product match four aims for *live* play:

1. **Definite threads with real story arcs** — pressure that rises, pays off, and leaves residue cleanly (not infinite open tags).  
2. **NPCs that feel alive with agency** — scene initiation (already good) + durable projects + **physical presence that moves through space**.  
3. **No teleport / pop-in** — characters change rooms only via journeys that consume **authoritative in-world time**.  
4. **Much faster turns** — cut remaining pre-stream serial work without regressing plan staging.

This is **not** a full living-world rewrite. Scene-level NPC planning is healthy. The gaps are **direction + closure + spatial law + residual latency**.

---

## Live evidence (why this plan exists)

Only these four worlds are treated as product truth:

| Pair | Hub | Subworld |
|---|---|---|
| Local | Meridian Directive | Sequence Vigil |
| Remote | Threshold Accord | Cluster Psi-1 |

### What already works

| Signal | Live data |
|---|---|
| NPC plans fire | 1.3–1.9 intents / player turn |
| Narrator stages plans | 86–95% `staged` |
| Agent runs on recent turns | ~95–100% of last 20 assistant turns |
| Dossier *opens* pressure | All four worlds have active threads |
| Hard fiction can close work | Sequence Vigil: *Sealed Papyrus* resolved + objective completed |
| Transit *fields* exist | `in_transit_to_place_id`, `arrival_world_time`, OFF-SCENE STATE block |
| Bounded topology exists | `place_connections` + `deck-graph` on hubs |

### What fails in play

| Failure | Live data / code |
|---|---|
| Almost no arc payoff | Combined ~696 player turns → **1** resolved thread, **1** completed objective (pre-backfill audit) |
| Thread / objective pile-up | Threshold: **6** active threads; Meridian: **7** active objectives |
| Deadline plots don’t tick | Cluster Psi-1: “Day 3 dusk” vs clock stuck **Day 1 — night** |
| Subworld exit doesn’t bookkeep arcs | Psi-1 left fully open; Meridian exit was false death + incomplete close path |
| Meta-story was wallpaper | Fixed locally for Meridian antagonist; prod still null |
| Long-arc NPC life thin | Hubs: thin `personalGoals`; open subworlds: **0 relationships** |
| **Characters pop into rooms** | Archivist/agent can set `current_place` without journey; `nextPlaceId` **teleports** non-adjacent; ETAs are free-text LLM strings; no deterministic “clock ≥ arrive → land” resolver |
| Pre-stream still multi-LLM | Classifier + NPC agent serial; agent context 3.5–7k tokens |

Legacy worlds are **out of scope** for diagnosis and exit criteria.

## Additional latency audit (2026-08 code trace)

Track C should not jump straight to speculative NPC-agent execution. Current `runNpcAgentTick` is **not write-safe for speculation**: it applies NPC state patches, writes reveries, stamps `last_agent_tick_turn_id`, and inserts `npc_intents` before returning. A6-full therefore needs a draft/commit split first, or it can leak writes on meta/OOC/think turns.

Lower-risk wins exist before that refactor:

| Gap | Current shape | Faster path |
|---|---|---|
| No real server timings | Plan names `prestream_ms` / `ttft_ms`, but code does not persist or emit them | Add timing spans before Track C changes; compare live-shaped medians |
| Classifier starts late | Starts after promotion, recent-turn fetch, open-order + private metadata | Launch after first state read; await only before NPC gate |
| Replay/idempotency reads are serial | Multiple latest-turn reads; duplicate world checks | Replay-context read; reuse insert return id |
| Daily budget scan can grow | Mongo scans today's turn metadata; `createdAt` not indexed | Index + optional rollup |
| Occupancy reuse still costs reads | Same-scene occupancy already in state | Skip builder when valid |
| NPC agent re-loads context | Places, chars, cursor, dossier, reveries, per-NPC outcomes | Parallelize, batch, cast cap |
| NPC prompt is the real payload | 3.5–7k tokens; focused retry can add a second Haiku call | B3 cast cap + planning-only hot path |

---

## Done means (product bar)

A player finishing a short hub session + one subworld run should experience:

1. **At most one foreground arc** heavily pressuring STATE at a time (others compact / background).  
2. **At least one clean closure** when fiction clearly completes a goal (siblings cleaned).  
3. **Subworld exit** marks abandoned arcs (`dormant` / `failed` / conclude-offscreen) rather than eternal actives.  
4. **Hub antagonist** is a real character row linked from the bible; lucidity / act pressure can move without magic phrases only.  
5. **No pop-in:** an NPC who leaves for another room is **absent** until the world clock reaches a structured arrival; then they become present (or radio/off-scene only while en route).  
6. **Bounded multi-room moves** take ≥1 hop and real minutes; living tick does not teleport across the graph.  
7. **Open-subworld cast** has a minimal relationship graph or co-location drama path.  
8. **Time-to-first-token** improved with measured baseline (Track C), without regressing plan staging.  
9. Live regression fixtures against Meridian/Vigil and Threshold/Psi-1 shapes only.

---

## Principles

1. **Director decides; narrator stages; archivist records.** Do not make Grok invent structure that STATE does not own.  
2. **Movement is domain fact; prose only reports it.** Same tiering as living ticks — deterministic travel, LLM only for *why* they walk, not *whether* they arrived.  
3. **Deterministic first, LLM only past a gate.**  
4. **Close harder than open.**  
5. **Scene agency is sacred.** Do not reintroduce cold-open dead zones.  
6. **Onion rules.** Pure services in `domain/`, orchestration in use cases, I/O in adapters; no new god modules in `lib/`.  
7. **Ship in vertical slices.** Each phase playable on Meridian or Threshold.  
8. **Measure on live shapes.** Intent stage rate ≥85%; open-thread count trends down after closure work; illegal place teleports = 0 in sanitizer tests.

---

## Architecture sketch

```
                    ┌─────────────────────────┐
  player turn ──▶   │     AdvanceTurn         │
                    │  (application)          │
                    └───────────┬─────────────┘
                                │
         pre-stream             ▼
         ┌──────────────────────────────────────────┐
         │ resolveArrivals(clock)   (Track M, pure+ │
         │   writes) — land journeys before STATE   │
         │ classify  ∥?  planNpc (Track C)       │
         │ occupancy ∥   planNpc (already)       │
         │ Director.decide(snapshot)  (Track A)     │
         └──────────────────┬───────────────────────┘
                            │ stream Grok
                            ▼
         post-stream (background, fail-open)
         ┌──────────────────────────────────────────┐
         │ archivist patch + place-move sanitizer M │
         │   + close-bias / lifecycle hygiene (A)   │
         │ intent reconciler                        │
         │ living tick (bounded) uses same travel M │
         │ lucidity / player-model refresh (A)      │
         └──────────────────────────────────────────┘

  intent "go to vault" ──▶ TravelService.startJourney
       │                      (graph BFS or open band)
       ▼
  character: en_route + arrive_minutes
       │
       ▼ clock advances
  resolveArrivals ──▶ current_place = dest; clear transit

  Exit subworld ──▶ close-subworld + dossier bookkeeping (A)
                       └── sim report (path exists; ensure always)
```

**Director v1 is pure.** **Travel v1 is pure** (duration + resolve). LLMs propose *intent to move*; domain commits journey rows.

---

## Track overview

| Track | Name | Priority | Est. effort | User-visible |
|---|---|---|---|---|
| **O** | Ops hardening (Mongo dbName) | P0 parallel | S | Stability |
| **A** | Story direction + closure | **P0** | L | Arcs that end |
| **M** | Spatial presence (travel + time) | **P0** | M–L | No teleport NPCs |
| **B** | Agency depth (projects + graphs) | P1 | M | Multi-session motives |
| **C** | Latency (instrument → A6-lite → …) | P1–P2 | M | Faster TTFT |

**Recommended ship order:**  
**O + M1 + A1–A3** (can dual-track M and A) → **A4–A6 + M2** → **B** → **C**.  

Do not block Director on travel or travel on Director — they compose: Director can pressure “Voss is en route to the vault”; travel makes that true in minutes.

---

# Track O — Ops hardening

## O1 — Force Mongo database name

**Problem:** Production `DATABASE_URL` has no path; Mongoose lands in Atlas **`test`**. Fragile and easy to wipe.

**Changes:**
1. `connectMongo` always sets `dbName: process.env.MONGO_DB_NAME ?? 'chronicles'`.  
2. Document in `.env.example`.  
3. One-time **manual** migration plan: copy `test` → `chronicles` on Atlas (or set `MONGO_DB_NAME=test` temporarily until cutover). **Do not auto-migrate prod data in app boot.**

**Tests:** unit on connection options; smoke `initContainer` against local Mongo lands in `chronicles`.

**Risk:** high if deployed without data move — deliberate ops step with backup.

---

# Track A — Story direction + closure

## A1 — Pure Director service (no schema yet)

**Goal:** one foreground pressure decision every turn, deterministic.

**Layer:** `domain/services/director.ts` + entity `DirectorBeat` in `domain/entities/`.

```ts
type DirectorPhase = 'setup' | 'rising' | 'climax' | 'resolution' | 'concluded'

type DirectorBeat = {
  foregroundThreadId: number | null
  phase: DirectorPhase | null
  tension: number              // 0..1 advisory
  guidanceLines: string[]      // soft; narrator may interpret
  suggestResolveThreadIds: number[]
  suggestCompleteObjectiveIds: number[]
  suggestDormantThreadIds: number[]
}
```

**Rules (v1):**
1. Among `status=active` threads, rank with existing `dossier-ranking` (stakes + recency + deadline proximity).  
2. **One foreground:** highest rank becomes foreground; others are “background pressure” (compact one-liners in STATE).  
3. **Tension:** bump when player engages foreground tags / objectives; decay when ignored; stall after M turns → escalate guidance (not force fiction).  
4. **Cap active threats in STATE** to top K (e.g. 2 threats + 1 quest).  
5. Soft guidance only — no hard climax mandates that fight craft-freedom.  
6. **Optional later:** prefer threads whose cast is `en_route` or co-located (depends on M1 fields) — do not block A1 on M.

**Wire:** `narrate-turn.ts` after arrival resolution + state assembly, before `streamText`; `## DIRECTOR` block via `server/render/`.

**Tests:** Threshold 6-threat + Meridian 7-objective fixtures.

**Risk:** low. Fail-open empty beat.

---

## A2 — Objective / thread lifecycle hygiene (deterministic)

**Goal:** finishing work does not leave orphan routes.

**Policies:**
1. Thread → `resolved` | `failed` ⇒ sibling actives complete/fail/dormant per policy.  
2. Last active objective complete ⇒ **suggest** parent resolve.  
3. Vigil regression: papyrus resolved ⇒ route objectives not left active forever.

**Tests:** archivist apply + Vigil-shaped golden fixtures.

---

## A3 — Close-bias archivist (focused second pass)

**Problem:** opens freely; closes rarely.

**Approach:** after main patch, if resolution signal + active rows + no lifecycle close → one focused Haiku (Grok if underfill) with minimal `thread_updates` / `objective_updates` schema. Fail-open; metadata key `archivist_close`.

---

## A4 — Subworld exit bookkeeping

**Goal:** leaving a sim does not freeze eternal actives.

On exit (death, return, abort):
1. Compact outcomes from dossier + sim report.  
2. Active threads → dormant/failed unless resolved.  
3. Active objectives → failed/blocked “left the simulation”.  
4. Optional one hub aftermath thread from report (idempotent).  
5. **Always** run `closeSubworldAndReturn` (report + player model + antagonist) — never bare `returnToHub` alone.  
6. Death exit from prose must stay high-precision (dialogue strip already shipped); prefer archivist `status=dead` as hard gate when present.

**Playtest:** Psi-1-shaped exit; Meridian-style false dialogue must **not** exit (regression).

---

## A5 — Hub meta-story activation

**Goal:** bible stops being wallpaper.

**Work items:**
1. `ensureHubAntagonist` on every hub seed + first hub turn if null.  
2. Prod backfill Threshold Accord (Meridian local already done).  
3. Lucidity v2 signals (medium precision, +1/turn cap).  
4. Act pressure line in hub STATE when awoken.  
5. Onboarding auto-close after N turns + subworld return.  
6. Confirm influence packet on enter-subworld.

---

## A6 — Clock vs deadline (open-world)

**Problem:** Psi-1 Day-3 objective vs Day-1 clock.

**Work items:** fix open-world clock advance; Director deadline uses same minutes; optional turn-count proxy if clock stuck; prefer real clock over a second clock.

**Composes with M:** travel durations and objective deadlines share `narrative-clock` minutes.

---

## A7 — Schema (only if A1 pure tension is insufficient)

Prefer `worlds.director_state_json` before per-thread phase columns.

---

# Track M — Spatial presence (travel with in-world time)

**Product bar:** Characters do not “appear” in rooms. They move like people: leave, are en route for real in-world minutes, then arrive. Narrator stages empty chairs, corridors, radio — never early presence.

## M0 — Inventory (no code change; constrains design)

| Existing | Limitation |
|---|---|
| `in_transit_to_place_id`, `arrival_world_time` | ETA is free-text; no minute authority |
| OFF-SCENE STATE block | Prompt law only; model can still invent arrival |
| NPC agent may set transit | Can also set place without journey |
| Archivist `current_place_name` | Teleport write path |
| `place_connections` + `deck-graph` | Hubs only; living tick uses it |
| `nextPlaceId` | **Teleports** if target not a neighbor |
| `estimateTurnMinutes` / ship clock | Shared time base for M |

## M1 — Structured journeys + arrival resolver (ship first)

**Goal:** transit is clock-law, not prose hope.

### Domain

```ts
// Conceptual — may live as columns on characters and/or a small journey blob
type JourneyCommit = {
  characterId: number
  fromPlaceId: number | null
  toPlaceId: number
  departMinutes: number   // absolute narrative clock
  arriveMinutes: number   // absolute narrative clock
  mode: 'walk' | 'corridor' | 'vehicle' | 'unknown'
}

// Pure TravelService
estimateTravelMinutes({ spatialMode, graph, from, to, mode }): number
startJourney({ character, toPlaceId, clockMinutes, graph }): JourneyCommit | Reject
// Reject: unknown place, already there, no path (bounded), etc.

resolveArrivals({ characters, clockMinutes }): ArrivalWrite[]
// if clockMinutes >= arriveMinutes → current_place = to, clear transit
```

**Persistence (minimal):**
- Prefer extending existing fields: store **arrive as parseable clock** via `minutesToWorldTime(arriveMinutes, { includeClockToken: true })` so ETA always round-trips, **plus** `arrival_minutes INTEGER` (or JSON on character) for authority.  
- Dual-store: SQLite migration + Mongo character fields.  
- If schema churn is painful v1: encode `~HH:MM` only and parse strictly — reject unparseable ETAs rather than trusting LLM strings.

### Wire

1. **Pre-stream** in `narrate-turn` (and living tick): `resolveArrivals` before STATE / agent / Director.  
2. **Sanitizer** on archivist + NPC agent patches:  
   - Setting `current_place` to a different place **starts a journey** (or is rejected if destination unknown).  
   - Direct teleport writes **forbidden** except seed/create and explicit `abort_journey`.  
3. **STATE:** render `en route → Vault (ETA Day 4 — midday (~11:20))` from minutes; hard line: *must not stage as present until arrived*.  
4. **Bounded `nextPlaceId`:** replace long-jump with **one hop toward target** (BFS parent pointer) or stay put; never `return target` when non-adjacent.  
5. **Presence:** `presentCharacters` excludes `en_route` unless this turn’s resolve just landed them.

### Defaults (v1 constants — tunable)

| Mode | Spatial | Duration heuristic |
|---|---|---|
| corridor hop | bounded | 2–5 min per edge |
| multi-hop | bounded | sum of edges (cap e.g. 30 min for small bunker) |
| same settlement | open | 10–30 min band |
| cross-district | open | 1–3 hours band |
| unknown dest | any | reject or long default + off-map situation — **do not invent place** |

### Tests

- Pure: BFS duration; non-adjacent hop ≠ teleport; arrival at exact minute; early clock keeps en_route.  
- Sanitizer: archivist “Reyes is in the vault” while she was in Mess → journey, not instant present.  
- Meridian-shaped: leave Operations → Mess takes ≥1 hop minutes; intermediate turns show OFF-SCENE / en route.  
- Regression: dialogue death strip still holds (orthogonal but same exit surface).

**Risk:** medium — touches agent + archivist + living tick. Ship sanitizer + resolver before multi-hop path lists.

---

## M2 — Multi-hop presence (hub feels walked)

**Goal:** people move room-to-room, not only “in transit” abstractly.

1. Journey stores `remainingPlaceIds: number[]` (path).  
2. Each hop has its own `nextHopArriveMinutes`.  
3. On resolve: advance `current_place_id` to next hop; update `last_known_situation` (“in the south passage”).  
4. Living tick uses **identical** resolver (one motion law for pre-sim and play).  
5. Optional corridor places later — not required if situation string carries “between X and Y”.

**Tests:** 3-room path lands hop-by-hop as clock advances artificially in unit tests.

---

## M3 — Intent → journey (plans + open orders)

**Goal:** agency *uses* space.

1. Planned action with `target_place` / move language → `startJourney` if not adjacent.  
2. Open order “get Reyes” / “wait for Dana” → target starts moving; open-order STATUS uses structured ETA.  
3. Player walk intents (optional same service) — can stay soft v1 if NPC-only is enough.  
4. Director guidance may cite “Voss en route (ETA …)” when M fields present.

**Tests:** plan with target place creates transit; open-order target not present until arrive.

---

## M4 — Explicit cuts (spatial)

- Full continuous coordinates / navmesh — out of scope.  
- OSM street routing — later open-world polish.  
- LLM pathfinding — forbidden.  
- Forcing antagonist into scene by teleport for drama — forbidden; use journey + ETA pressure instead.  
- Subworld open-world detailed graph — M1 bands only until needed.

---

# Track B — Agency depth

Scene initiation is healthy — **do not re-litigate npc-initiation**. Depth = motives + social graph; **physical follow-through is Track M**.

## B1 — Durable NPC projects

1. Require/maintain `personal_goals` / `long_term_agenda` when agency ≥ `local`.  
2. STATE project lines for major present NPCs.  
3. `projectContinuityScore` for Director.  
4. Cap 1–2 heavily detailed project NPCs per turn.  
5. Projects that imply location (“get to the vault logs”) should **start journeys** (M3), not teleport.

## B2 — Subworld relationship bootstrap

**B2a (preferred):** seed deterministic edges + one tension edge on subworld create.  
**B2b:** archivist relationship patches (higher variance).

## B3 — Plan-eligible cast caps

Max ~4 plan-eligible NPCs to Haiku: present + open-order target + foreground cast + highest agency. Rest scenic. **Also** prefer en_route open-order targets (M).

## B4 — Explicit cuts (agency)

- Per-NPC Character Actor LLM — deferred.  
- Voyage embeddings — deferred.  
- S2S voice world engine — out of scope.

---

# Track C — Turn latency

Depends on [`turn-latency-and-narrator-pacing.md`](./turn-latency-and-narrator-pacing.md). A0–A5 shipped.

## C1 — Instrumentation first

`prestream_ms` + span breakdown; classifier method; agent retry count; baseline before C2+.

## C2 — A6-lite

Start classifier after first state read (parallel with promotion / recent turns); agent still gated on classification. No write-semantic change.

## C3 — Pre-stream read/write cleanup

Replay-context turn read; insert return id; occupancy skip; Mongo `createdAt` index; optional usage rollup.

## C4 — Agent / narrator context shrink

B3 cast cap; batch intent outcomes; parallelize agent reads; Director + M OFF-SCENE already bound pressure.

## C5 — Planning-only NPC hot path

Pre-stream write-free `planNpcActions`; post-stream durable NPC updates. Prerequisite for safe speculation.

## C6 — Speculative planNpc // classify

Only after C5. Discard on meta/think/OOC; record usage.

## C7 — Measure

Median prestream on Meridian-shaped turn **≥25%** better vs C1 baseline, or document deferral.

**Note:** M1 `resolveArrivals` is pure + cheap writes — must not become a new serial tax; batch character updates in one unit of work.

---

# Implementation order (recommended PRs)

| PR | Contents | Version |
|---|---|---|
| **PR0** | O1 Mongo dbName + ops cutover checklist | patch / ops |
| **PR1** | **M1** TravelService + arrival resolver + sanitizer + fix `nextPlaceId` teleport | minor |
| **PR2** | A1 Director pure + STATE/guidance | minor |
| **PR3** | A2 lifecycle hygiene + Vigil orphan tests | minor |
| **PR4** | A3 close-bias archivist | minor |
| **PR5** | A4 subworld exit bookkeeping + ensure close always reports | minor |
| **PR6** | A5 antagonist ensure-on-hub-turn + prod Threshold backfill | minor |
| **PR7** | A6 clock/deadline + shared minutes with travel | patch/minor |
| **PR8** | **M2–M3** multi-hop + plan/open-order → journey | minor |
| **PR9** | B1–B3 agency depth | minor |
| **PR10** | C1–C4 latency instrumentation + cleanup + A6-lite + shrink | patch/minor |
| **PR11** | C5–C6 planning-only + safe speculative agent if still needed | minor |

Each PR: `depcruise`, `type-check`, `npm test`, `npm run test:mongo`; browser stream on Meridian or Threshold.

**Parallelism:** PR1 (M1) and PR2 (A1) can develop in parallel branches; merge order either way is fine if both touch `narrate-turn` carefully (arrivals **before** Director/STATE).

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Director v1 LLM? | **No** — pure | Structure/closure gap, not prose volume |
| Force climax fiction? | **No** — escalate + lifecycle | Craft-freedom |
| Close-bias model | Haiku first, Grok if underfill | Cost vs reliability |
| Schema for phase/tension | **Defer**; world JSON if needed | Avoid dual-store churn |
| **Travel authority** | **Minutes on narrative clock** | Free-text ETA failed in practice |
| **Teleport writes** | **Sanitize / convert to journey** | Prompt-only OFF-SCENE is insufficient |
| **Bounded long-jump** | **Remove** (`nextPlaceId` hop-only) | Starship plan admitted teleport; now product-visible |
| Agency focus | Depth + **space** + graph | Initiation already works |
| Latency vs story vs space | **A + M before deep C** | Felt quality > speculative A6 |
| Speculative NPC agent first? | **No** | Writes before return |
| NPC hot-path shape | **Planning-only pre-stream** | Durable updates not needed for TTFT |
| Live fixtures | Four campaigns only | Fossils mislead |
| Mongo dbName | Default `chronicles` | Stop writing prod to `test` |
| Meridian antagonist backfill | **Done locally**; keep script | Prod still needs A5 |

---

## Explicit cuts

- Full living-world 300-tick pre-sim depth — roadmap later  
- Embeddings / Voyage memory — Phase 2  
- Book / PDF export depth  
- Per-NPC dialogue agent  
- Speculative agent **with** writes before classify  
- Auto Atlas `test` → `chronicles` in app boot  
- Re-balancing fossil worlds  
- Continuous coordinates / OSM routing  
- LLM pathfinding  

---

## Accepted tradeoffs

- **Director caps hide some DB threads from STATE.** Mitigate with background one-liners + inspect.  
- **Close-bias can mis-close.** Fail-open; correction channel.  
- **Exit bookkeeping marks abandons.** Copy should say “left unresolved,” not moral failure (unless death).  
- **Cast caps** reduce multi-NPC omniscience; sharper voices.  
- **Travel delays can frustrate** if ETAs are too long — keep bunker hops short (minutes, not hours).  
- **Open-world bands are coarse** — better than teleport; refine later.  
- **Sanitizer may block “cinematic” instant arrivals** — require journey with 0–1 min only when adjacent; never cross-map.  
- **Speculative agent** (if shipped) burns rare OOC tokens.

---

## Test plan

### Pure / unit
- Director foreground + stall + caps  
- Lifecycle hygiene (Vigil orphans)  
- Close-bias gate matrix  
- `concludeSubworldDossier`  
- Lucidity v2 table  
- Plan-eligible cast selection  
- **Travel estimate / start / resolve / hop**  
- **nextPlaceId never long-jumps**  
- **Patch sanitizer place teleports**  
- Timing spans + occupancy skip + dbName  

### Integration
- Archivist close pass dual-store  
- ReturnToHub / close-subworld dossier + **report always written**  
- ensureHubAntagonist idempotent  
- **Arrival across a turn boundary with clock bump**  

### Play / browser
1. Meridian investigation — Director foreground; **NPC leaves room and is absent until clock advances**.  
2. Resolution beat — close + sibling clean.  
3. Psi-1-shaped exit — no eternal actives; report present.  
4. Plan stage rate smoke ≥85%.  
5. Antagonist linked on hub (local + after A5 prod).  
6. False-death dialogue in subworld **does not** yank to hub.

---

## Exit criteria (plan complete)

1. Long hub session: **one primary STATE arc**; inspect may list more.  
2. ≥1 deliberate closure in playtest; no orphan actives on that thread.  
3. Subworld exit: no indefinite naked `active` quests.  
4. Live-style hubs: non-null `antagonist_character_id` after ensure.  
5. Lucidity can leave 0 without exact “this isn’t real.”  
6. NPC stage rate ≥85% on 20-turn sample.  
7. **Zero illegal place teleports** in sanitizer suite; Meridian playtest shows en-route absence.  
8. Bounded living tick: no multi-room single-tick jumps.  
9. Median pre-stream improved after Track C (or documented deferral).  
10. `depcruise`, `type-check`, `test`, `test:mongo` green.  
11. Version bumped per `docs/RELEASING.md`; archive plan when shipped.  
12. Prod Mongo not on accidental `test` DB.

---

## Appendix A — Live campaign quick reference

```
Local  Meridian Directive   hub    investigation + backfilled report/Lira Voss (2026-08-12)
Local  Sequence Vigil       sub    ~270 player turns; papyrus resolved; false-death exit fixed in code
Prod   Threshold Accord     hub    ~250 player turns; 6 threads open; antagonist still null until A5
Prod   Cluster Psi-1        sub    ~135 player turns; deadline plot; clock stuck risk (A6)
```

## Appendix B — Code surfaces (starting map)

```
domain/services/director.ts                 NEW — A1
domain/entities/director-beat.ts            NEW
domain/services/travel.ts                   NEW — M1 estimate/start/resolve
domain/services/npc-movement.ts             EDIT — hop-only, no long-jump
domain/services/closed-dossier.ts           EDIT — A2 hygiene
domain/services/lucidity.ts                 EDIT — A5 v2
domain/services/link-antagonist.ts          DONE (create-by-name)
domain/services/detect-subworld-exit.ts     DONE (dialogue strip)
domain/services/npc-promotion.ts            EDIT — B3 cast selection
domain/services/narrative-clock.ts          EDIT — shared minutes A6/M
application/use-cases/return-to-hub.ts      EDIT — A4
application/use-cases/close-subworld…       EDIT — A4 always report
application/use-cases/ensure-hub-antagonist.ts  wire A5
application/use-cases/tick-living-world.ts  EDIT — M1 same resolver
application/use-cases/advance-turn.ts       EDIT — C timing / replay
infrastructure/narrator/narrate-turn.ts     EDIT — arrivals, Director, close-bias, C
infrastructure/persistence/mongo/connection.ts  EDIT — O1
server/render/state-block.ts                EDIT — Director + journey ETA from minutes
lib/archivist.ts                            EDIT — close pass + place sanitizer → domain over time
lib/npc-agent.ts                            EDIT — journey commits, B1, cast cap, C5
prompts/archivist-system.md                 EDIT — close + no teleport
prompts/npc-agent-system.md                 EDIT — projects + journey honesty
scripts/backfill-meridian-sim-ops.ts        DONE local; pattern for prod Threshold
```

## Appendix C — What not to optimize first

- Bigger “be more plotty” narrator prompts without Director.  
- More simultaneous threads.  
- Fossil world rebalancing.  
- Memory embeddings before closure.  
- Stronger “don’t teleport” prompts without M1 sanitizer + resolver.  
- Speculative agent before planning-only split.

## Appendix D — Travel vs existing OFF-SCENE (migration note)

Today STATE already says *do not contradict transit / ETA*. M1 does not remove that block; it **makes the fields true**:

1. LLM may still *propose* `in_transit_to` + soft ETA.  
2. Domain **recomputes** arrive minutes from graph/bands.  
3. Resolver **lands** characters; agent/archivist cannot skip the queue.  
4. After M1, free-text-only ETA without minutes is ignored or repaired.

---

## Appendix E — One-page evaluation summary

| Track | Original plan quality | After travel fold-in |
|---|---|---|
| A Director/closure | Strong, correctly prioritized | Unchanged core; exit/report hardened |
| B Agency depth | Incomplete without space | Depends on M for physical follow-through |
| C Latency | Good; A6 correctly deferred | Unchanged; arrivals must stay cheap |
| O Ops | Necessary | Unchanged |
| **M Travel** | **Missing** | **P0 peer to A** |

**Verdict:** The original plan was right about arcs and latency sequencing, under-specified about **bodies in space**, and slightly stale on Meridian sim-ops (now partially repaired). This revision keeps A/C/O, elevates spatial law to **Track M**, and reorders PRs so Meridian play can stop pop-in without waiting for full Director depth.

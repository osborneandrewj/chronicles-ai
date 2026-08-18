# Turn Latency + Narrator Pacing — Implementation Plan

**Status:** A0–A5 + A6-lite shipped (v0.4.0). C5 write-free planner + C6 speculative plan∥classify on `feat/turn-latency-ttft`. Track B still open.
**Shipped on:** `feat/voice-ttfa-and-turn-latency` (merged).
**Scope:** three tracks — (A) cut time-to-first-token on the narrator turn, (B) narrator quality/pacing beyond the already-shipped NPC-initiation work, (C) time-to-first-**audio** (the gap between finished prose and voice).

## Framing

These two tracks are separable but share a surface: `infrastructure/narrator/narrate-turn.ts` is where the turn is assembled, and both the latency problem and the pacing levers live in it. Track A is pure restructuring with **no behavior change** — every value the narrator sees must be byte-identical afterward. Track B is deliberate behavior change. **Land A first**, so B's prompt/guidance changes are evaluated against a fast turn rather than a slow one.

### Prerequisite (prod split-brain)

| Bug | Status |
|---|---|
| Reverie read via SQLite while stamp writes Mongo | **Fixed in v0.4.0** — `reveries.forCharacters` port |
| World-correction `getNarratorWorldState` SQLite twin | **Fixed in v0.4.0** — `getNarratorWorldStateVia` |
| Full A0 twin deletion + depcruise fence | **Done** (this branch) |

### Cross-cutting facts

- Tests are flat in `packages/server/tests/`, not colocated.
- Two persistence adapters stay at parity: `persistence/sqlite/` + `persistence/mongo/` + the port + the Mongo mappers.
- Gates before each PR: `npm run depcruise`, `npm run type-check`, `npm test`, `npm run test:mongo`.
- If `better-sqlite3` fails with a `NODE_MODULE_VERSION` mismatch, run `npm rebuild better-sqlite3` — it's a Node-upgrade artifact, not a regression.
- **Definition of done for Track A: a turn streamed end-to-end in the browser**, per AGENTS.md. Unit tests cannot prove a latency change.

---

# Track A — Time-to-first-token

## Current pre-stream chain

Every step below is `await`ed in sequence before `streamText` is called at `narrate-turn.ts:326`.

| # | Line | Operation | Cost |
|---|---|---|---|
| 1 | 113 | `worlds.getWorld` | 1 rt |
| 2 | 119 | `getNarratorWorldStateVia` #1 | 8 sequential rt |
| 3 | 124 | `characters.recordAppearancesAndAutoPromote` | write |
| 4 | 130 | `classifyAction` | **LLM (Haiku)** |
| 5 | 139 | `resolveUnresolvedPlaces` | **network geocode, 0–12s** |
| 6 | 145 | `getNarratorWorldStateVia` #2 | 8 sequential rt |
| 7 | 146 | `turns.recentTurns(worldId, 4)` | 1 rt |
| 8 | 155 | `runNpcAgentTick` | **LLM (Haiku), +1 retry possible** |
| 9 | 175 | `buildPlaceOccupancySnapshotVia` | several rt + write |
| 10 | 186 | `getNarratorWorldStateVia` #3 | 8 sequential rt |
| 11 | 210 | `reveries.stampFlared` | write |
| 12 | 232 | `timelineReader.recentSimEvents` (bounded only) | 1 rt |
| 13 | 252 | `turns.recentTurns(worldId, 16)` | 1 rt |
| 14 | 280–286 | `sessions.byWorld` + `worlds.getWorld(hub)` (subworld only) | 2 rt |

**≈30 sequential round-trips + 2–3 LLM calls + 1 geocode before the first token.** On SQLite the round-trips are in-process and near-free; on Mongo (production) each is a network hop. This plan targets the Mongo profile.

---

### A0 — Delete the SQLite-direct twins *(enabler, do first)*

**Problem:** `lib/` holds duplicate implementations of already-ported functions, distinguished only by a `Via` suffix: `getNarratorWorldState` / `…Via`, `getFullWorldState` / `…Via`, `buildPlaceOccupancySnapshot` / `…Via`. Both prerequisite bugs are call sites that picked the wrong twin. Track A rewrites this exact call chain — doing it with two live twins invites a third instance.

**Layer:** `lib/` deletion + call-site updates. No new logic.

**Changes:**
1. Repoint the remaining non-`Via` call sites (`app/api/world-correction/route.ts:14`, `app/api/world-state/route.ts` uses the `Via` form already — verify each).
2. Delete `getNarratorWorldState`, `getFullWorldState`, `buildPlaceOccupancySnapshot` and their now-unused `lib/db` reader imports.
3. Drop the `Via` suffix from the survivors — with the twin gone the suffix is noise. Mechanical rename.
4. **Close the hole that allowed this:** the 6 domain ports importing types from `lib/` (`character-repository.ts:1`, `place-repository.ts:1`, `world-repository.ts:2`, `reverie-repository.ts:1`, `scene-repository.ts:1`, `npc-intent-repository.ts:6`) already resolve to re-exports of `@/domain/entities`. Point them there directly, then add `lib` to the `domain-points-inward` rule's target path in `.dependency-cruiser.cjs:33`. This is what makes the bug class *unrepeatable*, not just fixed.

**Tests:** existing suites cover the survivors. Add a depcruise assertion that `domain/` → `lib/` is now forbidden.
**Risk:** low; type-only moves plus deletions. `tsc` catches every miss.

---

### A1 — Parallelize inside the state assembler *(biggest single win, zero call-site change)*

**Problem:** `getNarratorWorldStateVia` (`lib/world-state.ts:133`) issues 8 strictly sequential awaits, but only 3 of them have real data dependencies.

**Layer:** one function body. Signature and return value unchanged — every caller benefits, including `opening-turn`.

**Changes:** restructure into three waves:

```
wave 1 (parallel):  worlds.cursor · scenes.activeForWorld · characters.forWorld
                    · places.forWorld · dossiers.forWorld
wave 2:             places.byId(currentPlaceId)        — needs player + activeScene
wave 3 (parallel):  characters.inPlace · occupancy.latestSnapshot — need currentPlace
```

**8 sequential hops → 3 waves.** Applied at three call sites per turn.

**Tests:** `tests/` already exercises this assembler; assert the returned object is unchanged. Add a test with a mock port set counting call ordering to lock the waves in.
**Risk:** low. Pure reordering of independent reads. The `currentPlaceId` fallback chain (`player.current_place_id ?? activeScene.place_id ?? null`) must be preserved exactly — it's load-bearing for the walk-back-to-an-earlier-room case documented at `lib/world-state.ts:86-92`.

---

### A2 — Collapse three state assemblies into one

**Problem:** the assembler runs three times per turn (lines 119, 145, 186). Each re-read exists only because a write happened in between.

**Changes:**
- **#2 (line 145)** exists because `recordAppearancesAndAutoPromote` (line 124) wrote promotions. That call already **returns** the `promotion` delta. Apply it to the in-memory state instead of re-reading. *(Audit this: confirm the returned delta covers every field the narrator later reads — `agency_level`, `appearance_count`, `last_seen_turn_id`. If it doesn't, widen the return type rather than keeping the re-read.)*
- **#3 (line 186)** exists because `buildPlaceOccupancySnapshotVia` (line 175) persisted a snapshot. That call **returns** `turnOccupancy`. Merge it into the existing state object rather than re-reading.

**Result: 3 assemblies → 1.** Combined with A1: ~24 sequential hops → 3 waves.

**Tests:** this is the highest-risk step in Track A. Add a characterization test that captures the full `trailingUser` message string for a fixture world *before* the change and asserts byte-equality after. Nothing else proves "no behavior change" at this granularity.
**Risk:** medium — the highest in the plan. The re-reads are load-bearing if the delta returns are incomplete. Do not skip the characterization test.

---

### A3 — Get the geocoder off the turn path

**Problem:** `narrate-turn.ts:139` is commented *"best-effort, never blocks the narrator"* — and is `await`ed. With `MAX_PARALLEL = 4` and `PER_LOOKUP_TIMEOUT_MS = 4000` (`lib/place-resolver.ts:13-14`), a world with 12 unresolved places adds up to 12s to time-to-first-token when Nominatim stalls. The comment states the intent; the code contradicts it.

**Changes:** hand `resolveUnresolvedPlaces` to `backgroundTasks` (already destructured from `ctx`) so it drains post-stream like the archivist. Resolution lands one turn later, which is the semantics the comment already claims.

**Tests:** assert the resolver is registered as a background task and not awaited pre-stream.
**Risk:** low. Consequence is a one-turn lag on first-mention geocoding — invisible in play, since the narrator doesn't read `geo_status` on the turn a place is introduced. *(Verify that last clause before landing.)*

---

### A4 — Overlap the occupancy sim with the NPC agent

**Problem:** `buildPlaceOccupancySnapshotVia` (line 175) runs after `runNpcAgentTick` (line 155), but takes `{dossiers, occupancy, places, scenes, worlds}` + `worldId` + `playerTurnId` + era — **no dependency on `plans`**. It is waiting for an LLM call it doesn't need.

**Changes:** `Promise.all` the two. Keep the independent error handling — the NPC agent degrades to plan-less, the occupancy sim degrades to `null`; neither may take the other down. Use `Promise.allSettled` or keep the existing per-call `.catch`.

**Tests:** existing `tests/place-population.test.ts` + `tests/npc-agent.test.ts` cover behavior; add one asserting an occupancy failure still yields plans and vice versa.
**Risk:** low.

---

### A5 — Fetch recent turns once

**Problem:** `turns.recentTurns(worldId, 4)` at line 146 and `turns.recentTurns(worldId, 16)` at line 252. The first is a strict subset of the second.

**Changes:** fetch 16 once, `slice(-4)` for the agent context. Confirm ordering convention (`recentTurns` returns oldest→newest, given line 253 does `slice(0, -1)` to drop the current turn) so the slice takes the right end.

**Tests:** assert the agent still receives the same 4 turns in the same order.
**Risk:** low, but the slice direction is an easy off-by-one. Cover it.

---

### A6 — Start the NPC agent speculatively, in parallel with the classifier

**Problem:** the two Haiku calls are strictly serial (line 130 → line 155), and that serial chain is the irreducible-looking core of pre-stream latency. But it isn't actually irreducible: `runNpcAgentTick` **does not receive the classification**. It takes `(deps, worldId, playerTurnId, premise, playerText, recentForAgents)`. The classifier's output is used *only* by the gate, `shouldTickNpcAgent`.

Reading that gate (`domain/services/npc-agent-gating.ts`):

```
inputMode !== 'in-character' || stance ∈ {meta, think}  → false
stance ∈ {do, say}                                       → true
otherwise                                                → any living present non-player NPC
```

So for **every in-character turn with a living NPC present** — the overwhelming majority — the gate opens regardless of stance. The classification only matters for the rare meta/think/OOC turn.

**Changes:**
1. Compute a cheap pre-gate with no LLM: *is there a living, non-player, present character?* If no → skip the agent entirely (saves a call today, too).
2. If yes → launch `runNpcAgentTick` **concurrently with `classifyAction`**.
3. When the classification returns, apply the real gate. If it says `false` (meta / think / OOC), **discard the agent result** and proceed plan-less.

**This removes one full LLM round-trip from time-to-first-token on the common path.**

**Cost:** wasted Haiku tokens on meta/think/OOC turns. Haiku is the cheap model and these turns are rare, but the waste is real and lands against `DAILY_TOKEN_LIMIT`.

**Decision required — Andrew:** accept the speculative-token cost, or keep the calls serial? Recommend **accept**: measure the meta/think/OOC share of turns from `turns.metadata` first; if it's under ~10%, the latency win clearly dominates. If it's higher than expected, fall back to A6-lite — keep them serial but move the classifier to run concurrently with state assembly #1 (it only needs `formatSceneDigestForClassifier(priorState)`, so it can start the moment wave 1 of A1 completes rather than after all three waves).

**Tests:** assert (a) no agent call when no living NPC is present, (b) plans discarded on a `meta` classification, (c) an agent failure still degrades to plan-less.
**Risk:** medium — introduces speculative execution. Ensure the discarded call's usage is still recorded to `turns.metadata` (it was spent; the cost accounting must reflect it) and that a discarded tick performs **no writes**. `runNpcAgentTick` writes reveries and intents through `unitOfWork` — **if it writes before returning, speculation is unsafe without a rollback path.** Verify this first; it may force A6-lite.

---

### Track A expected result

| | Before | After |
|---|---|---|
| Sequential DB round-trips | ~30 | ~8 |
| State assemblies | 3 | 1 (3 waves) |
| Serial LLM calls pre-stream | 2–3 | 1–2 |
| Geocode on turn path | up to 12s | 0 |

Behavior: unchanged. Enforced by the A2 characterization test.

### Track A shipped (partial, v0.4.0)

| Item | Status | Notes |
|---|---|---|
| A0 twin deletion | **done** | SQLite twins deleted; Via suffix dropped; domain→lib depcruise fence |
| A1 parallel state waves | **done** | `getNarratorWorldStateVia` 3-wave `Promise.all` |
| A2 collapse 3 assemblies → 1 | **done** | `applyPromotionDeltaToState` + occupancy merge |
| A3 geocode off path | **done** | `backgroundTasks.register(resolveUnresolvedPlaces…)` |
| A4 occupancy ∥ npc-agent | **done** | `Promise.all` with independent catch |
| A5 single recentTurns | **done** | fetch 16 once; `slice(-4)` for agents |
| A6 speculative npc-agent | **done** | C5 `planNpcActions` is write-free; C6 overlaps classify; persist post-stream |
| Reverie port read | **done** | `reveries.forCharacters` (fixes Mongo prod no-flare) |
| Prompt cache layout | **done** | Premise pinned into system; trailing user is state+action only |
| Archivist gate tighten | **done** | `hasRichStorySignal` less trigger-happy on ambient time / bare "message" |

---

# Track C — Time-to-first-audio (voice)

**Why this track exists.** Track A makes *text* appear sooner. The user-reported pain was a long silence *after* prose finishes. That is a TTS identity / start-overlap problem, not Mongo round-trips.

### C0 — Stable audio job id *(shipped)*

**Bug:** `Chat` flipped the audio job key from the AI SDK message id → DB turn id when `dbTurnId` metadata landed (and briefly to `undefined` in between). `useNarratorAudio` treats any key change as a full `resetJob` (abort in-flight fetch, stop playback). Mid-stream first-chunk synthesis was discarded; the player re-paid a full TTS RTT after the stream ended.

**Fix:** job key stays on the UI message id for the whole turn. `dbTurnId` is a separate field used only for cache keying + cost recording. Never tear down a live job just because the DB id arrived.

### C1 — First-chunk reliability *(shipped)*

- `FIRST_CHUNK_MIN_CHARS` 280 → **140**
- Sentence-boundary fallback when no `\n\n` has cleared the floor (long single-paragraph turns still start TTS mid-stream)
- Split decision remains deterministic for replay cache hits

### C2 — `optimize_streaming_latency` *(shipped)*

- Default `optimize_streaming_latency: 1` on every synthesis request
- Env `TTS_OPTIMIZE_STREAMING_LATENCY=0|1|2` (invalid → 1; `0` omits the field for quality mode)

### C3 — WebSocket streaming TTS *(shipped, with HTTP fallback)*

- Default transport `TTS_TRANSPORT=ws` (set `http` to force unary POST)
- Opens `wss://api.x.ai/v1/tts`, feeds sentence-sized `text.delta`s, streams `audio.delta` base64 into the existing progressive MediaSource path
- On any WS failure, falls back to POST automatically

### C4 — Measure in the browser

Dev console already logs:
```
[narrator-audio][ttfa] request→firstByte=…ms firstByte→firstAudio=…ms overlapped=true|false
```
After C0–C3, expect `overlapped=true` on most multi-sentence turns and lower request→firstByte with latency=1 / WS.

---

# Track B — Narrator quality & pacing

## What already shipped (correct the record first)

`docs/plans/npc-initiation-fixes.md` is marked *"proposed (not started)"* and is **stale — all three PRs landed**:

- P4 MUST-stage paragraph → `prompts/narrator-system.md:84`
- P2 engagement floor ("at least one — and ideally only one") → `prompts/npc-agent-system.md:98`, and the "left out entirely" qualifier at line 77
- P3 gate opened to any present living NPC → `domain/services/npc-agent-gating.ts`
- P1 cold-open eligibility → `isPlanEligible` in `domain/services/npc-promotion.ts:63`
- P6 off-screen tension → `domain/services/seed-tension.ts`, used by `seed-bounded-world.ts:20`

**Action: `git mv docs/plans/npc-initiation-fixes.md docs/plans/archive/`** per the AGENTS.md archiving rule.

The cheap prompt-level pacing wins are therefore spent. What remains is structural.

---

### B1 — Retire the overfit playtest constants *(prerequisite for judging pacing)*

**Problem:** real character and employer names from past playtests are compiled into decision logic:

- `domain/services/npc-promotion.ts:51` — `/\b(minerva|black cloak|caesar|threat|follow|stalk|...)\b/` decides whether an NPC is a transient service character. `minerva`, `black cloak`, and `caesar` are proper nouns from one world sitting in a **domain service**.
- `lib/player-profile.ts:83` — `/\b(usace|linda|haft|code review|contract|...)\b/`.

Any pacing evaluation in a new world is measuring a rule tuned to a different one. `ONION_TODO.md:102` already flags this as a deferred behavior-change PR; it's now blocking.

**Layer:** domain service. This is the same genre-coupling class the `feat/genre-decoupling` branch addresses elsewhere — worth landing in that idiom (world-scoped signal, not a global regex).

**Changes:** replace the proper nouns with the world's own significant-entity set (thread/objective/clue titles are already assembled in `narratorState.dossier`), keeping the generic verbs (`follow`, `stalk`, `conspiracy`, …) as the world-independent floor.

**Tests:** `tests/npc-promotion.test.ts` — assert a world naming its own antagonist gets the same protection `minerva` currently gets hardcoded.
**Risk:** medium. This *is* a behavior change — that's the point. Expect promotion decisions to shift in existing worlds.

---

### B2 — Close the reverie loop *(mostly free once the prod bug is fixed)*

Reveries are a fully-built pacing mechanism that **has never run in production** (see Prerequisite). `prompts/narrator-system.md:75` gives flaring reveries a hard MUST; `computeReverieFlares` is pure and deterministic; the whole substrate shipped in v0.6.18. Fixing the one-line read bug switches on a pacing lever that already exists.

**Action:** fix the read, then **play several turns before adding anything new to this track.** The flare mechanism may deliver a meaningful share of the pacing improvement on its own, and any further work should be judged against a world where it actually fires. Treat B3 as provisional until this is observed.

---

### B3 — Re-measure, then decide → **specified & largely shipped**

Concrete specification landed as **`docs/plans/archive/narrator-craft-freedom.md`** (v0.6.0): story-motion S1/S2 (salient-plan intrusion budget + open-order / off-scene status) then sparse craft (Phase A system prompt + Phase B risk-gated guidance). Remaining from that plan: dual-world playtest gate, optional STATE budget (Phase C), optional planned-move soften (Phase D).

---

## Sequencing

| PR | Contents | Effort | Rationale |
|---|---|---|---|
| **C** *(this branch)* | C0–C3 voice TTFA + A1–A5 + reverie port + cache layout + archivist gate | M | User-facing voice gap + biggest pre-stream wins |
| **0** | Remaining prod split-brain (world-correction SQLite twin) | XS | **Done** in v0.4.0 |
| **1** | A0 (twin deletion + depcruise fence) | S | **Done** on `feat/a0-delete-sqlite-twins` |
| **4** | A6 or A6-lite | M | Gated on the `unitOfWork` write-safety check and Andrew's cost call |
| **5** | B1 + archive the stale plan doc | M | Behavior change; land alone so its effect is attributable |
| **6** | B2, then re-measure | S | Playtest gate before any B3 work is specified |

**Version:** feature work → bump MINOR on the branch before merge. The current branch (`feat/genre-decoupling`) is still at `0.3.0` and owes its own bump to `0.4.0`; this plan's first feature PR takes the next minor after that.

## Env knobs (Track C)

| Env | Default | Meaning |
|---|---|---|
| `TTS_OPTIMIZE_STREAMING_LATENCY` | `1` | `0` quality / omit field; `1` moderate TTFA; `2` aggressive |
| `TTS_TRANSPORT` | `ws` | `ws` bidirectional streaming with HTTP fallback; `http` unary POST only |
| `TTS_SPEED` | unset | Optional `0.7`–`1.5` speech rate |

## Open questions for Andrew

1. **A6 speculative execution** — accept wasted Haiku tokens on meta/think turns for one fewer serial LLM round-trip? (Recommend yes, contingent on the `runNpcAgentTick` write-safety check.)
2. **A3 geocode lag** — shipped as background; confirm nothing reads `geo_status` on the turn a place is first mentioned.
3. **B1 blast radius** — retuning transient-NPC detection will change promotion decisions in existing worlds, including prod world 12. Acceptable, or gate behind a per-world flag?
4. **TTS defaults** — keep `optimize_streaming_latency=1` and `TTS_TRANSPORT=ws`, or prefer quality (`0` + `http`)?

# Narrator History (20 Full Role Rows) + Archivist Max Lag (2) — Implementation Plan

**Status:** implemented  

**Branch (recommended):** `feat/narrator-history-20-archivist-lag-2`  
**Version on ship:** bump **MINOR**. This changes player-visible continuity behavior (the narrator sees materially more full prose, and the archivist freshness cadence changes), so it fits the repo's "new feature / visible behavior" rule better than PATCH.  
**Related:** current packing in `domain/services/history-packer.ts` + `narrate-turn.ts`; archivist gate in `domain/services/story-signal.ts`; post-stream archivist in `infrastructure/narrator/narrate-turn.ts` `onFinish`.

---

## Goal

1. **Narrator** always sees the last **20 prior role rows** as **full, uncompacted** prose (after OOC sanitization).
2. **Archivist LLM** stays **signal-gated**, but never falls more than **2 assistant turns** behind a successful extract window (max lag).
3. When the archivist runs after a skip, it extracts over the **since-last-success** window where possible, so deferred prose is not silently lost; if the window is capped, metadata records the truncation.

This is a continuity/cost tuning track — not a new memory system, not embeddings, not a rewrite of `applyArchivistPatch`.

---

## Done means

1. Narrator history fetch is sized so **20 prior role rows** (`user` + `assistant`) are candidates; none of those 20 are compacted solely for budget.
2. OOC / policy-refusal sanitization still strips poison turns before messages are built.
3. `shouldRunArchivistLlm` (or a thin successor) still runs on rich signal / resolution+dossier / travel-without-deterministic-patch.
4. When `lag_before >= 2` (after the current narrator turn is inserted, before archivist processing), the post-stream path **forces** an LLM extract even without signal — unless the deterministic-only path resets lag before the LLM decision (see policy).
5. Forced or signal-driven extracts receive a **since-last-success** recent window where possible, not a fixed “last 4” that might miss a skipped middle turn; if the window must be capped, metadata records that truncation.
6. Unit tests cover packing/no-compact behavior, lag math, and gate composition; depcruise + type-check + full test suite green.
7. One end-to-end browser turn confirms history is full and archivist metadata shows either `skipped` / `run_reason: signal` / `run_reason: max_lag` as expected.

---

## Current baseline (do not rediscover)

| Surface | Today | Target |
|--------|--------|--------|
| History fetch | `NARRATOR_HISTORY_TURNS = 16` role rows (includes current user turn in the fetch; `priorHistory = slice(0,-1)`) | Fetch **21** rows so **20 prior** role rows remain after dropping current, **or** fetch 20 priors explicitly — pick one and document |
| Full budget | `HISTORY_FULL_TOKEN_BUDGET = 4200` | **No budget compaction** for the 20-role-row window |
| Compacted tail | `COMPACTED_TURN_CHARS = 600` + `[Earlier … compacted]` prefix | **Unused** for this window (keep packer code for later / other callers) |
| Archivist gate | `shouldRunArchivistLlm(player, narrator, hasDetPatch, activeDossierCount)` | Same signals **OR** `assistantTurnsSinceLastSuccessfulArchivist >= 2` |
| Archivist recent | `turns.recentTurns(worldId, 4)` always | `recentTurns` covering **since last successful archivist** (cap e.g. 6–8 role rows, with truncation diagnostics) |
| Deterministic patch | Applies when gate false + patch present | **Unchanged** — always eligible every turn |

Authoritative STATE remains the truth layer. Full prose is a **short-term continuity buffer**, not a replacement for patches.

---

## Policy definitions (lock these before coding)

### P1 — “20 previous role rows, uncompacted”

- **Unit:** role rows (`user` + `assistant` rows in `turns`), oldest→newest, same as `TurnRepository.recentTurns`. This is **not** 20 user+assistant pairs.
- **Count:** 20 role rows **before** the current player action that is about to be narrated (i.e. prior history only; current action is still the final user message / pinned action path as today).
- **Uncompacted:** each of those rows is sent as full `content` after `sanitizeNarratorHistory`. No `packNarratorHistory` truncation for this path.
- **Still stripped:** OOC refusal / policy poison turns via existing `sanitizeNarratorHistory` (may reduce count below 20 — correct).
- **Not in scope:** raising system-prompt STATE size; dumping full world wiki; 40-turn window.

**Cost note (accept explicitly):** ~20 full role rows can be roughly **5k–12k+ input tokens** of history alone depending on prose length (vs ~4.2k full today). This is the intended trade for continuity. Log estimated history tokens on a sample of turns post-ship if easy; do not block on a new metrics system.

### P2 — Archivist: signal-gated + max lag 2

Define **assistant-turn lag** as:

> Number of **completed assistant (narrator) turns** since the most recent assistant turn whose metadata contains a successful archivist block.

A **successful** archivist block is any of:

- LLM extract applied (`model` is the live archivist model / Haiku, with `patch`, no `skipped: true`, and no `error`)
- Deterministic apply (`model: 'deterministic-archivist'`, with `patch`, and no `error`)

**Skipped** (`skipped: true`, `reason: 'no_state_change_signal'`) does **not** reset lag.
**Failed** (`error` present) does **not** reset lag, even if `skipped` is absent.

**Run LLM archivist when:**

```
signal = shouldRunArchivistLlm(...)   // existing pure gate
lag    = assistantTurnsSinceLastSuccessfulArchivist(...)  // new pure helper

runLlm =
  signal
  || lag >= MAX_ARCHIVIST_LAG_ASSISTANT_TURNS  // = 2
```

`lag_before` is computed **after** the current narrator turn is inserted and before the archivist block for that turn is written. Therefore: deterministic/LLM apply at N resets lag; N+1 ambient computes `lag_before = 1` and can skip; N+2 ambient computes `lag_before = 2` and forces LLM.

**Order of operations in `onFinish` (preserve structure, extend gate only):**

1. Build deterministic patch (unchanged).
2. Compute `signal` + `lag_before` + `runLlm`.
3. If **!runLlm && deterministicPatch** → apply deterministic, stamp metadata, return (resets lag).
4. If **!runLlm** → stamp `skipped: true` (optionally add `lag_before` to metadata for diagnostics), return.
5. If **runLlm** → extract with **since-last-success window**, apply, stamp metadata; if forced by lag only, stamp `run_reason: 'max_lag'` alongside model/usage/patch.

**Edge cases:**

| Case | Behavior |
|------|----------|
| Brand-new world, first narrator turn | No force until 2 completed assistant turns exist without a successful archivist block (avoid double extract on open) |
| Opening turn already has archivist seed | Counts as successful; lag resets |
| Deterministic applied turn N; N+1 ambient | N+1 computes `lag_before = 1` and skips; N+2 computes `lag_before = 2` and forces LLM |
| Signal true every turn | Runs every turn (max lag irrelevant) |
| LLM extract fails | Stamp error only; do **not** stamp success; lag continues (next turn may force again). Keep existing error logging |
| Background race: turn N+1 starts before N’s archivist finishes | Pre-existing; do not solve in this plan. Lag is computed from **persisted** metadata only |

### P3 — Extract window when running

When LLM runs (signal or lag):

- Load recent turns with a **cap** (recommend **8 role rows** ≈ 4 pairs, or `2 * MAX_LAG + 4` for safety).
- Prefer content **after** the last successful archivist turn id when that id is known; else fall back to last N.
- If more turns exist since last success than the cap allows, pass the newest capped subset and stamp `window_truncated: true` plus `window_start_turn_id` / `last_success_turn_id` for diagnostics. Do not claim the extract saw all deferred prose when it did not.
- Pass that list into `extractPatch` as today (`archivistRecent`).

Do **not** pass all 20 narrator history role rows into the archivist by default — Haiku extract quality and cost degrade on long blobs; the narrator owns the long prose window.

---

## Non-goals

- Batching archivist to 5–10 turns
- Removing `history-packer.ts` (keep pure service + tests; narrator path may stop calling it)
- Changing archivist Zod schema / prompt rewrite
- Voyage embeddings / `memory_chunks`
- Mongo-only behavior (both adapters via `TurnRepository` only)
- Hard `maxOutputTokens` or narrator length bands

---

## Layering

| Concern | Home |
|---------|------|
| Narrator constants (`NARRATOR_PRIOR_ROLE_ROWS = 20`, fetch limit derived from current-user inclusion) | Top of `infrastructure/narrator/narrate-turn.ts` next to today’s narrator constants |
| Archivist lag constant (`MAX_ARCHIVIST_LAG_ASSISTANT_TURNS = 2`) | Domain policy module or passed as an argument to the pure policy helper; do not import model IDs into domain |
| Pure lag math + “is successful archivist metadata?” | `domain/services/` (prefer new `archivist-run-policy.ts`) — **no I/O**, no model registry import |
| Existing signal gate | Keep in `domain/services/story-signal.ts` |
| History assembly (sanitize → full messages) | `infrastructure/narrator/narrate-turn.ts` |
| Reading recent turns / metadata for lag | Adapter already via `TurnRepository`; orchestration in `narrate-turn` `onFinish` |
| Docs | This plan; light touch to `Agents.md` / rebuild-spec constants table only if they still claim 4.2k packing as binding |

---

## Recommended implementation order

### Phase 0 — Characterization (short)

1. Confirm fetch semantics: with `recentTurns(limit)`, last row is newest; current player turn is already inserted before `narrateTurn` runs — so `priorHistory = allRecent.slice(0, -1)` is correct **if** the current user turn is included in the fetch.
2. For **20 prior role rows**: set fetch limit to **21** (20 prior + current user) **or** fetch 20 and do not include current in that list if current is only passed as the action message. **Match whatever the stream assembly does today** so we don’t duplicate the current user message in history + action.
3. Snapshot one real world: how many tokens ~20 full role rows actually are (optional script or log line).

**Exit:** written note in PR description: “fetch limit = X because …”

---

### Phase 1 — Narrator: 20 full role rows (no compaction)

**Files (expected):**

- `packages/server/src/infrastructure/narrator/narrate-turn.ts`
  - `NARRATOR_PRIOR_ROLE_ROWS = 20`; derive the fetch limit from whether the current user turn is included (see Phase 0)
  - `compactHistory` → rename intent to `buildHistoryMessages`: sanitize, map to `ModelMessage[]` **without** `packNarratorHistory`
  - Leave `HISTORY_FULL_TOKEN_BUDGET` / `COMPACTED_TURN_CHARS` unused or delete if nothing else references them from this file
- `packages/server/tests/` — add or extend a thin test for “20 role rows all full” if logic is extracted; otherwise test pure helper if you extract `toFullHistoryMessages(history)`
- `domain/services/history-packer.ts` + `tests/history-packer.test.ts` — **keep** (still pure, may be reused later); no need to delete in this PR

**AGENTS.md budget line:** update the “~4.2k-token full-content window” sentence to “last 20 prior role rows full (uncompacted); system + STATE + action pinned” so agents don’t reintroduce packing as a hard rule.

**Tests:**

- If extraction is pure: given 20 long role rows, output 20 full contents, `compacted` never applied.
- `sanitizeNarratorHistory` still drops OOC refusals (existing `ooc-refusal.test.ts`).

**Risk:** higher Grok input cost and possible attention dilution. Mitigation: 20 is the product decision; if prod cost spikes, first lever is lowering to 16 full (not re-adding aggressive compact) or scene-bounded later.

**Exit:** unit green; one manual turn in browser; optional log of history message count.

---

### Phase 2 — Pure archivist run policy (signal + lag)

**Files:**

- `packages/server/src/domain/services/story-signal.ts` **or** `archivist-run-policy.ts`
  - `isSuccessfulArchivistMeta(meta: unknown): boolean` — requires `patch`, no `skipped`, no `error`; accepts deterministic model with `patch`
  - `assistantTurnsSinceLastSuccessfulArchivist(turns: Array<{ id: number; metadata: Record<string, unknown> }>): number`
  - `shouldRunArchivistLlmWithLag(args): { run: boolean; reason: 'signal' | 'max_lag' | 'skip' }`  
    composing existing `shouldRunArchivistLlm` + lag ≥ 2
- `packages/server/tests/story-signal.test.ts` (or new `archivist-run-policy.test.ts`)

**Test matrix:**

| Setup | Expected |
|-------|----------|
| signal true, lag 0 | run, reason `signal` |
| signal false, lag 0 | skip |
| signal false, lag 1 | skip |
| signal false, lag 2 | run, reason `max_lag` |
| signal false, lag 3 | run, reason `max_lag` |
| only skipped metas in window | lag = window length |
| error-only archivist meta | does not reset lag |
| last meta deterministic-archivist with patch | lag 0 |
| empty history | skip (no force) |

**Exit:** pure tests green; no I/O in domain.

---

### Phase 3 — Wire lag + since-last-success window in `onFinish`

**Files:**

- `packages/server/src/infrastructure/narrator/narrate-turn.ts` (post-stream archivist block ~760+)
- Possibly `TurnRepository` **read** already enough:
  - `recentTurns` for content window
  - `assistantMetadataInRange` / `allAssistantMetadata` / walk recent assistant rows with metadata — **prefer the cheapest existing method** that can see last few assistant `archivist` blocks

**Important:** metadata-only reads return assistant turns that have metadata; missing archivist blocks must still count as lag. Either combine recent assistant ids from `recentTurns` with `assistantMetadataInRange`, or add a narrow repository read if needed. Do not compute lag from metadata-bearing rows only.

**Implementation sketch:**

```text
// After stream completes and narrator turn is persisted:
det = extractDeterministicPatch(...)
signal = shouldRunArchivistLlm(...)
// Load recent assistant ids + metadata (missing archivist blocks count as lag)
decision = shouldRunArchivistLlmWithLag({ signal, lag })

if (!decision.run && det) { apply det; stamp; return }
if (!decision.run) { stamp skipped + lag; return }

window = turns since lastSuccessfulId (cap 8, newest subset if truncated) || recentTurns(8)
extractPatch(..., window, ...)
stamp archivist { ..., run_reason: decision.reason, lag_before, window_truncated? }
```

**Deterministic + lag:** If `decision.run` because max_lag **and** `det` is non-null, prefer **one path**: either apply det first then still LLM (wasteful) or LLM-only (may miss det edge). **Recommendation:** if `det` and !signal and lag force, **apply det and still run LLM** only when signal would have wanted soft facts — simpler rule for v1:

- If `det` and !`decision.run` → det only (today).
- If `decision.run` → LLM path; optionally merge/ignore det (today’s signal path does not apply det separately when LLM runs — **preserve that**: when LLM runs, LLM is source of patch; det is only for skip path). Verify current behavior and keep it.

**Metadata diagnostics (cheap):**

```ts
{
  model: ARCHIVIST_MODEL,
  usage,
  patch,
  run_reason: 'signal' | 'max_lag',
  lag_before: number,
  window_truncated?: boolean,
  window_start_turn_id?: number,
  last_success_turn_id?: number,
}
```

Skipped:

```ts
{
  model: ARCHIVIST_MODEL,
  skipped: true,
  reason: 'no_state_change_signal',
  lag_before: number,
}
```

**Exit:** existing archivist tests still pass; new integration-style test if there is a harness for `onFinish` — if not, pure policy + a focused test of window selection helper is enough.

---

### Phase 4 — Docs + release hygiene

1. Update this plan status → implemented when merged.
2. Touch `docs/specs/system-design-rebuild-spec.md` constants table if it still lists `NARRATOR_HISTORY_TURNS = 13` / packing numbers (spec drift already exists vs code at 16).
3. `AGENTS.md` “Respect the budget” bullet: replace 4.2k packing claim with 20 full prior role rows.
4. `docs/specs/memory-architecture.md`: update Phase 1 recent-turn budget text if it still describes truncation / 2.5k–4k recent turns as current behavior.
5. Version bump on release branch per `docs/RELEASING.md` when shipping.

---

## PR strategy

Prefer **two PRs** (smaller review, easier revert):

| PR | Contents |
|----|----------|
| **PR1** | Phase 1 only — 20 full narrator role rows, doc budget line |
| **PR2** | Phases 2–3 — lag policy + wire + metadata |

Or one PR if the branch stays small (<~200 LOC net). Either is fine; PR1 alone is already valuable.

---

## Test plan

```bash
npm run depcruise
npm run type-check
npm test
# if TurnRepository metadata reads touched in mongo adapter:
npm run test:mongo
```

**Manual:**

1. Play 3 ambient turns (“look around” / wait) with no rich signal after a known successful archivist turn — metadata should show `lag_before = 1` skip, then `lag_before = 2` `run_reason: max_lag` force.
2. Play a discovery turn mid-scene — `run_reason: signal` immediately.
3. Confirm full-history inclusion via unit/helper output or a temporary local debug count; optionally also check whether the narrator references a detail from ~15 role rows earlier (best effort; world-dependent).
4. Inspector / world-state: location and cast still update on travel (deterministic or LLM).

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Grok cost up from full 20-role-row history | Accept for this experiment; measure; rollback constant to 12–16 full if needed |
| Context dilution (model ignores STATE) | Keep STATE pinned and high in system; do not bury it inside history messages |
| Ambient play forces Haiku every 2 turns | Intended soft freshness; if wasteful, follow-up: force max-lag only when `estimateTokens(window) > T` or light heuristic “any proper name / dialogue” |
| Lag miscount if metadata missing on old turns | Treat missing archivist block as non-resetting (increases lag → may force once); OK |
| Archivist window too short after 2 skips | Cap ≥ 6–8 role rows; include since-last-success window |
| Capped window silently drops deferred prose | Stamp `window_truncated` + ids; if truncation happens often, raise cap or add scene-boundary flush |
| Failure metadata accidentally resets lag | Success predicate requires `patch`, no `skipped`, and no `error` |
| Double-counting current user turn in history | Phase 0 fetch semantics check |
| Reintroducing packer “for safety” mid-review | Explicit non-goal; budget is “20 full” not “4.2k” |

---

## Follow-ups (out of this plan)

- Scene-boundary archivist flush
- Soft vs hard state split (deterministic always / LLM soft-batched)
- Re-enable packer only for turns **beyond** 20 if we later fetch 40 candidates
- Token usage dashboard for history size
- Raise archivist quality on multi-turn windows (prompt tweak)

---

## Decision log

| Decision | Choice | Why |
|----------|--------|-----|
| History depth | **20 prior role rows, full** | Product lean; already near 16 candidates |
| Compaction | **Off for that window** | Explicit ask; packing was the continuity bottleneck |
| Archivist | **Signal OR lag ≥ 2 assistant turns** | Saves Haiku on quiet beats; bounds staleness |
| Lag unit | **Assistant turns since successful archivist metadata** | Matches “state commit” cadence; det apply resets; skipped/error metadata does not |
| Archivist input | **Since last success, capped with diagnostics** | Not the full 20 role rows (extract quality); truncation must be visible |
| Packer module | **Keep** | Pure, tested; narrator stops calling it for now |

---

## Implementation checklist

- [x] Phase 0: confirm fetch/limit vs current user turn duplication
  - **Fetch limit = 21** (`NARRATOR_PRIOR_ROLE_ROWS + 1`): current player turn is already inserted before `narrateTurn`; `priorHistory = allRecent.slice(0, -1)` drops it so it is not duplicated with the pinned PLAYER ACTION message.
- [x] Phase 1: 20 full prior role rows; drop narrator compaction path
- [x] Phase 1: update `AGENTS.md` budget bullet
- [x] Phase 2: pure lag + composed run policy + tests
- [x] Phase 3: wire `onFinish`; since-last-success window; metadata `run_reason` / `lag_before`
- [x] Phase 4: spec/doc drift (`system-design-rebuild-spec`, `memory-architecture`) + plan status
- [x] Gates: depcruise, type-check, test (mongo not required — no adapter changes)
- [ ] Manual ambient / signal / e2e smoke
- [x] Version bump on feature branch: **0.8.0 → 0.9.0** (promote `main → production` to deploy)

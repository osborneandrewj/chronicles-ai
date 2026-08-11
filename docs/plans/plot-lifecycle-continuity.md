# Plot Lifecycle Continuity - Implementation Plan

**Status:** implemented (Phases 1–5)
**Branch:** local / current working tree (`fix/plot-lifecycle-continuity` recommended for PR)
**Trigger:** application review found finished threads/objectives can fall out of context, be reactivated by child-row writes, and remain sticky in NPC goals.

## Goal

Finished plot work should stay finished. The narrator, archivist, and NPC agent must share a compact understanding of active pressure and recently closed pressure, without dumping full history or turning resolved arcs back into active quests.

This is a bug-fix track, not a memory-system rewrite. The first pass should avoid schema changes and should keep persistence behind existing ports.

## Done means

1. Completing or updating a child dossier row cannot reactivate a resolved, failed, or dormant parent thread.
2. Narrator context includes compact recently closed plot state, capped by recency.
3. Archivist prior state includes compact recently closed plot state, so it can avoid recreating or reopening finished work.
4. NPC planning sees enough plot lifecycle state to stop pursuing obsolete goals when the NPC plausibly knows the outcome.
5. Archivist run gating catches resolution-shaped turns.
6. Tests cover the lifecycle, rendering, archivist context, NPC context, and story-signal gates.

## Root causes

| Cause | Symptom | Primary surface |
|---|---|---|
| Child dossier writes call thread resolution as an upsert with `status: active` | Resolved/failed/dormant threads can be reopened by objectives, clues, or timeline events | `application/use-cases/apply-archivist-patch.ts` |
| Closed dossier rows are filtered out of context | Narrator and archivist know what is active, but not what is done | `server/render/state-block.ts`, `lib/archivist.ts` |
| NPC agent does not receive story dossier lifecycle | NPC goals and agendas can remain sticky after related work is complete | `lib/npc-agent.ts` |
| Memory retrieval is a no-op | Long-running closure facts fall out once recent turns rotate away | `infrastructure/persistence/*/memory-repository.*.ts` |
| Archivist LLM gate is precision-biased | Some completion/resolution turns are skipped before the archivist can mark rows closed | `domain/services/story-signal.ts`, `infrastructure/narrator/narrate-turn.ts` |

## Recommended order

1. Lock dossier lifecycle invariants.
2. Render closed plot memory to narrator and archivist.
3. Give NPC planning closed/active story context.
4. Broaden the archivist run gate for resolution language.
5. Defer deterministic memory summaries to a follow-up unless the first four items are insufficient.

---

## Phase 1 - Lock dossier lifecycle

**Goal:** referencing an existing thread from a clue, objective, or timeline event should link to it without changing its lifecycle.

### Changes

1. Add failing tests in `packages/server/tests/archivist.test.ts`:
   - A resolved thread stays `resolved` when a completed objective references it.
   - A failed thread stays `failed` when a timeline event references it.
   - A dormant thread stays `dormant` when a clue references it.
   - A brand-new thread still opens `active` when a new objective references a new title.
   - An active `mystery`/`background` thread referenced by an objective still upgrades to `quest`.

2. Refactor `resolveStoryThreadId()` in `packages/server/src/application/use-cases/apply-archivist-patch.ts`:
   - Split "find existing thread id" from "create missing thread".
   - If a thread exists, return its id without changing status by default.
   - Only create `active` when no existing thread exists.
   - Only upgrade `mystery`/`background` to `quest` when the existing thread is still `active`.
   - Only explicit `story_threads[]` patches may set lifecycle states: `active`, `resolved`, `failed`, `dormant`.

3. If the branching becomes non-trivial, add a pure domain helper:
   - `domain/services/dossier-thread-reference.ts`
   - Keep repositories as dumb CRUD. Do not move merge/upsert decisions into adapters.

### Tests

Run targeted:

```sh
npm test -- archivist.test.ts
```

Then full:

```sh
npm run type-check
npm test
```

---

## Phase 2 - Render closed plot memory

**Goal:** the narrator sees a small, authoritative list of finished work so it does not revive old arcs just because they are absent from active pressure.

### Changes

1. Extend `formatDossierBlock()` in `packages/server/src/server/render/state-block.ts`:
   - Add `### RECENTLY CLOSED` after active pressure sections.
   - Include last 3 resolved/failed threads.
   - Include last 3 completed/failed objectives.
   - Keep each line compact: title, status, summary/detail, and resolved/completed turn id when present.
   - Add wording: "Treat these as settled; do not revive unless current fiction explicitly creates a new complication."

2. Do not make closed rows playable pressure:
   - Do not feed closed rows into `pickPrimaryPressure()`.
   - Do not include closed rows under active quests/current objectives.
   - Do not let closed rows displace active pressure caps.

3. Add tests in `packages/server/tests/dossier.test.ts` or `packages/server/tests/dossier-ranking.test.ts`:
   - Closed rows render.
   - Closed rows are capped.
   - Active pressure still renders first.
   - Empty dossier still returns an empty string.

### Tests

```sh
npm test -- dossier.test.ts
npm test -- dossier-ranking.test.ts
```

---

## Phase 3 - Give archivist closed-state awareness

**Goal:** the archivist can distinguish "already done" from "newly introduced again" after recent transcript rotates away.

### Changes

1. Extract a pure prior-state builder if needed:
   - `buildArchivistPriorState(prior: NarratorWorldState)`
   - Keep `extractPatch()` focused on the LLM call.

2. Update the prior-state JSON in `packages/server/src/lib/archivist.ts`:
   - Add `recently_closed_threads`.
   - Add `recently_closed_objectives`.
   - Cap each at 5.
   - Include status, summary/detail, and resolved/completed turn id.

3. Update `packages/server/prompts/archivist-system.md`:
   - Add a lifecycle rule: child rows that reference a closed thread must not reopen it.
   - Instruct that reopening requires an explicit `story_threads[]` patch only when current fiction truly creates a new complication or transforms the thread.
   - Keep the model responsible for marking newly resolved work, but not for reviving old work implicitly.

### Tests

Add tests for `buildArchivistPriorState()` if extracted. Otherwise add tests around `buildArchivistUserContent()` inputs or a nearby pure seam.

```sh
npm test -- archivist.test.ts
npm test -- prompts.test.ts
```

---

## Phase 4 - NPC goal reconciliation

**Goal:** NPCs should stop planning around obsolete goals when the system knows the related plot/objective is closed.

### Changes

1. Extract a pure NPC context builder if needed:
   - `buildNpcAgentUserContent()`, `buildNpcContext()`, or both.
   - This makes the new context testable without a live LLM.

2. Extend `runNpcAgentTick()` in `packages/server/src/lib/npc-agent.ts`:
   - Include compact `story_context`.
   - Include active pressures relevant to the scene.
   - Include recently closed threads/objectives.
   - Keep the block global unless per-NPC filtering is simple and deterministic.

3. Update `packages/server/prompts/npc-agent-system.md`:
   - Tell the agent to revise `active_goal`, `current_focus`, or `long_term_agenda` when closed story state invalidates an old goal and the NPC plausibly knows the outcome.
   - Tell it not to pursue closed objectives unless the current player action introduces a new complication.
   - Preserve the rule that private beliefs only change when the NPC actually learned the fact.

4. Consider a follow-up pure domain service after `applyArchivistPatch`:
   - `reconcileNpcGoalsWithClosedDossier()`
   - It should only clear scene-immediate fields when the closure is explicit and the NPC is present or otherwise plausibly informed.
   - Do not add this in Phase 4 unless prompt/context alone fails tests or browser playtest.

### Tests

```sh
npm test -- npc-agent.test.ts
```

Add cases for:

- Closed objective appears in NPC agent context.
- Active pressure still appears.
- Prompt tells NPCs not to pursue closed objectives.
- No LLM call is required to test the context shape.

---

## Phase 5 - Improve archivist run gate

**Goal:** resolution-shaped turns should not be skipped before the archivist can close rows.

### Changes

1. Expand `hasRichStorySignal()` in `packages/server/src/domain/services/story-signal.ts`:
   - Add completion/resolution verbs: `complete`, `finish`, `resolve`, `settle`, `deliver`, `pay`, `secure`, `recover`, `defeat`, `escape`, `confess`, `reveal`, `prove`, `clear`, `fail`, `miss deadline`.
   - Add noun patterns for closure: `job done`, `case closed`, `debt paid`, `objective complete`, `mission complete`.

2. Update `shouldRunArchivistLlm()` in `packages/server/src/infrastructure/narrator/narrate-turn.ts`:
   - If the world has active dossier rows and the turn has outcome language, run the archivist.
   - Prefer passing a small state flag or active count into the gate over making the helper reach into state.
   - Keep deterministic patches working as today.

3. Add tests:
   - Resolution language triggers `hasRichStorySignal()`.
   - Ambient prose still does not trigger.
   - Active-dossier + outcome-language runs the archivist.

### Tests

```sh
npm test -- narrator-guidance.test.ts
npm test -- thread-bootstrap.test.ts
```

If story-signal has no dedicated test file, add one.

---

## Later track - deterministic memory summaries

Do this after the lifecycle/context fixes unless playtest still shows old arcs returning.

### Scope

1. Add deterministic memory rows or summary records for:
   - Scene closures.
   - Thread closures.
   - Objective completions/failures.
   - Relationship milestones.

2. Retrieve without embeddings first:
   - Match by thread title, place name, character name, and relevance tags.
   - Cap tightly.
   - Keep vector search as a later adapter improvement.

3. Do not depend on Voyage/vector infrastructure to fix the immediate bug.

## Architecture notes

- New logic belongs in `domain/services/` or application use cases.
- Repositories stay dumb CRUD.
- Prompt rendering stays in `server/render/` or prompt-adapter code.
- Do not add new modules to `packages/server/src/lib/`; when touching existing `lib/` files, move one step toward pure helper/use-case/adapters where practical.
- No schema change is expected for Phases 1-5.

## Accepted tradeoffs

- **More prompt tokens.** Closed dossier context costs tokens, but the block is capped and far cheaper than replaying full history.
- **More archivist calls on outcome turns.** The gate becomes less precision-biased when active dossier rows exist. This spends extra Haiku tokens to preserve continuity.
- **Prompt/context first for NPC goals.** A deterministic NPC-goal reconciliation service may still be needed, but starting with visible lifecycle state keeps the first pass smaller and easier to verify.
- **No vector memory yet.** Deterministic closed-state context fixes the immediate regression without waiting on embeddings.

## Exit criteria

1. `npm run type-check` passes.
2. `npm run lint` passes.
3. `npm test` passes.
4. New tests cover:
   - Closed parent threads are not reopened by child rows.
   - Recently closed rows render to narrator context.
   - Archivist prior state includes recently closed rows.
   - NPC agent context includes active and recently closed story state.
   - Resolution-shaped turns trigger the archivist gate.
5. Browser smoke: create or use a world with an active quest, complete the objective, advance several unrelated turns, then make a related reference. The narrator should treat the old work as settled unless the player explicitly reopens it.
6. If shipped as a bug fix, bump PATCH on the release branch per `docs/RELEASING.md` before merge/promotion.


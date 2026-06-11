# Thread Bootstrap + NPC Plans + Sequence Vigil unblock — Implementation Plan

**Status:** proposed (not started)
**Branch:** `onion-arch-refactor`
**Trigger:** diagnosis of world 5 "Sequence Vigil" (local Mongo) — empty dossier after 25 turns.

## Root cause (one cause, three symptoms)

The archivist (Haiku) and the NPC agent (Haiku) **reliably under-fill the optional structured arrays the engine depends on** inside their large combined `generateObject` schemas. They fill the *easy descriptive* arrays (`characters`, `npc_updates`) and silently omit the *hard structured* ones (`story_threads`, `planned_actions`) — even when an explicit MUST directive is present. Verified on world 5: 11 archivist patches all characters-only (the `THREAD_MANDATE_DIRECTIVE` was firing every dialogue turn and being ignored); 8 NPC-agent patches all `npc_updates`-only → `npc_intents = 0` → narrator never gets a PLANNED MOVES block. The fix principle for both: **a focused, minimal, REQUIRED schema** (and Grok where reliability matters) instead of an optional array buried in a big patch.

Each design below was produced and adversarially architecture-audited; **audit must-fixes are folded in**.

## Three work items

| # | Item | Type | Layer surface | Effort |
|---|---|---|---|---|
| A | Hand-author a starter thread for Sequence Vigil | data (one-off script) | operator-tooling, reuses ports | S |
| B | NPC-never-plans fix (force `planned_actions`) | code | domain svc + lib strangle-in-place + prompt | M |
| C | Thread-bootstrap fallback extractor | code | new port + domain svc + Grok adapter + prompt + wiring | M |

Recommended order: **A first** (immediate unblock + gives a non-empty dossier fixture to playtest B against), then **B**, then **C**. B and C are independent.

---

## A — Hand-author a thread for Sequence Vigil (data fix)

**Goal:** insert one active `story_thread` (+ objectives/clue) for world 5 so the dossier is non-empty and surfaces in the inspector/narrator context.

**Execution vehicle (audit-corrected):** a one-off TypeScript script run via **`npx tsx --conditions=react-server`** — the documented precedent (`packages/server/scripts/migrate-sqlite-to-mongo.ts`). Verified: `tsx` 4.22.4 is installed and `server-only` resolves to `./empty.js` under the `react-server` condition, so `initContainer()` and the ports import cleanly. (A plain node `.mjs` driving the container does NOT run — `server-only` throws and `@/*` aliases don't resolve.)

**Mechanism:** `packages/server/scripts/seed-sequence-vigil-thread.ts` —
1. `process.env.PERSISTENCE = 'mongo'`; `DATABASE_URL = 'mongodb://localhost:27017/chronicles?replicaSet=rs0'` (verified local Mongo).
2. `await initContainer()` → `getContainer()`.
3. **Resolve the world by name** `'Sequence Vigil'` (not assume id=5 — Mongo/SQLite id divergence gotcha), print resolved `PERSISTENCE` + world id first.
4. Idempotency: `dossierWriter.threadByTitle(worldId, title)` → skip if present.
5. Insert via the **real `DossierWriter` port** (`insertThread` allocates the id via `nextSeq('storyThreadId')` — verified the counter doesn't exist yet, so it's created cleanly; titleKey/timestamps/unique-index all handled). Then `insertObjective`/`insertClue` with `thread_id` = the returned id (manual linking, since direct-port skips the use-case's `resolveStoryThreadId`).
6. Read back via `dossiers.forWorld(worldId)` and log to verify.

**Authored content** (from the premise + Setnakht's three routes):
- Thread **"The Sealed Papyrus"**, kind `threat`, status `active`, summary (scribe carries a sealed papyrus implicating a court conspiracy under an ailing Ramesses III), stakes (discovery = execution for treason), `relevance_tags` ≈ `["thebes","temple","conspiracy","courier","papyrus","succession"]`.
- Three objectives (Setnakht's routes): reach the vizier's scribes (east of the temple of Amun); seek the western-tomb priests who remember harem conspiracies; destroy the letter and flee Thebes.
- One clue: the intact official seal (breaking it is irreversible).

**Verify:** read-back in-script; then open the dev app inspector for world 5; advance one turn and confirm the thread is in narrator context and `activeThreadCount > 0` (so the misfiring bootstrap mandate stops for this world). **Back up first** (CLAUDE.md data-repair rule) — `mongodump` the `story_threads`/`worlds` for world 5 or snapshot the volume before writing.

---

## B — NPC-never-plans fix (force `planned_actions`)

**Goal:** the NPC agent emits a `planned_action` for each present, plan-eligible NPC, so P4 (narrator MUST-stage) has something to stage and NPCs stop being purely reactive.

**Approach (Option D hybrid):** reorder + require + bounded focused retry — all Haiku, no Grok (hot pre-narrator path).
1. **Reorder** `planned_actions` **first** in `NpcAgentPatchSchema` (`lib/npc-agent.ts:197`) and add a MUST-PLAN imperative leading the schema describe + reuse the engagement-floor language already in `npc-agent-system.md`.
2. **Pure domain predicate** `missingPlannedActions(expectedPresentNames, planned)` in `domain/services/npc-promotion.ts` (set-difference, case-insensitive) — beside `isPlanEligible`.
3. **Bounded focused second pass:** when `missingPlannedActions(...)` is non-empty, one extra Haiku call with a *minimal* `PlannedActionsOnlySchema = { planned_actions: z.array(PlannedActionSchema).min(1) }` for just the missing names; merge its plans into `object.planned_actions` **before** the single existing insert loop.

**Audit must-fixes (baked in):**
- Derive `expectedPresentNames` from the **`tickable`** set (NPCs actually sent to the model / in `agentsByLower`), NOT `eligible`/`agents`.
- **Dedup** merged `planned_actions` by `npc_name` (case-insensitive, keep first) before the insert loop (`npc-agent.ts:471`) — the loop has no dedup and would double-insert `npc_intents`.
- Keep the merge **upstream of the one existing insert loop** so both SQLite (`lastInsertRowid`) and Mongo (`nextSeq`) allocate ids via the single code path — no second insert path, no parity re-proof.
- Persistence is via `applyNpcAgentPatch` + `npcIntents.insert` (NOT DossierWriter — that's item C).
- **Wrap** the focused-pass `generateObject` so its throw (incl. `AI_NoObjectGeneratedError` from `min(1)`) is caught → degrade to "keep first-pass plans"; give it `experimental_repairText: repairNpcAgentText` so its own mis-serialization is recovered.
- Sum both passes' `usage` into the returned `LanguageModelUsage`.

**Cost:** +1 Haiku call only on turns where a present eligible NPC was left unplanned (a minority after the reorder/MUST line warm up); tiny schema/short prompt; hard ceiling one extra call. Quiet turns already pay nothing (`shouldTickNpcAgent` gate).

**Composes with P1–P6:** `expectedPresentNames` ⊂ P1's `tickable`; reuses P2/P3 engagement-floor wording; **this is the upstream supplier P4 depends on** — guaranteeing `plans.length > 0` makes the `pickMomentumCue` `plannedActionCount>0` short-circuit and the narrator MUST-stage rule activate instead of being no-ops.

**Tests (flat `tests/`):** `missingPlannedActions` truth table; schema still safe-parses with reordered field; `repairNpcAgentText` Shape 1+2 regression after reorder; focused-pass merge (mocked) recovers a missing NPC's plan + sums usage; **no second call** when first pass covers all present NPCs; unknown-name plan still dropped at `agentsByLower`; dedup keeps first.

---

## C — Thread-bootstrap fallback extractor

**Goal:** a world reliably gets ≥1 `story_thread` when the dossier is empty and story pressure exists, without depending on Haiku to volunteer threads.

**Approach:** a focused, single-purpose fallback that fires only when (a) `bootstrapDossier` was warranted (`activeThreadCount===0 && hasRichStorySignal`, already at `narrate-turn.ts:517`) and (b) after the main archivist patch is applied, the world **still** has no active thread. A new `ThreadBootstrapper` port (threads-only schema, `min(1)` REQUIRED) backed by **Grok** (`NARRATOR_MODEL`, proven structured output in `grok-crew-generator.ts`, already understands the prose). Its result maps 1:1 into the **existing** `ArchivistPatch.story_threads` shape and persists through the **existing** `applyArchivistPatch → DossierWriter` path (no new persistence).

**Audit must-fix (baked in):** gate on a **post-apply re-query of the live dossier** — after `applyArchivistPatch(...)` in the `archivistPromise.then()`, `const after = await dossiers.forWorld(worldId)` and only bootstrap if `bootstrapWarranted && !after.threads.some(t => t.status === 'active')`. (Not on a count of `patch.story_threads`, which misses the case where the main patch *did* create one.)

**Onion placement:**
- `domain/ports/thread-bootstrapper.ts` — new pure interface + `ThreadBootstrapInput`/`Result` types (no SDK).
- `domain/services/story-signal.ts` — add pure `shouldBootstrapThread({ bootstrapWarranted, hasActiveThreadAfterApply })`.
- `infrastructure/world-gen/grok-thread-bootstrapper.ts` — `GrokThreadBootstrapper` via `generateObject(xai(NARRATOR_MODEL), ThreadBootstrapSchema)` + `withObjectRetry`; on failure return `{ threads: [] }` (graceful, mirrors npc-agent skip).
- `prompts/thread-bootstrap.md` — focused system prompt ("name exactly ONE central thread, kind quest/threat/mystery, summary/stakes + 2-5 lowercase tags").
- `infrastructure/narrator/narrate-turn.ts` — in the post-stream `archivistPromise.then()`, run the gate + bootstrapper + persist via `applyArchivistPatch({ story_threads })`; record `usage` under a `thread_bootstrap` metadata key.
- `composition/container.ts` — register `threadBootstrapper` in both the SQLite and Mongo branches.

**Cost:** one Grok call **once per world lifetime** (until the first active thread exists), only on bootstrap-warranted turns. Bounded.

**Composes with P1–P6:** orthogonal (threads vs NPCs); shares only the persistence infra.

**Tests (flat `tests/`):** pure `shouldBootstrapThread` gate (warranted+no-thread → true; has-thread → false; not-warranted → false); stub-`ThreadBootstrapper` apply test (its `threads` reach `dossierWriter.insertThread` through `applyArchivistPatch`, dual-store); adapter graceful-degrade on thrown error.

---

## Definition of done (per CLAUDE.md)
- `npm run type-check`, `npm test` (incl. `depcruise`), `npm run test:mongo` green after B and C.
- **A:** a backup taken; the script run once; the thread visible in the world-5 inspector and in narrator context on the next turn.
- **B:** a real NPC-agent tick produces a `planned_action` for a present NPC (verify by streaming a turn in the browser on world 5 and confirming an NPC takes a staged, initiated action).
- **C:** a fresh empty-dossier world gets an active thread within the first story-signal turn (browser-verified).
- No new modules added to `lib/`; new ports/services in `domain/`, adapters in `infrastructure/`, wiring in `composition/`.

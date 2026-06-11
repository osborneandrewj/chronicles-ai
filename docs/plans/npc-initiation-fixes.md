# NPC Initiation Fixes — Implementation Plan

**Status:** proposed (not started)
**Branch target:** `onion-arch-refactor` (or a feature branch off it)
**Problem:** NPCs rarely initiate conversation/interaction with the player. Root-cause evaluation: `memory/npc_initiation_rootcauses.md`.

## Framing

NPCs *can* initiate — the engine has three channels for it (the narrator improvising a present NPC from its agency fields; the `### PLANNED MOVES` block from the pre-narrator NPC agent; the momentum guidance cue). The failure is **compounding gates + softness**, not absence. This plan addresses each of the six root causes with the fix placed in the correct onion layer. Two of the fixes (P1, P3) also re-cut an existing architecture leak — a *decision* currently living inside an adapter — which the blueprint requires moving inward when touched.

Each fix below was independently designed against the real code and then adversarially audited for onion/SoC correctness, dual-adapter (SQLite + Mongo) parity, and dependency-cruiser CI. **Audit corrections are folded into the steps.**

### Cross-cutting facts (apply to all steps)
- **Tests are flat in `packages/server/tests/`**, NOT colocated with source. Every new/updated test goes there (e.g. `tests/npc-agent-gating.test.ts`, `tests/seed-tension.test.ts`). The designs' colocated `src/.../*.test.ts` paths are wrong — use `tests/`.
- **`lib/` is the legacy "strangle" layer, not `application/`.** `lib/npc-agent.ts` is mid-migration; it may import a domain service (inward) but is not a clean use case. Don't describe it as `application/` and don't add new logic to `lib/` — only adjust the call site.
- Two persistence adapters must stay at parity: `persistence/sqlite/` + `persistence/mongo/` + the port in `domain/ports/` + the Mongo mappers. Only P1 touches persistence.
- Run `npm run depcruise`, `npm run type-check`, `npm test` (SQLite) and `npm run test:mongo` (Mongo, for P1) before each PR.

## Recommended sequencing

Ship in **three PRs**, cheapest-and-highest-leverage first. The prompt/domain quick wins deliver most of the player-visible improvement; the structural leak-fix lands second; the off-screen enrichment last.

| Order | Items | Layer surface | Effort | Why this order |
|---|---|---|---|---|
| **PR 1 — Prompt & guidance quick wins** | P4, P2, P5 | prompts + 1 pure domain service | S | No persistence/port changes; biggest behavior delta per line. P4 alone binds the narrator to the plans it already receives. |
| **PR 2 — Tick coverage + cold-open (the leak fixes)** | P3, P1 | domain services + both repos + port | P3=S, P1=M | P3 opens the agent on quiet turns; P1 gives it newly-met NPCs to plan for. Land together so the gate's "someone to plan for" matches P1's eligibility. |
| **PR 3 — Off-screen substrate** | P6 | 1 pure domain service + use case + prompt | S | Lowest direct ROI for "NPCs don't talk to me"; enriches the motive/beat substrate P1–P5 surface. Defer until PR 1–2 land. |

Dependency notes: P5 reads `plannedActionCount` (gates its cue on `=== 0`), so it's coherent with P4 — land them in the same PR. P1 and P3 are mutually reinforcing (audit-confirmed) — same PR.

---

## PR 1 — Prompt & guidance quick wins

### P4 — Bind the narrator to the PLANNED MOVES it already receives  *(sharpest, cheapest)*
**Problem:** `narrator-system.md` never mentions the `### PLANNED MOVES THIS TURN (agent NPCs)` STATE block; the only "stage these" instruction lives in a *code comment* (`state-block.ts:261-269`). Reverie flares get a hard "MUST shape the NPC this turn" (`narrator-system.md:75`); planned NPC moves get nothing — so the narrator can silently drop the one concrete initiation signal the system computed.

**Layer:** prompt only (the structured `plannedActions` value already crosses the boundary; only the narrator adapter's rendering dialect changes). `isLeakFix: false`.

**Changes:**
1. `packages/server/prompts/narrator-system.md` — insert a new **MUST-stage paragraph** inside the **"NPCs Are People"** section, immediately **after the reverie ⚡ FLARING SUBTEXT MUST paragraph (line 75)** — *(audit correction: the design text mis-cited "after line 77"; line 75 is the reverie MUST, 77 is the perception rule)*. Wording requirements:
   - The narrator **MUST realize each present agent-NPC's planned move as something that actually happens this turn**, faithful to its intent.
   - **Realize the intent, not the instruction** — the NPC may resist, fail, hesitate, or do it their own way; render it in the narrator's craft (free to adapt phrasing/voice/timing). Never name the block or any mechanics; fold it into prose.
   - **Precedence clause:** a planned move *is* "something new," so it overrides the omit-by-default bias and is **exempt from "No full-roster posture sweep"** (lines 45, 50).
2. `packages/server/src/server/render/state-block.ts:271` (block header) — **do NOT add the "— each MUST happen on the page this turn" suffix** the design proposed. *(Audit correction: that injects the mechanics word "MUST" into rendered per-turn structure the narrator reads verbatim, risking an echo. The prompt rule fully solves the problem; the header suffix is redundant.)* Leave the header as-is, or at most a mechanics-neutral phrasing with no imperative vocabulary.

**Tests:** `tests/prompts.test.ts` (exists) — assert the new MUST-stage marker text is present in `narrator-system.md`. No code path test needed.
**Risk:** over-literal "robotic script" staging — mitigated in the wording ("realize the intent, not recite the instruction; they may resist or fail").

### P2 — Re-balance the NPC-agent prompt so initiation isn't steered away from the player
**Problem:** even when the tick fires, `npc-agent-system.md` over-steers toward NPC↔NPC: "at most one or two should acknowledge the player… the rest doing their own thing," "target another NPC, not always the player… the player left out entirely — that is fine," "inaction is a decision."

**Layer:** prompt only (`prompts/npc-agent-system.md`, loaded via `loadPrompt('npc-agent-system')` in `lib/npc-agent.ts:413`). `isLeakFix: false`.

**Changes:** `packages/server/prompts/npc-agent-system.md` — in the **"Proactive NPC Behavior"** section (~65-100) and line 62:
- Add an explicit **single-NPC engagement floor**, phrased **"at least one — and ideally only one — present NPC should direct a plan at the protagonist"** on a turn where the player has been talked-around/passive. The "at least one, ideally only one" framing is load-bearing: it must NOT read as "everyone engages."
- Qualify **"the player is left out entirely — that is fine"** to apply to **a single turn / an overheard beat**, not a sustained pattern.
- Keep the NPC-NPC dynamics and "vary who responds" intact.

**Groundedness *(audit correction):*** the design claimed the agent sees "the last ~4 turns" — **inaccurate; the agent sees only the most recent narration plus the player's current input** (verify against what `lib/npc-agent.ts` passes into `npcContext`). Therefore make the **floor unconditional** ("on any turn with a present agent NPC, at least one directs a plan at the protagonist unless physically prevented") — that carries the fix. A *conditional* "raise priority when the player has been ignored" clause is only partly groundable from one prior narration, so phrase it as soft judgment, not a hard trigger.
**Optional follow-up (separate M change, not in this PR):** a pure domain service computing `turnsSincePlayerDirectlyEngaged` from `npc_intents` target history, threaded into `npcContext`, to make the floor robust instead of judgment-based.
**Tests:** `tests/prompts.test.ts` — assert the engagement-floor marker text exists.

### P5 — Add a tier-1 "a present NPC may step forward" cue + a standing narrator license
**Problem:** the only routine pro-initiative push (the L2 "world acts" momentum cue) is gated at `MOMENTUM_IDLE_THRESHOLD=2`; a *single* idle move with a present NPC gets nothing, while the guidance routinely injects "Leave at least one branch the player can pursue."

**Layer:** DOMAIN (`narrator-guidance.ts`, already pure) + prompt. `isLeakFix: false`.

**Changes:**
1. `packages/server/src/domain/services/narrator-guidance.ts` — add a pure helper `pickEngagementCue(ctx)` that fires **only when** `idle === 1` (i.e. below the L2 threshold) **and** `presentNpcCount >= 1` **and** `plannedActionCount === 0` (don't double-instruct alongside a P4 planned move). Call it in the **else-branch of `pickMomentumCue`** (mutually exclusive with L2). Keep `MOMENTUM_IDLE_THRESHOLD=2` and the L2 cue unchanged — this preserves the escalation ladder (NPC presses at idle=1 → world intrudes at idle≥2). Both fields (`presentNpcCount`, `plannedActionCount`) are already on `GuidanceContext` and already populated by `narrate-turn.ts` — verified.
   - ***Audit correction — turn-1 guard:*** add a `ctx.recentTurns.length > 0` condition so the cue does **not** fire on the opening "I look around" beat (where `idle` computes to 1 with empty history) and pre-empt the establishing turn.
2. `packages/server/prompts/narrator-system.md` — under "NPCs Are People," add a standing **license**: a present NPC may directly address the protagonist by name and press for a response (a pointed question, a demand, a held look) — clarify that **"create a situation, not a forced choice" forbids a *menu*, not an NPC pressing the protagonist**, and re-affirm "never decide the protagonist's reply/feelings" in the same sentence (the non-negotiable "Never present a menu of choices," line 96, stays untouched).

**Tests:** `tests/narrator-guidance.test.ts` — fires at `idle===1` with present NPC + no plan; suppressed when `plannedActionCount>0`; suppressed when `presentNpcCount===0`; **does not fire on turn 1 (empty `recentTurns`)**; L2 "world acts" still fires (and engagement does not) at `idle>=2`; no fire on a driving move. (Tests import via the `@/lib/narrator-guidance` re-export shim, consistent with existing tests.)

---

## PR 2 — Tick coverage + cold-open (the architecture leak fixes)

### P3 — Extract `shouldTickNpcAgent` to a domain service + tick on quiet turns  *(leak fix)*
**Problem:** the tick is skipped on the very turns NPCs should carry — on `observe`/passive in-character turns it only fires if a present NPC is *already* `local`/`nearby`. And the predicate is a pure decision living inside an infrastructure adapter (`narrate-turn.ts:626-636`) — a leak.

**Layer:** DOMAIN (new `domain/services/npc-agent-gating.ts`, mirroring `beat-gating.ts`) + the adapter calls it. `isLeakFix: true`.

**Changes:**
1. New `packages/server/src/domain/services/npc-agent-gating.ts` — export `shouldTickNpcAgent({ stance, inputMode, presentCharacters })`, pure, importing only `type CharacterAgencyLevel` from `domain/entities` (exact `beat-gating.ts` precedent — depcruise-clean). Keep the hard exclusions (OOC/meta/think → false) and unconditional `do`/`say` → true. **Change the passive branch:** tick whenever **any present, non-player, non-dead NPC exists** — not only `local`/`nearby`. Real per-NPC eligibility is enforced downstream by `agentNpcsForTick`'s cadence query + `shouldSkipRoutineTick` (which returns no agents → the tick is a cheap no-op), so this gate is only the "is there anyone to plan for?" guard.
2. `packages/server/src/infrastructure/narrator/narrate-turn.ts` — delete the local function (~626-636); add the import (alphabetized, inward-only). *(Audit nit: there is no `npc-movement` import here to alphabetize "near" — just place it correctly among the `@/domain/services/*` imports.)*

**Cost note:** more quiet turns now call Haiku, but bounded — it cannot exceed the prior `do`/`say` worst case, and empty candidate sets short-circuit.
**Tests:** `tests/npc-agent-gating.test.ts` (new) — characterization of the old true/false cases + the new "passive turn with a present `npc`-tier NPC now ticks."

### P1 — Close the cold-open dead zone: make co-located new NPCs plan-eligible  *(leak fix)*
**Problem:** a newly-met NPC sits at `agency_level='npc'`, excluded from `agentNpcsForTick`'s WHERE (`local/nearby/distant/agent`), so it never gets a PLANNED MOVE for its first ~3 encounters (`AUTO_PROMOTE_THRESHOLD=3`). The eligibility WHERE-clause is also a leaked decision inside both repositories.

**Approach (chosen):** keep `AUTO_PROMOTE_THRESHOLD=3` (lowering it makes one-shot walk-ons chatty). Move the **tier-eligibility decision** into a pure domain predicate `isPlanEligible`, widen the repo query to also admit co-located `npc`-tier rows (a query concern — cadence arithmetic for established tiers legitimately stays in SQL), and let the orchestrator apply the predicate. Rejected: full raw-rows recut (larger than needed).

**Layer:** DOMAIN predicate + port signature; both repos widen their candidate query; `lib/npc-agent.ts` call site filters. `isLeakFix: true`. **This is the only item touching persistence — full dual-adapter parity required.**

**Changes:**
1. `packages/server/src/domain/services/npc-promotion.ts` — add pure `isPlanEligible({ agency_level, present_with_protagonist, is_transient_service })`: agent-tier rows always eligible; `npc`-tier eligible only when `present_with_protagonist && !is_transient_service`. Sits beside `isTransientServiceNpc`/`nextAgencyTier`.
2. `packages/server/src/domain/ports/character-repository.ts` — `agentNpcsForTick(worldId, tickTurnId, playerPlaceId: number | null)`; update the doc-comment (returns agent-tier-on-cadence **plus** co-located `npc`-tier candidates; eligibility decided in the domain service).
3. `packages/server/src/infrastructure/persistence/sqlite/character-repository.sqlite.ts` —
   - Widen `agentNpcsStmt` WHERE to `(<existing agent-tier+cadence branch>) OR (agency_level='npc' AND current_place_id = ?playerPlaceId)`.
   - ***Audit correction (tsc-breaking if missed):*** widen the prepared-statement generic at line 151 from `db.prepare<[number, number, number, number]>` to a **5-tuple** (the new `playerPlaceId` param).
   - Pass `playerPlaceId ?? -1` (non-matching sentinel when the player has no place, so the OR branch adds nothing).
4. `packages/server/src/infrastructure/persistence/mongo/repositories/character-repository.mongo.ts` — mirror: add `playerPlaceId` param; OR-in `{ agencyLevel:'npc', isPlayer:false, status:{$ne:'dead'}, currentPlaceId: playerPlaceId }`, **guarded so a null `playerPlaceId` adds no branch** (must produce an identical row set to the SQLite `-1` sentinel).
5. `packages/server/src/lib/npc-agent.ts` — hoist the player's `current_place_id` read above the `agentNpcsForTick` call; pass it; filter fetched candidates through `isPlanEligible` (computing `is_transient_service` via `isTransientServiceNpc`, `present_with_protagonist` via `current_place_id === playerPlaceId`) before `shouldSkipRoutineTick`.
6. ***Audit correction — close the write-back gap (don't leave as "verify"):*** `findAgentNpcByName` in **both** adapters (`sqlite:176-182` + mongo) filters `agency_level IN ('local','nearby','distant','agent')`, so a plan authored for a brand-new `npc`-tier NPC **won't resolve back** when the agent patch writes `recent_activity`/focus. Widen `findAgentNpcByName` in both adapters to also match a co-located `npc`-tier row (or the plan silently no-ops). Mirror in the port if its signature changes.

**Tests *(all in `packages/server/tests/`, not colocated):***
- `tests/npc-promotion.test.ts` — `isPlanEligible` truth table (agent-tier always; `npc`-tier present+non-transient → true; transient or off-place → false).
- `tests/npc-agent.test.ts` — the runNpcAgentTick oracle: a co-located new `npc`-tier non-transient NPC now receives a candidate row + plan; a transient walk-on does not.
- `tests/bounded-world-repositories.test.ts` + `tests/mongo/` (run under `test:mongo`) — **parity:** SQLite and Mongo `agentNpcsForTick` return identical row sets for `playerPlaceId = null` and for a real id; `findAgentNpcByName` resolves a co-located `npc`-tier row in both.
- Update any existing characterization test asserting the old `agentNpcsForTick` WHERE; note the intended behavior change.

**Risks:** crowded room → more Haiku calls (bounded by `shouldSkipRoutineTick`); SQL/Mongo divergence (parity tests are the guard).

---

## PR 3 — Off-screen substrate (deferred, lowest direct ROI)

### P6 — Seed fresh-world relationship tension so the living sim can fire
**Problem:** off-screen beats fire only when a co-located group's `|valence| >= 0.25` (ANDed with a 4-turn cooldown). A fresh world's near-neutral seeded valences never clear it, so emergent off-screen drama is ~zero. (This never *directly* makes a present NPC address the player — its payoff is indirect: it populates the beats/motives/reveries that P1–P5 surface. **Deferred deliberately.**)

**Layer:** new pure `domain/services/seed-tension.ts` run by the seed **use case** (the "decide before persisting" pattern) + a prompt nudge. Gating thresholds stay unchanged. `isLeakFix: false`.

**Changes:**
1. New `packages/server/src/domain/services/seed-tension.ts` — `ensureSeedTension(rels, opts)`: if **no** edge has `|valence| >= 0.3`, bump the single most-charged edge's magnitude to a `0.35` floor. ***Audit correction — fix the dead ternary:*** the design's `const sign = rels[idx].valence < 0 ? -1 : -1` always yields `-1`, which silently flips a weak-*positive*-only ensemble to negative and contradicts the "sign preserved" test. Decide explicitly: **either** preserve sign (`Math.sign(v) || -1`, default to tension only when exactly 0) **or** document the intentional always-tension bias and drop the "sign preserved" test. Pick sign-preservation with an all-zero → `-0.35` fallback; it's the least surprising.
2. `packages/server/src/application/use-cases/seed-bounded-world.ts` (~166) — run `ensureSeedTension` over `dressing.relationships` before building `relationshipEdges`.
3. `packages/server/prompts/ensemble-dressing.md` (~35) — make "some have real tension" a hard constraint: **at least one relationship `|valence| >= 0.4`** (rivalry/distrust/strained history **between crew members**, never aimed at the newcomer). The domain service is the backstop if Grok ignores it.
4. `packages/server/src/infrastructure/world-gen/stub-crew-generator.ts` (~73) — optional parity nudge: flip the first all-`+0.4` ally edge to a `rival` at `-0.4` so the offline/test seed path is also beat-eligible.

***Audit correction — layer label:*** `DEFAULT_TENSION_THRESHOLD = 0.25` lives in `application/use-cases/tick-living-world.ts:53`, **not** in a domain gating service. There is no code link between it and `SEED_TENSION_FLOOR`. Add a test asserting `SEED_TENSION_FLOOR (0.35) >= the live threshold (0.25)` so a future threshold bump can't silently make the floor stop clearing it.

**Tests *(in `packages/server/tests/` — these are NEW files; effort is "S" but both harnesses are authored from scratch):***
- `tests/seed-tension.test.ts` — all-zero → exactly one edge `-0.35`; an edge already `>=0.3` → unchanged; weak edges → most-charged bumped, **sign per the decision above**; empty → empty; determinism (tie → lowest index); `SEED_TENSION_FLOOR >= 0.25`.
- Extend the seed-bounded-world use-case test (create if absent) — persisted relationships contain ≥1 edge `|valence| >= 0.25` even from a near-neutral ensemble.
- Update any stub-crew-generator golden/snapshot test for the new first-edge rival.

---

## Definition of done (per CLAUDE.md)
- **Each PR:** `npm run depcruise`, `npm run type-check`, `npm test` green; **PR 2 also** `npm run test:mongo` green (parity).
- **P4/P2/P5:** stream a turn end-to-end in the browser and confirm an NPC stages a planned move / presses the player on a quiet turn.
- **P1:** a brand-new co-located NPC initiates on first encounter; a one-shot cashier/barista does not.
- No new logic added to `lib/`; no cross-layer imports; the two extracted predicates (`isPlanEligible`, `shouldTickNpcAgent`) live in `domain/services/` and are unit-tested.

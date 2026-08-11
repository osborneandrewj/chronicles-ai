# Narrator Craft Freedom — Implementation Plan

**Status:** shipped (v0.6.0) — S1+S2+A+B landed; C/D deferred pending playtest gate
**Branch target:** `feat/narrator-craft-freedom` off `main` (or current integration branch)
**Target release:** next **MINOR** after the branch lands (e.g. `0.N.0` — bump on the feature branch before merge; see `docs/RELEASING.md`)
**Authored:** 2026-08-10
**Revised:** 2026-08-10 — prod audit of **The Threshold Accord** (world #5). Story-motion failure is a **sibling track (Phase S)** that must land *before* sparsifying momentum guidance; craft freedom alone will not fix “nothing happens unless the player forces it.”
**Revised:** 2026-08-11 — hardened S1/S2 contracts from plan review: structured plan salience, open-order lifecycle (no in-memory-only), pre-stream status production, TTL refresh on yield beats, Decisions/rollback/tests aligned with S-first sequencing. Cap ambient plans in STATE deferred out of S1.
**Trigger:** Architecture review of the Grok narrator control stack — conclusion that **stateless calls are correct**, while **craft direction has accumulated into an over-defensive checklist** that taxes the model’s creative headroom.
**Related (do not conflate):**

| Doc | Relationship |
|---|---|
| [archive/narrator-controls-story-continuity](archive/narrator-controls-story-continuity.md) | **Opposite polarity, both correct.** That plan *tightened* structure (inventory, clock, identity, primary pressure). This plan *loosens craft direction* without undoing those pins. |
| [turn-latency-and-narrator-pacing](turn-latency-and-narrator-pacing.md) Track B | This plan **is** the concrete specification of Track B3 (“re-measure, then decide”). B1 (overfit constants) and B2 (reverie loop live) remain recommended prerequisites for clean attribution. |
| [archive/npc-initiation-fixes](archive/npc-initiation-fixes.md) | Shipped P1–P5 (plans MUST-stage, engagement floor, quiet-turn ticks). Threshold Accord shows those channels fire but deliver **busywork**, not **plot outcomes** — next gap is outcome quality / pressure resolution, not “can NPCs plan.” |
| [thread-bootstrap-and-npc-plans](thread-bootstrap-and-npc-plans.md) | Related: forcing `planned_actions` reliability. Orthogonal to *what* plans contain (texture vs consequence). |
| [reference/npc-narrator-design-evaluation-v2](../reference/npc-narrator-design-evaluation-v2.md) | Already warned: *“Narrator prompt can become over-defensive if craft guidance turns into long failure-mode checklists.”* |
| [specs/memory-architecture](../specs/memory-architecture.md) | Reinforces the non-negotiable: *“The LLM does not remember. The system decides what it remembers.”* Statelessness stays. |

## Goal

Two complementary goals (same release train, **different levers**):

1. **Craft freedom** — Give Grok more **novelistic freedom** on *how* a turn is written, while the system remains the sole source of truth for **what is true now**.
2. **Story motion** — Ensure the **world advances stakes** when the player waits, continues, or leaves an open order outstanding — characters and events act without the player micromanaging every beat.

**Principles:**

> **Facts stay pinned; craft becomes sparse.** Authoritative STATE and history packing stay; always-on recipes, numeric length bands, and double-steering go.

> **Pressure resolves; busywork is not agency.** Planned moves and living-world ticks must deliver *plot-facing outcomes* (arrival, confrontation, clock bite, institutional response), not only console fidgets and restated stillness.

Success is not “the model talks more.” Success is: length variance + texture **and** turns where the player can sit back and still feel the world move — **without** regressions in place, inventory, identity, menus, or PC agency.

## Companion finding — The Threshold Accord (prod world #5)

**Export:** 2026-08-10 via `export-world-mongo.mjs` — 154 turns, 125 `npc_intents`, 3 active threads, Day 5 evening, bounded hub research facility.

### What the player experienced (verbatim beats)

| Player | What the engine did | What should have happened |
|---|---|---|
| “Andy Osborne. Bring him to me, now.” | Officer keys radio; units search — **Andy never enters** | Retrieval starts **and** progresses to a result (found / fled / refused / ETA) |
| “I sit down… and wait for Andy” | Narrator **re-seats** the PC; officers “keep radio open” | Arrival, radio update with location, or explicit delay with cost |
| “Continue” | **Restates** chair / server vibration / chill air | Time or search advances; someone walks in or reports |
| “10 minutes later” | Clock → 18:14; still **no Andy**; more log-watching | Ten minutes of search **must** land a concrete outcome |

Andy’s durable row after this sequence: still `agency_level: npc`, place **Administrative Wing**, `last_known` frozen on a **cafeteria exit** from much earlier (`recent_activity` ends `[t:377]`). Living-world / agent never treated him as the load-bearing off-screen actor for the open order.

### Smoking gun in code (not “Grok is lazy”)

1. **`plannedActionCount > 0` suppresses both L1 engagement and L2 world-acts** (`pickMomentumCue` / `pickEngagementCue` in `narrator-guidance.ts`).  
   On the wait/continue/time-jump sequence, the NPC agent emitted **3–4 planned moves every turn** (console officers typing, headset, “keeps radio open”). Those count as “the intrusion already happened,” so momentum **never fires** — even though no plot beat resolved.

2. **Plans are texture, not outcomes.** Last-40 narrator turns: **33/40** carried `planned_actions`. Intent reconciler mostly `staged` (116 staged / 125). Staging works; content is “fingers on keyboard / layered facility map,” not “Andy is escorted in” or “unit reports empty quarters.”

3. **Off-scene load-bearing NPCs stay plain `npc` and non-present → not plan-eligible.** `isPlanEligible`: plain `npc` only when co-located. Andy was off-scene with `agency_level: npc` → **no agent plan for him**. Present local walk-ons monopolize the plan slots.

4. **Dossier pressure is inert on the page.** Active threads include *Restricted Contact and External Pressure* and *Sage’s Escalation Report*, plus a stale *First Shift in the Immersion Lab* quest. Primary pressure is injected for investigative moves / idle momentum — but momentum is suppressed by (1), and idle guidance never forces **resolution of an open player order**.

5. **“Continue” classifies as `stance: do`.** Idle heuristics still match `continue`/`wait` text, so L2 *would* be available — except (1) kills it whenever the room is full of busywork plans.

### Implication for this plan

| If we only ship A/B (sparse craft) | Risk |
|---|---|
| Fewer observation recipes | May improve prose |
| **Sparser momentum** without fixing plan-suppression | **Worsens** “world doesn’t move” |
| Phase D softens MUST-stage | Irrelevant — plans already stage; they just don’t *matter* |

**Therefore:** Phase **S (story motion)** is in-scope for this document as a **prerequisite track**, not a vague future idea. Craft freedom (A–C) still ships, but **do not thin momentum/engagement until S1 lands.**

## Why

1. **Craft control has outgrown continuity control.** `prompts/narrator-system.md` (~3k words) is a novelist brief plus a pile of incident patches (restatement, posture sweep, ambient closers, menus, orientation, reverie leaks, planned-move MUST, length bands). Each rule earned its keep; together they teach the model to play defense.
2. **Double-steering every turn.** `formatNarratorTurnGuidance` re-asserts many of the same craft rules the system prompt already states (observation length, dialogue audibility, world-acts, engagement). Always-on guidance crowds the trailing user message next to STATE.
3. **Statelessness is not the choke.** Fresh assembly each turn is required for multi-session worlds, archivist/NPC agents, and cost. The fix is **what we re-inject and how bossy it is**, not multi-hour provider sessions.
4. **STATE density competes with prose memory.** History packing (~4.2k full-token budget, narrator-first) is healthy. The trailing STATE + dossier + private fields + occupancy + planned moves can still dominate attention. Thinning *directive craft* is phase 1; **budgeting STATE harder than history** is phase 2.
5. **Docs overstate output throttle.** Agents.md still says “8K input / 1K output”; live `streamText` has **no** `maxOutputTokens`. Soft length bands + guidance are the real length drivers — treat them as levers, not as an imaginary hard cap.

## Non-goals (explicit)

- **Do not** open multi-turn provider memory / “let Grok remember the whole session.”
- **Do not** remove or soften **Tracked Objects / Place / Time / Present / PLAYER CANON** authority (v0.5.0 continuity work stays).
- **Do not** merge narrator + archivist or let the narrator emit structured state.
- **Do not** dump unpaked full history to chase “more context.”
- **Do not** ship embeddings / vector retrieval in this plan (future memory win; separate plan).
- **Do not** re-litigate NPC initiation (P4 MUST-stage already shipped) without a measured playtest baseline — planned-move softening is an **optional later phase** with a default stay-as-is.
- **Do not** let the narrator invent off-scene relocation (or open-order resolution) as the only source of truth — resolution is a system fact written into STATE before or with the turn; the narrator dramatizes it.

## Current control stack (as-built)

```
player action
  → classifier (stance / input_mode)
  → NPC agent plans ∥ occupancy
  → formatStateBlock + formatNarratorTurnGuidance
  → streamText(
        system: NARRATOR_BASE + PREMISE,     // cache-stable
        history: packNarratorHistory(...), // ~16 turns, full budget 4200 tok
        user:   STATE + off-screen + REALITY + CLASSIFICATION + guidance + action
     )
  → archivist / clock / living tick (post-stream)
```

| Layer | File | Today’s role | This plan’s intent |
|---|---|---|---|
| System craft + hard rules | `prompts/narrator-system.md` | Long checklist | Split: short craft + short hard constraints |
| Soft turn director | `domain/services/narrator-guidance.ts` | Often always-on recipes | Sparse: fire only on detected risk |
| Authoritative now | `server/render/state-block.ts` | Full ledger + dossier | Keep pins; later rank/slice harder |
| History memory | `domain/services/history-packer.ts` | Narrator-first packing | Keep (already the right pattern) |
| NPC stage directions | STATE `### PLANNED MOVES` + system MUST | All plans must land | Optional soften (phase D) |

## Architecture sketch (target prompt shape)

```
┌─────────────────────────────────────────────────────────┐
│ system (cache-stable per world)                         │
│   NARRATOR_CRAFT        (~short novelist brief)         │
│   NARRATOR_HARD_RULES   (~short non-negotiables)        │
│   PREMISE                                               │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ history (packed, narrator prose preferred full)         │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ user (mutates every turn)                               │
│   STATE (facts only — no craft essays)                  │
│   [optional sparse TURN GUIDANCE — only if risk fires]  │
│   PLAYER ACTION                                         │
└─────────────────────────────────────────────────────────┘
```

**Dependency direction unchanged:** pure guidance stays in `domain/services/`; markdown dialect stays in `prompts/` + `server/render/`; inference stays in `infrastructure/narrator/narrate-turn.ts`. No new onion violations.

---

## Phased work

Recommended order: **0 → S1 → S2 → A → B → playtest gate → C → (optional D / S3)**.

- **0** always runs first (baseline); the Phase S *section* is written before Phase 0 below only because it is the product core — do not code S without a Phase 0 baseline folder.
- **S** fixes “nothing happens unless the player forces it” (Threshold Accord class).
- **A/B** free craft once motion safety nets are trustworthy.
- **C** thins STATE after both feel right.
- **D** only if scripts still feel robotic *after* plans carry real outcomes.

---

### Phase S — Story motion *(prerequisite; structure + prompts)*

**Goal:** when the player yields the beat (wait / continue / time jump / open order), the **world produces a plot-facing outcome** within 1–2 turns — not ambient restatement.

#### S1 — Stop busywork plans from eating the intrusion budget *(highest leverage)*

**Problem:** any `plannedActionCount > 0` zeros L1/L2 guidance, so a room of console fidgets permanently disables “world acts.”

**Changes:**

1. **Salience-aware intrusion budget** in `formatNarratorTurnGuidance`:
   - Treat plans as “consuming the intrusion slot” only if at least one plan is **plot-salient** (addresses protagonist with demand/question, advances an open order, relocates a named dossier character, raises threat/clock).
   - Pure helper e.g. `summarizePlanSalience(plans, openOrder)` returns `{ salientCount, busyworkCount, advancesOpenOrder }`. It lives in `domain/services/` and uses structured fields first (`intent_type`, `target_npc_name`, `target_place_name`, target IDs, open-order target), with prose keywords only as a conservative fallback. Adapters may pass loaded plan data in; they must not own the salience decision. (`PlannedActionSchema` already exposes `intent_type` / `target_npc_name` / `target_place_name`.)
   - If plans are all low-salience busywork **and** idle≥threshold → **still emit L2 world-acts** (or a sharper “resolve open pressure” cue).
2. **NPC agent prompt** (`npc-agent-system.md`): under proactive behavior, add **outcome floor** — when the player is waiting on a named result (retrieval, report, arrival, reply), **at least one plan this turn must advance that result** (arrive / radio a concrete status / refuse / reveal obstacle). “Monitors channel” alone is not a valid plan while an open retrieval is outstanding.
3. **Do not cap ambient plans in STATE in S1.** Full `### PLANNED MOVES` stay visible while MUST-stage remains the default (Phase D). Capping rendered plans while the reconciler still expects every `intent_id` creates a silent drop. Salience is for **guidance intrusion budget only** in S1; optional STATE plan capping is deferred to **D / S3**.

**Files:**

```
domain/services/narrator-guidance.ts     EDIT — salient-plan gate for momentum
domain/services/plan-salience.ts         NEW — pure plan salience summary
infrastructure/narrator/narrate-turn.ts  EDIT — pass salience summary / open-order context
prompts/npc-agent-system.md              EDIT — outcome floor
tests/narrator-guidance.test.ts          EDIT — busywork plans do NOT suppress L2
tests/plan-salience.test.ts              NEW — structured fields beat prose regex
```

**Tests:** fixture: idle×2 + 3 busywork plans + open “bring X” → world-acts (or resolve-open-order) **present**. Idle×2 + one “X enters with escort” / `target_npc_name=X` / `intent_type=retrieve|escort|arrive|report` plan → world-acts **absent** because the plan itself advances the outcome. Idle×2 + raw `plannedActionCount > 0` with only busywork → L2 still fires (regression lock for the Threshold smoking gun).

**Risk:** medium — need a cheap, non-LLM classifier for “salient.” Prefer structured fields already on plans over prose regex when possible.

#### S2 — Open-order + off-scene load-bearing NPCs *(Threshold Andy case)*

**Problem:** player orders “bring Andy”; Andy stays `npc` off-scene → never plan-eligible; living tick doesn’t complete the retrieval; narrator restates the chair.

**Changes (pick minimum viable set):**

1. **Open order extraction (deterministic first):** when player text matches retrieval/summon/wait-for patterns naming a known character, stamp a short-lived **open order** domain value carried into guidance + NPC agent context.
2. **Lifecycle contract:** v1 must be durable or derivable across retries/reloads/processes — **no in-memory-only carry**. Prefer deriving the active order from recent user-turn metadata / recent turns with a strict TTL before adding a table. Shape:

   ```ts
   type OpenOrder = {
     targetCharacterId: number
     targetName: string
     kind: 'retrieve' | 'await' | 'deadline'
     createdTurnId: number
     /** Player-turn TTL. Threshold script is retrieve → wait → continue → time-jump (4 beats). */
     expiresAfterPlayerTurns: 4
     status: 'pending' | 'resolved' | 'expired'
     resolution?: 'arrived' | 'status' | 'refused' | 'obstacle'
   }
   ```

   - **TTL default: 4 player turns** (not 2) so the real Threshold wait script still holds the order.
   - **Refresh on yield:** any idle / continue / wait / explicit time-jump while `status === 'pending'` extends or resets the remaining TTL so a long stakeout does not expire mid-scene.
   - **Zombies:** expire when TTL elapses without refresh, or mark `resolved` when status lands; never leave perpetual pending orders.

3. **Write path (player-turn metadata via existing port):**
   1. After the player turn is inserted (pre-stream path already has `playerTurnId`), run pure `detectOpenOrder(playerText, knownCharacters)`.
   2. On hit: `turns.mergeMetadata(playerTurnId, 'open_order', OpenOrder)` (same commutative metadata merge used for agent blocks).
   3. Later turns: load recent user turns / latest metadata and pure-derive the active pending order within TTL (or re-detect from content as a fallback).
   4. On resolve: merge `status: 'resolved'` + `resolution` onto that block (or onto the turn that closed it).

4. **Pre-stream status production (load-bearing):** open-order status for *this* turn must be written **before** `streamText`. Today’s pipeline is: NPC agent **pre-stream** → narrator stream → living tick **post-stream** (bounded) → archivist post-stream. Therefore:
   - **Living tick alone is not enough** for the wait turn the player just took — it lands too late for that turn’s prose.
   - Status producers for the current beat: NPC agent plan + deterministic place/transit/`last_known_situation` update after the agent tick, and/or a thin domain step in the pre-stream path that stamps STATE (`in transit`, still at place, ETA, refused, unavailable).
   - Post-stream living tick may reinforce multi-turn travel on later turns; it must not be the only writer of “where is Andy this beat.”

5. **Resolution boundary:** the factual status (arrival, transit, refusal, unavailable, new obstacle) is a **system fact** in STATE. The narrator **dramatizes** that authoritative status; it must not invent an off-scene relocation as the only source of truth.

6. **Guidance:** on idle/continue/time-jump with pending open order, inject one hard line: *Dramatize the authoritative open-order status this turn — arrival, concrete report, refusal, or new obstacle. Do not only restate the protagonist waiting.* If no status exists yet, treat that as a **pre-stream implementation failure**; the fallback cue may demand a concrete report or obstacle consistent with STATE, but must not invent an off-scene relocation.

7. **Eligibility:** when an open order names a character, treat them as plan-eligible **for that tick even if off-scene** (sibling to `isPlanEligible`), and/or force a single off-scene STATUS line into STATE: “Andy — in transit / still at Admin / ETA…”.

8. **Time-jump language** (“10 minutes later”, “an hour later”): already advances clock; couple to **mandatory outcome** for open orders and active threats (one of: success, partial, failure, new cost) — still via pre-stream status, then dramatization.

**Files:**

```
domain/services/open-order.ts            NEW (pure detect/update/TTL/refresh)
domain/services/npc-promotion.ts         EDIT isPlanEligible or sibling for open-order targets
lib/npc-agent.ts + prompts               EDIT context for open orders (legacy strangler only; new decisions stay in domain)
server/render/state-block.ts             EDIT optional OPEN ORDER / off-scene status line
narrate-turn.ts                          EDIT wire-through: detect → mergeMetadata → pre-stream status → guidance
tests/open-order.test.ts                 NEW
tests/advance-turn.test.ts               EDIT — fake-port pre-stream fixture for open-order derivation + off-scene eligibility/status render
tests/narrator-guidance.test.ts          EDIT — pending open order beats raw plan count
```

**Tests:** pure detection/update/TTL/refresh fixtures; retry/reload fixture proving the pending order is recovered from durable/derivable state (metadata on user turns); pre-stream/fake-port fixture proving an off-scene named target becomes eligible **and** gets an explicit STATE status line **before** narration would run; narrator-guidance fixture proving pending open order + busywork plans still emit resolve cue; 4-beat Threshold script does not expire the order mid-wait.

**Risk:** medium — false-positive open orders (keep detection conservative: named known character + retrieve/wait/bring/find verbs). TTL too short was a real Threshold risk — mitigated by default 4 + refresh on yield.

#### S3 — Dossier pressure that resolves *(later, if S1–S2 insufficient)*

- Auto-complete / fail stale quests (First Shift still active after murders).
- On public violence / institutional threat threads, force archivist or deterministic aftermath (already partly in continuity plan R6).
- Rank primary pressure into a single **must-bite-by-turn-N** clock when player idles.
- Optional: **cap ambient plans in STATE** (at most 1–2 low-salience fully rendered) — only together with reconciler/D policy so MUST-stage expectations stay consistent (see Phase D).

Defer detailed design until S1–S2 playtest on Threshold Accord (or a clone).

**Exit for Phase S (playtest on Threshold-class scene):**

1. Player: order retrieval → wait → continue → “10 minutes later” → **named target appears, reports in, or is proven unavailable** with a concrete reason — not three turns of chair/server-rack prose.
2. Busywork-only plan sets no longer silence L2 momentum in unit tests.
3. Continuity (place/inventory) unchanged.

### Phase 0 — Baseline capture *(no product change)*

**Goal:** freeze a before-picture so “looser craft” is measurable, not vibes-only.

**Work:**

1. Pick **two worlds** for regression: one dense continuity world (e.g. open/subworld with inventory + clock pressure), one high-NPC bounded or cast-heavy world.
2. Record a short play script (~8–12 player moves) covering: look-around, short continuation, dialogue, idle/wait×2, inventory use, move/travel, meta/out-of-character.
3. For each world, save under `backups/narrator-craft-baseline-YYYYMMDD/`:
   - player/narrator turn pairs (or export JSON)
   - one sample of the full trailing user message (STATE + guidance) for a mid-session turn
   - subjective scorecard (table below)
4. Optionally log approximate prompt sizes: system chars, history chars, state chars, guidance chars (ad-hoc `console` or a one-off script — no production telemetry required).
5. For the Threshold-style motion fixture, also log structured motion signals:
   - pending open order count + target name
   - turns-to-outcome after the order is issued
   - low-salience vs salient planned-move count
   - whether L2 / open-order guidance fired
   - whether the named target's `last_known_situation`, transit fields, or current place changed

**Scorecard (1–5 each, same rater before/after):**

| Dimension | What “5” means |
|---|---|
| Place continuity | No teleport / snap-back |
| Inventory fidelity | Carried objects match STATE; no ghost weapons |
| PC agency | Never decides player action/feelings |
| No menus | No option lists |
| Length variance | Short and long turns both appear when fiction warrants |
| Surprise / texture | Specific sensory detail, not template beats |
| Managed feeling | Low = prose feels directed by the system |
| Story motion | Idle/wait/time-jump produces concrete outcome within 1–2 turns |

**Exit:** baseline folder exists; scorecard filled once. No code merge required.

---

### Phase A — Distill `narrator-system.md` *(behavior change, prompt-only)*

**Goal:** replace the failure-mode manual with two short layers the model can hold simultaneously.

**Target structure of `prompts/narrator-system.md`:**

```markdown
# Craft (novelist)
- second-person present; genre-adaptive voice
- vary length by the fiction (no numeric bands as soft law)
- show, don’t tell; world has momentum
- never restate the previous turn’s standing scene
- short exemplars (keep 2–3, drop length-as-rule framing)

# Hard constraints (non-negotiable)
- STATE wins for Time / Place / Present / CARRIED / ITEMS HERE / PLAYER CANON
- do not invent untracked load-bearing objects into the PC’s hand
- do not decide PC actions, dialogue, or feelings
- no choice menus / option framing
- stay in PC perception; no fourth wall; no mechanic vocabulary
  (reverie, quest, objective, hook as stage direction, etc.)
- planned moves: honor intent as behavior (wording stays until Phase D)
- NPCs act from own goals; private subtext never named on the page
```

**Move out of always-on system (into Phase B conditional guidance or delete if redundant):**

| Current always-on rule | Destination |
|---|---|
| Observation always medium–long multi-sensory essay | Conditional guidance when stance is observe / attention-only |
| Spectacle / recognition / media-feed recipes | Conditional only when classifiers fire |
| Numeric bands 300–500 / 550–850+ | Exemplars only or drop numbers |
| Long “Description Variance” essay | One short anti-tic principle + restatement rule |
| Duplicate “Momentum — The World Acts” if guidance also fires it | Keep one home only (prefer sparse guidance when idle) |

**Keep in hard constraints (do not loosen):**

- Tracked objects / ITEMS HERE authority (v0.5.0)
- Place line / time line authority
- No menus, no PC mind-control, diegetic only
- Reverie / private subtext must not appear as named exposition
- Historical unit fidelity (short form is enough)
- Open-order / off-scene outcomes: dramatize STATE status only — do not invent off-scene relocation to “satisfy” a wait beat

**Files:**

```
packages/server/prompts/narrator-system.md     EDIT — rewrite to craft + hard
packages/server/src/lib/prompt.ts              no change expected (still loads file)
```

**Tests:** no unit test can prove prose quality. Add/keep a **snapshot or fixture test** only if something already snapshots prompt loaders. Prefer a short markdown comment at top of the prompt: “Craft vs Hard — see docs/plans/narrator-craft-freedom.md.”

**Risk:** medium — under-specifying can revive restatement or menu habits. Mitigate with Phase 0 scorecard + Phase B risk-gated guidance for known failure modes.

**PR size:** one PR, prompt-only if possible, so attribution is clean.

---

### Phase B — Sparse turn guidance *(behavior change, pure domain)*

**Goal:** `formatNarratorTurnGuidance` becomes a **risk valve**, not a second system prompt.

**Prerequisite:** Phase **S1** landed — sparse mode must **not** reintroduce `plannedActionCount > 0 ⇒ never world-acts`. Idle / open-order / time-jump cues stay **high priority** even while craft recipes go sparse.

**Default policy after change:**

| Situation | Guidance emitted? |
|---|---|
| Meta / not in-character | Yes — brief, don’t advance scene (keep) |
| Time-check move | Yes — pin world clock (keep) |
| Restatement detector fires | Yes — continuity nudge (keep) |
| Open order outstanding + idle/continue/time-jump | Yes — **resolve open order** (from S2; never sparse-away) |
| Idle streak ≥ momentum threshold **and** no *salient* plan | Yes — world-acts (keep; use S1 salience, not raw count) |
| Single idle + present NPC + no salient plan | Optional engagement cue (keep, but only this soft tier) |
| Observe / look-around | **Only if** recent turns were short surveys or empty establishing — not every look |
| Say / dialogue | Optional one-liner if last assistant turn summarized speech; else **omit** |
| Investigative + dossier pressure | Soft internal-pressure line **only** when open clues/objectives exist (keep, shortened) |
| Charged recognition / spectacle / media | Fire only when heuristics match; one line max |
| Everything else | **Empty guidance block or omit section entirely** |

**Implementation sketch:**

1. Change `formatNarratorTurnGuidance` to return `string | null` (or `''`) when no risk fires.
2. In `narrate-turn.ts`, only append the guidance section when non-empty — do not print an empty `## TURN GUIDANCE` header.
3. Remove lines that merely restate system hard rules (“never list options”, “do not decide feelings”) when those already live in `NARRATOR_HARD_RULES`.
4. Keep pure heuristics in `domain/services/narrator-guidance.ts`; no I/O.

**Files:**

```
packages/server/src/domain/services/narrator-guidance.ts   EDIT
packages/server/src/lib/narrator-guidance.ts               re-export only if still present
packages/server/src/infrastructure/narrator/narrate-turn.ts EDIT — omit empty block
packages/server/tests/narrator-guidance.test.ts            EDIT/NEW — sparse matrix
```

**Tests (flat `packages/server/tests/`):**

- Meta → non-empty, no world-acts.
- Normal in-character driving move, no idle, no restatement, no open order → **empty**.
- Idle×2 + no plans → world-acts present.
- Idle×2 + 3 busywork-only plans → world-acts **present** (S1 regression; must not reintroduce raw `plannedActionCount > 0` short-circuit).
- Idle×2 + one salient / advances-open-order plan → world-acts **absent**.
- Pending open order + idle/continue/time-jump → resolve-open-order cue **present** (never sparse-away; S2).
- Idle×1 + present NPC + no salient plan → engagement, not world-acts.
- Restatement fixture → continuity nudge.
- Time-check → clock line.
- Observe after a long recent establishing turn → no mandatory long-survey cue (if implementable from history); else document as deferred.

**Risk:** low–medium. Sparse guidance can under-nudge dead scenes; S1/S2 high-priority cues remain the safety net — B must not delete them when “simplifying.”

**PR size:** one PR after or stacked on A. Prefer **after A** so system + guidance aren’t both changing in the same attribution window if playtest regresses.

---

### Playtest gate (between B and C)

**Definition of done for S + A+B is not “merged.”** It is:

1. Same Phase 0 scripts replayed on the same two worlds (or equivalent new sessions), including the Threshold retrieve → wait → continue → time-jump motion script.
2. Continuity dimensions (place, inventory, agency, menus) **≥ baseline**.
3. **Story motion** score **≥ pass** (concrete outcome within 1–2 yield turns; not pure atmospheric restatement) — blocks C even if craft looks better.
4. Length variance + surprise/texture **> baseline**, or “managed feeling” **lower**, without continuity or motion loss.
5. At least one full turn streamed end-to-end in the browser (AGENTS.md narrator done rule).

If continuity **or** motion regresses: **do not proceed to C**. Restore the specific hard rule / S cue that failed (surgical re-add), not the whole old checklist.

If craft does not improve but motion is good: inspect whether STATE size (not guidance) is the bottleneck → prioritize Phase C; do not pile more craft rules.

---

### Phase C — Budget STATE harder than history *(structure, render layer)*

**Goal:** free attention for recent prose by shrinking low-salience STATE, without dropping pins.

**Principles:**

- **Pinned always:** Time, Place (unless travel-contradiction suppression), PC identity + CARRIED, present cast names, PLANNED MOVES (while Phase D is off), PLAYER CANON lines.
- **Rank-and-slice harder:** dossier already ranks; tighten caps if long sessions bloat.
- **Private NPC fields:** goals / private read / ambient subtext only for **present** high-agency NPCs; cap ambient subtext to 1 flaring + 1 ambient unless flaring.
- **Off-scene block:** include only when player text or recent prose references the NPC / channel, **or** keep top-1 by last_seen (not top-5).
- **Occupancy / encounters:** keep density + ≤2 groups; encounter hooks only if empty present cast or player is scanning.
- **No craft essays inside STATE.** STATE lines stay factual; “how to write” stays out of `formatStateBlock`.

**Files:**

```
packages/server/src/server/render/state-block.ts     EDIT
packages/server/src/domain/services/dossier-ranking.ts  EDIT if caps live there
packages/server/tests/…                              characterization on formatStateBlock fixtures
```

**Tests:** fixture worlds with fat dossiers; assert token/char budget ceilings or max line counts; assert CARRIED and Place still present.

**Risk:** medium — over-aggressive off-scene/dossier cuts can starve phone-call / distant-threat beats. Prefer feature-flag or constant caps at top of file for easy rollback.

**PR size:** separate from A/B so continuity regressions are attributable to render caps.

---

### Phase D — Planned-move staging policy *(optional, after playtest)*

**Only if** after A–C the prose still feels “managed” by agent scripts, or crowded turns drop texture because every plan must land.

**Options (pick one in Decisions before coding):**

| Option | Behavior | When |
|---|---|---|
| **D0 — Keep MUST-all (default)** | No change | Playtests feel fine |
| **D1 — Soft prefer** | System: “realize the most scene-relevant plans; others may wait a turn as tension” | Crowded scenes |
| **D2 — Cap N** | Stage at most 2 planned moves fully; remainder deferred (reconciler marks deferred) | High cast |
| **D3 — Render cap** | Full intents persist; STATE shows ≤2 low-salience plans (primary labeled) | Token pressure only |

**Do not** start D by editing only the narrator prompt while the reconciler still expects every `intent_id` to resolve — if staging becomes optional **or** STATE omits plans, update reconcile expectations in the same PR. S1 must not do D3 alone.

**Files (if D1/D2):**

```
packages/server/prompts/narrator-system.md
packages/server/src/server/render/state-block.ts   (label salience / order)
packages/server/src/lib/intent-reconciler.ts       (deferred outcomes)
packages/server/tests/…
```

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Stateless vs long chat session | **Keep stateless** | Memory architecture + multi-agent + cost; not the choke |
| Ship order | **S1 → S2 before A/B**; never ship sparse-B alone ahead of S1 | Threshold class is player-visible; sparsifying momentum without S worsens “world doesn’t move” |
| Intrusion budget | **Only plot-salient plans** suppress L1/L2; busywork does not | Raw `plannedActionCount > 0` was the smoking gun |
| Open-order storage (v1) | **Derivable from user-turn metadata / recent turns + TTL**; no in-memory-only; no new table unless derivation proves brittle | Survives retry/reload; uses existing `mergeMetadata` |
| Open-order TTL | **Default 4 player turns**; **refresh on idle/continue/wait/time-jump** while pending | Threshold script is 4 yield beats; TTL 2 expired mid-wait |
| Who owns off-scene outcomes | **Pre-stream domain/agent/deterministic status → STATE; narrator dramatizes** | Living tick is post-stream — too late for the current wait turn |
| STATE plan capping | **Defer to D/S3** — not in S1 | MUST-stage + reconciler still expect full plan set; salience is guidance-only in S1 |
| Continuity pins | **Never loosen** inventory/place/time/PC agency/menus | v0.5.0 was structure-first; still correct |
| Numeric length bands | **Remove as soft law** (Phase A) | Drive uniform medium; “fiction dictates length” already stated |
| Guidance default (after S) | **Sparse / risk-gated craft**; S1/S2 cues stay high priority | Stop double-steering without deleting motion safety nets |
| Empty guidance | **Omit section entirely** when no risk fires | Saves tokens; no empty header noise |
| Planned moves | **Default keep MUST-all; D optional** | Living-world agency already paid for; don’t open intent drift without need |
| Output token cap | **Still no hard maxOutputTokens** unless cost forces it | Docs 1K myth is wrong; don’t introduce a new throttle |
| Feature flag | **No flag for A/B/S1/S2** (prompt/domain); **constants for C caps** | Simple rollback via git; caps need tuning knobs |
| Versioning | **MINOR** on release branch | Player-visible narrator / motion behavior change |
| Track B1/B2 prerequisite | **Recommended, not hard-blocked** | Cleaner attribution if overfit names and reveries already sane; S/A can still land alone |

## Explicit cuts

- Vector / Voyage embeddings and `MemoryRepository.searchSimilar` live path — separate memory plan.
- Story Conductor (Haiku supervisor) — Phase 4 roadmap; out of scope.
- Changing model ID or temperature experimentation matrix — optional side quest, not this plan.
- Rewriting archivist prompts — only if continuity regressions after A/B prove archivist/STATE issues, not narrator craft.
- Generalizing remaining overfit names (B1) — tracked in turn-latency plan; coordinate but don’t block A.
- Opening-turn special path rewrite — keep current long-opening behavior unless playtests show opening is over-managed independently.
- **Cap ambient plans in STATE during S1** — deferred to D/S3 so MUST-stage and reconciler stay aligned.
- New `open_orders` table in v1 — only if metadata derivation fails replay/reload tests.

## Accepted tradeoffs

- **Some failure modes return.** Restatement or thin look-arounds may reappear occasionally; we re-add **surgical** hard rules or risk-gated cues, not the full essay stack.
- **Fewer always-on “world acts” reminders** if idle heuristics miss edge cases; S1 salience + S2 open-order stay the backstop.
- **Phase C may miss a distant NPC** that the player suddenly phones; prefer player-text mention detection over permanent top-5 dump.
- **Attribution noise** if A and B ship together — prefer stacked PRs; S1 alone is still a shippable win.
- **Playtest labor** is mandatory; unit tests cannot greenlight prose freedom or story motion.
- **Pre-stream status may lag multi-room travel by a beat** if only the agent updates transit and living tick finishes later — acceptable if STATUS line is honest (“in transit / still at X”) rather than false arrival.

## Sequencing / PRs

| PR | Contents | Effort | Notes |
|---|---|---|---|
| **0** | Baseline capture (docs + backups only) | XS | Include Threshold Accord wait/retrieve script |
| **S1** | Salient-plan gate + NPC outcome floor | S–M | **First product PR** — fixes false intrusion budget |
| **S2** | Open-order detect + off-scene eligibility / resolve cue | M | Andy/retrieve class |
| **A** | Distill `narrator-system.md` | S | Prompt-only; easiest revert |
| **B** | Sparse guidance (preserving S1/S2 high-priority cues) | S–M | Unit matrix + browser stream |
| **gate** | Dual-world + Threshold motion scorecard | S | Blocks C if continuity *or* motion fails |
| **C** | STATE rank/slice + present-only private fields | M | Characterization tests |
| **D / S3** | Optional planned-move policy / dossier resolve | S–M | Only if still managed or pressure inert |

**Suggested version:** bump **MINOR** for S1+S2 (player-visible motion) even if A/B slip a release; or one MINOR for S+A+B if same train. Do **not** ship sparse-B alone ahead of S1.

## Exit criteria

### Story motion (Phase S)

1. Unit: busywork-only plans do **not** suppress L2 world-acts / open-order resolve when idle.
2. Playtest (Threshold-class): wait → continue → time jump after a retrieve order yields **arrival, status, refusal, or concrete obstacle** within 2 turns — not pure atmospheric restatement.
3. Off-scene named target of an open order gets plan eligibility or an explicit off-scene STATUS line the same turn window.

### Craft freedom (Phases A–C)

4. `narrator-system.md` is structured as **Craft** + **Hard constraints**; numeric length bands are not soft law; total word count is **materially lower** than the pre-change ~3k words (target: **≤ ~1.2–1.5k words** without losing hard pins).
5. `formatNarratorTurnGuidance` returns empty for a normal driving in-character move with no idle/restatement/time-check/open-order; unit tests lock the matrix.
6. `narrate-turn.ts` does not emit an empty `## TURN GUIDANCE` section.
7. Continuity scorecard on baseline scripts: place, inventory, agency, menus **≥ baseline**.
8. Craft scorecard: length variance and/or surprise/texture **improved**, or “managed feeling” **reduced**, vs baseline.
9. Full turn streams end-to-end in the browser on a real world.
10. `npm run depcruise`, `npm run type-check`, `npm test` green; `npm run test:mongo` if touch points include shared ports.
11. Version bumped on the release branch; header shows new version after dev-server restart / prod deploy.
12. This plan archived to `docs/plans/archive/` when shipped; turn-latency Track B3 marked resolved or linked here.
13. Spec touch-up: **craft is sparse, state is authoritative, pressure resolves** — so future bugs don’t re-grow the checklist without a plan.

## Rollback

| Layer | Rollback |
|---|---|
| Phase S1 | Revert `plan-salience` + guidance intrusion gate + NPC outcome-floor prompt lines; restore raw `plannedActionCount > 0` short-circuit only if needed for emergency parity |
| Phase S2 | Stop writing `open_order` metadata; revert eligibility sibling + STATE status line + pre-stream status stamp; guidance falls back to idle-only (S1 still helps) |
| Phase A | `git revert` prompt file; zero code risk |
| Phase B | Revert guidance sparseness + narrate-turn omit; **keep** S1/S2 high-priority cues; tests pin expected verbosity |
| Phase C | Widen caps / restore off-scene slice(0,5) via constants at file top |
| Phase D | Restore MUST-all paragraph + reconciler expectations |

## Open questions for Andrew

1. **Baseline worlds** — confirm **The Threshold Accord** as the motion fixture; second world for continuity/craft (e.g. Cluster Psi-1 or a bounded ship)?
2. **Ship S before A?** — **Recommend yes** (S1 alone is already a player-visible win). Confirm. *(Plan assumes yes until overridden.)*
3. **Phase D appetite** — default D0 (keep MUST-all), or soft-prefer after plans carry outcomes?
4. **Open-order persistence** — plan default is derivable user-turn metadata + TTL 4 + refresh; escalate to a durable row only if replay/reload tests show derivation is too brittle. Confirm or choose table-first.
5. **B1 overfit constants** — before A or parallel?
6. **Docs 8K/1K** — fix in same PR as A or separate chore?

## Implementation checklist (for the executing agent)

- [x] Phase 0 baseline captured (include Threshold retrieve/wait script) — `backups/narrator-craft-baseline-20260811/`
- [x] Phase **S1** salient-plan / outcome floor + tests
- [x] Phase **S2** open-order + off-scene eligibility + unit motion fixtures (live Threshold playtest remaining)
- [x] Phase A prompt rewrite (browser smoke remaining)
- [x] Phase B sparse guidance (preserving S cues) + unit matrix (browser smoke remaining)
- [ ] Playtest scorecard (continuity **and** motion); go/no-go for C
- [ ] Phase C STATE budgets (if go)
- [ ] Phase D / S3 only if still managed or pressure inert
- [x] Version bump + archive this plan (v0.6.0)
- [x] Optional: Agents.md budget wording corrected

---

## Appendix A — What we will not tell the model every turn

After A+B, the following should **not** appear on a clean driving turn:

- “Write medium 300–500 words”
- Full observation multi-sensory essay recipe
- Engagement + world-acts + investigative pressure stacked together
- Restatement of “never present a menu” if already in Hard constraints
- Empty `## TURN GUIDANCE` header

## Appendix B — Hard pins (never drop without a new plan)

- STATE Time / Place / Present
- CARRIED / TRACKED OBJECTS + ITEMS HERE
- PLAYER CANON
- No PC mind-control
- No choice menus
- Diegetic / no mechanic vocabulary on the page
- History packing prefers full narrator turns
- Open-order / off-scene outcomes are system facts in STATE; narrator dramatizes only
- Busywork plans must not permanently silence L1/L2 intrusion (S1 invariant)

## Appendix C — Mapping from review recommendations

| Review recommendation | Phase |
|---|---|
| Stateless is fine; don’t chase provider memory | Non-goal / Why |
| Thin system prompt (craft + hard) | A |
| Sparse risk-gated guidance | B (after S1) |
| Stop double-saying rules | A+B |
| Budget STATE harder than history | C |
| Soften planned-move MUST | D (optional) |
| Drop numeric length bands | A |
| Dual-mode playtest | 0 + gate |
| Embeddings for real memory | Explicit cut |
| “World doesn’t move unless player forces it” | **S1–S2** (Threshold Accord) |
| Busywork plans suppress world-acts | **S1** |
| Off-scene retrieve never completes | **S2** |
| Cap ambient plans in STATE in S1 | **Cut** — defer D/S3 |
| In-memory open-order carry | **Cut** — metadata + TTL only |
| Living tick as sole Andy resolver | **Cut** — pre-stream status required |

## Appendix D — Plan review cleanups (2026-08-11)

Applied from the post-addition review; implementers should treat these as binding:

1. Decisions table aligned with **S-first**, salient intrusion budget, open-order metadata, pre-stream status ownership.
2. **Pre-stream status production** spelled out (NPC agent / deterministic stamp before `streamText`; living tick is post-stream support only).
3. **TTL 4 + refresh on yield** so Threshold’s four-beat wait does not expire mid-script.
4. **Player-turn `mergeMetadata('open_order', …)` write path** documented.
5. Phase B tests + playtest gate + rollback cover S1/S2.
6. **STATE plan capping removed from S1** (deferred to D/S3).
7. Non-goals / hard constraints / Appendix B pin open-order truth boundary.

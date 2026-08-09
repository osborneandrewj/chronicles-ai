# Narrator Controls & Story Continuity — Implementation Plan

**Status:** implemented (code on `feat/narrator-controls-story-continuity`; PR 0 data repair still ops-only)
**Branch target:** `feat/narrator-controls-story-continuity` off `main`
**Target release:** **v0.5.0** (MINOR — feature set)
**Authored:** 2026-08-08
**Revised:** 2026-08-08 — code review against the live tree. Root causes R1/R2/R3 verified in source; added **R8** (dossier caps evict); **PR C inverted** (deterministic clock primary, LLM for jumps only) plus its missing prompt/backfill/render/storage work; **PR A** widening paired with tightening; **PR 0** resequenced after B; **PR D** deadline structure called out; **PR E** conditioned and row targets clarified; **replay fixture** added; `0.4.1` escape hatch dropped.
**Implemented:** 2026-08-09 — product slices A–F (E as option a pure helper) + replay fixture + version `0.5.0`. PR 0 remains a separate one-shot against prod after B is live.
**Trigger:** storytelling audit of production world **Cluster Psi-1** (`backups/cluster-psi-1-prod-20260808-144926.json`)
**Release playbook:** `docs/RELEASING.md`

## Goal

Close the gap between **strong premises / rigid inventory rules** and **what the playthrough actually experiences**: correct player identity, durable purchased gear, a living clock on open/subworlds, playable primary pressure, and consequences when the player breaks grounded physics or civic order.

Principle: **structure first, prompts second.** Do not ask the narrator to remember what STATE does not assert. Do not loosen “tracked objects are authoritative” — fill the ledger.

## Evidence (Cluster Psi-1)

| Fact | Detail |
|------|--------|
| World | id 6, name `Cluster Psi-1`, `worldLayer: subworld`, `parentWorldId: 5` |
| Turns | ~108 user / 109 assistant (seq ~22–240) |
| Player row | `Andy` (`is_player`) — should be **Joseph Osborne** |
| Sword purchase | seq 67–68: player “pick up the **sword**” / pay drachmae; narrator “lift the **xiphos**” — no `story_resource` until correction ~194 |
| Fight failure | player draws sword → ledger lacks sword → narrator obeys Tracked Objects rule (meat in hand) |
| Clock | still `Day 1, morning` after ~100 player turns; Day-3 shrine deadline inert |
| Dossier | 3 active threads (Spartan token/bargain/surveillance), 2 still-active objectives, 1 clue; sparse aftermath after Agora deaths |
| Corrections | superhuman strength/healing + sword granted via correction channel, sometimes under name **Joseph Osborne** |

## How narrator control is wired (today)

```
player action
  → classifier (stance / input_mode)
  → NPC agent plans + occupancy
  → formatStateBlock + formatNarratorTurnGuidance + narrator-system.md
  → Grok streams prose
  → archivist LLM patch  +  extractDeterministicPatch (regex)
  → sanitizeArchivistPatch → applyArchivistPatch
```

**Pinned truth** (`packages/server/src/server/render/state-block.ts` → `formatStateBlock`):

| Block | Controls |
|-------|----------|
| `Time` / `Place` / `Scene` | Clock + location anchors |
| `Present` + **CARRIED / TRACKED OBJECTS** | Identity + inventory |
| `ITEMS HERE` | World-located objects |
| `PLAYER CANON` | Correction-channel notes |
| `STORY DOSSIER` | Quests, objectives, clues, threats |
| `PLANNED MOVES` | NPC agency this turn |

**Soft pressure** (`domain/services/narrator-guidance.ts` → `formatNarratorTurnGuidance`): beat cues, momentum, time-check, investigative hints.

**Hard rules** (`packages/server/prompts/narrator-system.md`): second-person present, no menus, **Tracked Objects are authoritative** (do not invent untracked weapons into the protagonist’s hand).

That last rule is correct. The Agora “meat” beat is the system working as designed against a **stale ledger**, not a prose bug.

## Root causes

### R1 — Player identity split (Andy vs Joseph Osborne)

- Open/subworld seed uses `initialState.playerName` with weak defaults (`Player` / `You`) in `world-repository.mongo.ts` / `lib/worlds.ts`.
- Subworld entry (`enter-subworld.ts`) does not guarantee hub/session identity lands on the protagonist row.
- Corrections that name **Joseph Osborne** without `is_player: true` can attach notes/resources to a non-player name while STATE still shows **Andy (player)**.
- Archivist thread copy uses “Joseph” while the player row says “Andy”.

### R2 — Purchase / synonym inventory gap (the sword)

- `extractObjectAcquisition` (`domain/services/object-acquisition.ts`) requires the object’s **head noun in the narrator text**.
- Player said `sword`; narrator said `xiphos` only → deterministic mint failed.
- Archivist is instructed to emit `story_resources` for weapons but did not close the gap.
- Sword only appears on the ledger after a later correction (~turn 194).

### R3 — Open/subworld clock is archivist-only

- Prose-driven `ship_clock` advance in `narrate-turn.ts` runs **bounded worlds only** — the whole block (`narrate-turn.ts:361–383`) is nested inside `isBounded`, which is `world.spatial_mode === 'bounded'` (**not** `world_layer`).
- Open/subworlds rely on archivist `current_time`, which advances only when narration *says* time passed — and long grounded scenes stay “morning” forever.
- Deadline objectives (dusk Day 3) become flavor text.
- Compounding: the only estimator today is `HaikuTimePassageEstimator`, and `prompts/time-passage.md` is **Starship-coupled** (“for a starship story’s narrative clock”; its rubric examples are watch-standing and repairs). Pointing it at Classical Greece unchanged feeds Haiku a genre-wrong ruler.

### R4 — Objectives never complete; primary pressure soft

- Dossier lists active quests/objectives but does not auto-complete/fail them.
- Guidance reasserts objectives only on investigative moves (`isInvestigativeMove`), not on idle streaks.
- Abandoned A-plots remain “active” noise while the player invents a new goal (Archon hit).

### R5 — Superpowers without cost in grounded settings

- PLAYER CANON can grant demigod strength/healing; `REALITY` narrator cue is simulation-hub framing only.
- Historical open worlds have no power ceiling / cost thread when physics breaks.

### R6 — Low consequence density after civic violence

- Multiple Agora deaths produced little institutional `threat` / timeline pressure in the dossier.
- Archivist under-writes city response; narrator has no mandatory aftermath cue for public slaughter.

### R7 — Descriptor cast drift

- Two “hooded” operators (Kyaneus vs Kallias); alias / `reveals_name_of` path exists but is under-used mid-arc.

### R8 — Dossier caps **evict** rather than accumulate

- `formatDossierBlock` (`server/render/state-block.ts:433–444`) hard-slices to 4 quests / 4 threads / 5 objectives / 6 clues / 6 resources — taken **off the front**, with no ordering by stakes, deadline, or recency.
- So stale never-completing objectives (R4) do not merely add noise: they **push newer objectives out of STATE entirely**. The narrator never sees them.
- This makes R4 a two-part bug — *nothing closes* **and** *the cap is unordered*. Fixing completion rules alone leaves a world whose five oldest objectives permanently occupy the window.

## Locked decisions

1. **Do not loosen Tracked Objects rigidity.** Fix acquisition and identity so STATE is right.
2. **No quest menus in narrator prose.** Primary pressure is STATE/guidance internal pin (and optional UI), never “your options are…”.
3. **Open worlds get a deterministic clock as the PRIMARY writer**, not an LLM estimator with a deterministic backstop. The pure function is the ruler; the LLM is consulted only for explicit jumps. (Revised — see PR C. “Structure first, prompts second” applies to the clock too, and it keeps a Haiku call off every open-world turn.)
4. **Synonym table starts small** (weapons/tools/period clothing) and is data-driven/extensible — not a free-form LLM synonym free-for-all on every token. Widening acceptance must be paired with **tightening the match** (word-boundary + proximity), never widening alone.
5. **Cluster Psi-1 data repair is a separate one-shot** (PR 0) and does not block product PRs A–F — but it should land **after PR B**, not before (see PR 0).
6. **The Cluster Psi-1 export is a test fixture, not just evidence.** The audited turns become an offline replay harness (see “Replay fixture”) so PR A/C/D have a regression net instead of only manual playtests.
7. **Architecture:** pure extraction/clock/lifecycle logic in `domain/services/`; prompt text in `prompts/`; rendering in `server/render/state-block.ts`; wiring in `narrate-turn` / apply path. No new deciding logic in repositories.

## Implementation slices (shipping order)

| PR | Slice | Scope | Effort | Unlocks |
|----|--------|--------|--------|---------|
| **A** | Purchase / synonym acquisition | Inventory | M | Sword works |
| **B** | Protagonist identity invariant | Identity + subworld seed | M | Joseph is the player row |
| **0** | Data repair | Cluster Psi-1 only | S | Clean world for playtest |
| **C** | Open-world narrative clock | Time | M | Day 3 means something |
| **D** | Objective lifecycle + ordering + primary pressure | Plot | M | A-plot can complete/fail |
| **F** | Descriptor hygiene | Cast | S | Hooded-figure clarity |
| **E** | Power costs + violent consequences | Tone/stakes | M | Slaughter costs something |

Recommended order: **A → B → 0 → C → D → F → E**.

Two ordering constraints, both load-bearing:

- **0 after B.** Renaming `Andy` → `Joseph Osborne` in prod *before* the identity invariant ships means the next correction naming Joseph can re-split the rows and you repair the same world twice. B first, repair once.
- **E last, and it does not gate the release.** E is ~90% prompt text (see PR E) — the slice least able to prove it works and most likely to silently regress on a Grok update. Ship A–D + F as the drop; E rides along only if its pure helper lands with tests.

---

## PR 0 — Cluster Psi-1 data repair (one-shot)

> **Sequencing: run this AFTER PR B ships.** (Section kept here for narrative flow; the shipping order is A → B → **0** → C → …) Repairing the identity split while the correction channel can still create it means the very next “Joseph Osborne” correction re-splits the rows and you repair twice. If prod play needs the sword sooner, item 3 (sword ledger) is safe to run standalone at any time — only the **rename** (item 2) waits on B.

**Goal:** Repair the audited world so evaluation and further play are not fighting bad rows.

**Steps (read-only backup first — CLAUDE.md data-repair rule):**

1. Snapshot prod / export (already have `backups/cluster-psi-1-prod-20260808-144926.json`).
2. Rename player row `Andy` → **Joseph Osborne** (`is_player=1`); keep `Andy` as alias if useful.
3. Ensure **sword** is `held_by` Joseph, `salient: true`, `kind: weapon` (merge duplicate Joseph notes if any).
4. Reconcile objectives: mark “Secure warehouse manifest pages” completed if pages were taken; leave delivery objective active or blocked with accurate detail.
5. Optionally advance `world_time` to a post-massacre band so “midday / dusk Day 3” language is not absurd.
6. Read-back via ports / inspector; one smoke turn in browser.

**Execution vehicle:** one-off script via `npx tsx --conditions=react-server` against the active store (same pattern as `seed-sequence-vigil-thread.ts`), **or** manual Mongo ops if preferred. Resolve world **by name** `Cluster Psi-1`, not by id.

**Mongo gotcha (carry forward):** `turns` in Mongo have no `id` field — they are keyed by `worldId` + `seq`. Any `updateOne` filter that passes `id: undefined` collapses to `{ worldId }` and clobbers an arbitrary turn. Filter turns by `seq`, and re-scan the collection after the repair to confirm nothing else moved.

**Out of scope:** product code changes.

---

## PR A — Purchase / synonym inventory mint (the sword bug)

**Goal:** A completed in-fiction purchase or take that the narrator honours must mint a `story_resource` held by the protagonist, even when player language and period synonym diverge.

### Code

1. **`domain/services/object-acquisition.ts`**
   - Add commerce / possession patterns beyond take/grab:
     - buy, purchase, pay for, pick up (already), sheathe my new X, accept the X, etc.
   - Small synonym map (extensible constant or pure module), e.g.:
     - `sword` ↔ `xiphos`, `gladius`, `blade`, `sabre`, `saber`, `cutlass`
     - `knife` ↔ `dagger`, `pugio`, `dirk`
     - `cloak` ↔ `himation`, `chlamys`, `mantle`
   - Prefer canonical player-facing name when minting when possible (player said “sword” → resource name `sword`, detail may note period form).

2. **Tighten acceptance in the same PR — do not widen alone.**

   Today acceptance is `narrator.includes(head)` (`object-acquisition.ts:118`) — a raw substring test over the entire narration. It is already too loose: `sword` matches `swordsman` and `broadsword`. Bolting a synonym class on top of a loose matcher multiplies false mints — “I take the sword” plus a narration mentioning *any guard’s blade* would mint a sword the player never bought. Three changes, together:

   - **Word-boundary match.** Replace `includes(head)` with an escaped `\b…\b` regex. Cheap correctness win, worth doing regardless of the rest of this plan.
   - **Proximity window.** A match only counts when the accepted object name or synonym co-occurs with a possession-shaped verb/outcome (`lift`, `close(s) around`, `hand`, `take`, `buckle`, `sheathe`, `belt`, `at your hip`, …) inside a bounded window — not merely somewhere in the turn. Apply this to exact head-noun matches **and** synonym matches. Exact matches can use a slightly wider/looser window than synonyms, but they cannot keep today's whole-narration behavior: `I take the sword` / `The guard keeps the sword out of reach` must not mint a sword.
   - **Currency is never an object.** Add a currency/payment set (`drachmae`, `coins`, `silver`, `obols`, `payment`, `denarii`) to the `NON_OBJECT_HEADS` guard so a price line cannot mint or move a tracked object.

3. **Payment vs give disambiguation**
   - “I give the merchant 22 drachmae” must not parse as give-object-to-merchant for a tracked sword.
   - Note the *actual* mechanism: `GIVE_RECIPIENT_FIRST` (`object-acquisition.ts:149`) requires an article/possessive before the object, so the bare-numeral form (`22 drachmae`) misses today — but **“I give the merchant my drachmae” does match**, yielding a `give` movement for `drachmae`. The currency set in item 2 is what actually closes this, not a new pattern.

4. **Single-object scope (accepted limitation, stated).** `extractObjectAcquisition` returns on the first match, so “I buy the sword and a shield” mints one item. Either return an array (mirroring `extractItemMovements`, which already does) or accept single-object minting for this PR — but say which. Do not leave it undiscovered at playtest.

5. **Archivist backstop** (`prompts/archivist-system.md`)
   - Explicit rule: if the player pays for or accepts a weapon/tool and the narrator completes the sale, emit `story_resources` with `held_by_name: "protagonist"`, `salient: true`, even when prose uses a period synonym.

6. **Narrator polish (small)** (`prompts/narrator-system.md`)
   - When CARRIED lists a name, after first introduction prefer continuity with that canonical name (or dual-name once: “the xiphos — your sword — at your hip”).

### Tests (`packages/server/tests/object-acquisition.test.ts` + apply path if needed)

From the real transcript:

```
player: I pick up the sword. then I give the merchant 22 drachmae.
narrator: You lift the xiphos … twenty-two drachmae …
→ extractObjectAcquisition returns a sword-class name
→ next turn playerPossesses(sword) true
→ "I draw my sword" is not treated as empty-handed
```

Also: pure take with matching noun still works; “I take a look” still rejects; blocked grab still null.

**Negative tests for the widened matcher — these are the point of item 2, and must land with it:**

```
"I take the sword" / "The swordsman blocks your path."        → null (no \b match on a substring)
"I take the sword" / "A guard's blade rasps in its scabbard." → null (synonym present, but no
                                                                 possession verb near it)
"I take the sword" / "The guard keeps the sword out of reach." → null (exact noun, denied outcome)
"I take the sword" / "You lift the xiphos, belting it on."    → sword (synonym + possession verb)
"I give the merchant my drachmae" / "…coins change hands."    → no item movement (currency guard)
```

### Exit criteria

- Regression test green for xiphos/sword **and** all five negative cases above.
- Manual smoke: buy a weapon, leave scene, draw it next turn — CARRIED shows it; prose allows the draw.
- Replay fixture (see below) mints the sword at Cluster Psi-1 seq 67–68.

---

## PR B — Single protagonist identity

**Goal:** The player character has one canonical name everywhere: Present, dossier, corrections, threads.

### Code

1. **Subworld / open seed**
   - `enter-subworld` / session flip path: always pass hub or session `player_identity` into `initialState.playerName`.
   - Never invent a random given name when a session identity exists.

2. **Correction channel**
   - When the player asserts name or patches “Joseph Osborne” / “me” / “my character”:
     - Force application onto `is_player=1` with rename-in-place (extend existing A9 in `apply-archivist-patch.ts`).
   - `prompts/archivist-correction.md` + sanitizer: protagonist-affecting corrections set `is_player: true` (or resolve via PROTAGONIST_ALIASES) so notes never land on a phantom NPC name.

3. **STATE pin** (`formatStateBlock`)
   - Under the player Present line:
     - `canonical name: <name> (use this; never invent another PC name)`
     - optional `also known as:` from aliases only.

4. **Archivist**
   - Dossier/thread/objective prose must use the canonical player name from PRIOR STATE, not free paraphrase.

### Tests

- Seed subworld with hub name → player row matches.
- Correction “I am Joseph Osborne” renames the single player row; no second character.
- Second correction under that name does not create NPC Joseph.
- Thread summary after archivist uses canonical name (unit or fixture-level if practical).

### Exit criteria

- New subworlds inherit session identity.
- Corrections cannot split Andy/Joseph-style dual rows.

---

## PR C — Open-world narrative clock

**Goal:** Time advances on open and subworlds so deadline plots work.

**Design change from the first draft:** the original plan made `timePassage.estimate` (an LLM call) the primary writer for open worlds, with a deterministic "floor" as a backstop. **Invert that.** The pure function is the ruler; the LLM is consulted only for explicit jumps. Three reasons:

- **Cost.** `timePassage` resolves to `HaikuTimePassageEstimator` (`composition/container.ts:167`). Today it fires on bounded worlds only. Making it primary adds a Haiku call to *every open-world turn* — the majority of play. (Latency is safe: the block is post-stream, so TTFA is untouched. This is a spend question, not a v0.4.0-regression question.)
- **Testability.** A pure estimator is unit-testable; a mocked LLM estimator only tests the wiring around it.
- **Consistency.** "Structure first, prompts second" is this plan's own stated principle. It applies to the clock.

### Code

1. **`domain/services/narrative-clock.ts` — deterministic per-turn estimate (new, pure, primary)**
   - `estimateTurnMinutes({ stance, sceneChanged, travelled, narrationLength })` → minutes. Rough bands: idle/observation **2–5**, dialogue/interaction **10–20**, travel or scene change **30–90**.
   - Inputs are things the pipeline already computes (classifier stance, scene-transition result) — no new extraction, no new call.
   - This is the floor **and** the normal case, not an emergency fallback.

2. **LLM estimator becomes conditional, not per-turn**
   - Call `timePassage.estimate` only when the narration contains explicit jump language (`later`, `the next morning`, `hours pass`, `by nightfall`, `three days`) — a cheap pure predicate gates it.
   - Merge rule: **max(deterministic, LLM)**, never sum. A jump turn takes the jump; an ordinary turn never pays for a call.

3. **De-Starship `prompts/time-passage.md` (required, was missing from the plan)**
   - The prompt opens *"for a starship story's narrative clock"* and its rubric examples are watch-standing, repairs, and shift changes. Pointed at Classical Greece unchanged, it estimates against the wrong world.
   - Rewrite genre-neutral (same rubric shape, setting-agnostic examples), consistent with the genre-decoupling work already shipped. Bounded/starship worlds keep working — the rubric bands do not change, only the framing.

4. **Wiring** (`narrate-turn.ts`)
   - Hoist the clock advance **out of** the `isBounded` branch at `:361`. Note the flag is `world.spatial_mode === 'bounded'`, **not** `world_layer`.
   - Bounded: clock advance → living tick (existing coupling, unchanged).
   - Open/subworld: **clock only**, no living tick.

5. **Clock storage — decide before coding (migration hazard)**
   - Today `ship_clock_minutes` is documented and tested as a **bounded-world ship clock**; open worlds round-trip it as `null`. Do **not** silently start writing it for open worlds without changing the invariant.
   - Recommended: generalize the column/model field to a neutral internal clock counter (e.g. `world_clock_minutes`) while preserving the existing DB column name if a rename is not worth migration churn. Update the `WorldRepository` port comments, SQLite + Mongo adapters/models, and tests so the invariant becomes: "nullable internal narrative clock minutes for any world; bounded worlds use it for ship simulation, open worlds use it for narrative deadlines."
   - Alternative: add a separate open-world clock field. This is cleaner semantically but higher migration/model surface. Pick one explicitly; the rest of PR C assumes the recommended generalization.

6. **Backfill, with a clamp**
   - First use backfills the internal counter via `worldTimeToMinutes(world_time)` when the counter is null.
   - Implement that parser in `domain/services/narrative-clock.ts` (new) or move the existing clock helpers there deliberately. Current live helpers are `domain/services/world-clock.ts` (`worldTimeBand`) and `domain/services/sim-clock.ts` (tick → band labels); there is no existing `narrative-clock.ts:52`.
   - The parser should read `Day N` + a `~HH:MM` token, fall back to band keywords, and report "unparseable" instead of silently defaulting to Day 1 / 12:00. Cluster Psi-1's `Day 1, morning` parses fine — but a world whose archivist wrote free text like *"just after the market opens"* must not backfill to Day 1 midday and jump **backwards**.
   - **Clamp the backfill so it can never decrease** the effective world time, and treat an unparseable `current_time` as "hold, then advance from here" rather than "reset to Day 1".

7. **Render format — decide explicitly (was an unnoticed side effect)**
   - `minutesToWorldTime` emits `Day 3 — evening (~19:20)`. Every open world currently carrying archivist prose time will **flip format mid-playthrough**, and the `~19:20` token reads as a sci-fi HUD in a Classical Greece story.
   - The clock token is load-bearing: `worldTimeToMinutes` trusts it first for the band round-trip. So do **not** simply delete it.
   - Decision to make (recommend the first): render a **band-only phrase for non-bounded worlds** (`Day 3 — evening`) while keeping minutes as the internal source of truth, accepting the slightly lossier keyword round-trip; **or** accept the clock token everywhere and note it. Either way, state the choice — do not discover it in playtest.

8. **Archivist `current_time`**
   - Demoted to explicit large jumps only, merged by max (item 2). It is no longer a per-turn writer on open worlds.

9. **Guidance (light)**
   - When the dossier has a deadline-shaped objective and the clock is near it, momentum may tighten from that pressure (no menus).

### Tests

- `estimateTurnMinutes`: pure unit tests per band (idle / dialogue / travel / scene change).
- Jump-language predicate: `"the next morning"` gates the LLM call; `"you nod"` does not.
- Merge is max, not sum: deterministic 30 + LLM 480 → 480; deterministic 30 + LLM 5 → 30.
- Backfill clamp: unparseable `current_time` does **not** move the clock backwards.
- Bounded path still advances the internal minute counter + `world_time` (no regression).
- Open-world repository tests assert the new storage invariant explicitly (no stale "open worlds always keep minutes null" test).
- Replay fixture: Cluster Psi-1's ~108 player turns advance past Day 1.

### Exit criteria

- Open-world playtest: after a session of travel/idle, `world_time` is not stuck on the seed string.
- No Haiku call on an ordinary open-world turn (verify via usage tracking in `turns.metadata`).
- `prompts/time-passage.md` contains no Starship-specific framing.
- Deadline language in STATE can become real pressure in PR D.

---

## PR D — Objective lifecycle + dossier ordering + primary pressure

**Goal:** Quests complete, fail, or block; the dossier window shows the *most relevant* items rather than the oldest; one primary pressure is always visible to the narrator stack; idle worlds reassert the A-plot.

**Scope note (R8):** this PR is two bugs, not one. Completion rules alone do not fix it — see item 0.

### Code

0. **Order the dossier caps (R8 — new, and arguably the higher-leverage half)**
   - `formatDossierBlock` (`state-block.ts:433–444`) slices to 4 quests / 4 threads / 5 objectives / 6 clues / 6 resources **off the front, unordered**. Stale actives therefore *evict* newer entries from STATE entirely — the narrator never sees them.
   - Add a pure ranking service (`domain/services/dossier-ranking.ts`) applied before the slice: sort active items by deadline proximity (using the PR C clock), then stakes, then recency.
   - This is why D depends on C: "deadline proximity" is meaningless while the clock is frozen.
   - Consequence worth stating: with ordering in place, an un-completed objective is merely *ranked down* rather than permanently occupying the window — so the lifecycle rules below degrade gracefully when the archivist under-fills, which it reliably does.

0a. **Deadline data shape — do not rank by vibes**
   - Deadline proximity needs a structured source. If `story_objectives` / `story_threads` already have a usable deadline field in the live schema, use it; otherwise add one deliberately (recommended names: `deadline_world_time` free-text label + `deadline_clock_minutes` nullable normalized value once PR C's internal clock exists).
   - If adding fields is too much for this slice, state the v1 limitation explicitly: ranking uses stakes + recency, and only applies deadline proximity when a parseable deadline appears in existing structured fields. Do **not** bury deadline parsing inside title/detail sorting without tests.
   - Any schema/model change must update SQLite migrations, Mongo models/indexes if needed, contracts/types, and repository mappings together.

1. **Archivist completion / failure rules** (`prompts/archivist-system.md`)
   - Mark objectives completed when prose + resources clearly satisfy them (e.g. manifests secured).
   - Mark failed/blocked when clock passes a deadline without delivery, or narration establishes failure; escalate linked `threat` thread.

2. **Optional light heuristics** (domain service, if prompt-only is unreliable)
   - Pure helpers: objective title/detail keywords + resource presence + clock compare — only as *suggestions* merged into patch or guidance, not silent DB writes without archivist if that violates “one writer” discipline. Prefer archivist first; add deterministic complete only if playtests show under-fill (same pattern as inventory A4).

3. **STATE: primary pressure pin** (`formatDossierBlock`)
   ```
   ### PRIMARY PRESSURE (internal — never list as options to the player)
   - <quest title> — <one-line stakes/deadline> (world time: …)
   ```
   Pick single highest-stakes active quest/objective (prefer `kind=quest` with deadline language).

4. **Guidance** (`narrator-guidance.ts`)
   - On idle ≥ threshold with primary objective present: world acts **from that pressure** (watcher, audit rumor, time bite), not random ambience.
   - Keep mutual exclusion with planned NPC moves.

5. **Scene titles**
   - Prefer objective- or beat-linked titles when opening scenes; avoid default “Arriving at …”.

### Tests

- **Ranking (R8):** given 8 active objectives, the 5 rendered are the deadline-nearest / highest-stakes, not the 5 oldest. A newly created objective is never evicted by stale actives.
- Deadline ranking test uses structured deadline data, or explicitly verifies the fallback behavior when structured deadlines are absent.
- formatDossierBlock renders primary pin when quests exist.
- pickMomentumCue / engagement prefers threat or primary objective titles when idle.
- Archivist prompt regression: no requirement for full e2e LLM in CI; fixture patch examples if any.

### Exit criteria

- Play: abandon main quest for shopping → within a few idle turns, pressure from the quest returns without a choice menu.
- Completing a clear objective flips status to completed in dossier.
- A world with more active objectives than the cap shows the relevant ones in STATE (replay fixture against Cluster Psi-1's 2 stale actives + later-invented Archon goal).

---

## PR E — Grounded power costs + violent consequences

**Goal:** Superpowers and public massacres create diegetic cost in historical/grounded worlds.

> **Ships last, and does not gate the release.** As drafted this slice is ~90% prompt text with "tests optional" — which makes it the one slice that cannot prove it works and is most likely to silently stop working after a Grok update, while nonetheless blocking a version bump. Two acceptable shapes:
>
> - **(a) Earn its place.** Land item 4's escalation rule as a *pure* domain helper — `shouldEscalateViolence(patch, place, presentCharacters) → SuggestedThreat | null` — with real unit tests. The prompt changes then have a deterministic partner, and E ships with A–D + F.
> - **(b) Demote.** Ship E as prompt tuning *after* the v0.5.0 drop, evaluated by playtest rather than CI.
>
> Recommend **(a)** — the helper is small and the "public multi-kill produced no institutional response" failure is exactly the kind of thing a prompt alone keeps re-losing. Choose before cutting the branch; do not let E drift into the release untested.

### Code

1. **Correction policy** (`archivist-correction.md` + apply if needed)
   - Powers that break setting physics in a grounded historical world still record if product allows player canon, **and** mint/update concrete dossier rows:
     - supernatural/social exposure → `story_thread` with `kind='threat'`, `status='active'`, stakes/consequences filled (e.g. sacred pollution, city alarm, “rumor of a daimon”)
     - lasting personal side effect or carried mark → `story_resource` only when it is actually an object/condition the protagonist carries (e.g. blood-stained cloak, visible wound, cursed mark)
     - public beat → `story_timeline_event` with `importance >= 4`
   - Avoid vague “condition resource / thread” language in code; each helper output should target exactly one row type.

2. **Narrator-system**
   - New section (not only hub `REALITY` cue):
     > When PLAYER CANON grants superhuman ability in a grounded historical setting, honour it, but every use produces diegetic cost: witnesses, fear, legal/religious response, faction interest. Never frictionless slaughter.

3. **Optional world flag** (if cheap)
   - `power_ceiling: mortal | heightened | mythic` on world/genre later; v1 can infer “grounded” from absence of REALITY cue + historical premise language.

4. **Violence aftermath** (archivist + light guidance)
   - Deaths of citizens/guards/senators in a civic place **must** create/update:
     - `threat` thread (city response / blood-guilt / archon pursuit)
     - timeline event importance ≥ 4
     - observations on present survivors
   - Guidance on violent beats: at least one external reaction unless canon says the world cannot respond.

### Tests

- Correction patch shape for power + cost thread (schema/sanitizer if structured).
- `shouldEscalateViolence` returns exact row-target suggestions: threat thread + timeline event, and resource only for an actual carried condition/object.
- Prompt presence checks optional; prefer unit tests on any pure “should escalate violence” helper if introduced.

### Exit criteria

- Granting super-strength in a Classical Greece world creates lasting pressure, not free god-mode.
- Public multi-kill updates dossier with institutional threat.

---

## PR F — Descriptor continuity (hooded figures)

**Goal:** Name reveals and lookalike descriptors land on one row when they are one person; distinct people stay distinct.

### Code

1. Strengthen archivist rules for same-scene descriptor drift (existing alias / `reveals_name_of` path).
2. When two present figures share clothing/role without contradiction, prefer alias merge over a second row; when narration establishes two identities, keep both and optionally pin a player memorable fact (“Kallias is not Kyaneus”) only if prose establishes it.
3. No new tables.

### Tests

- Existing name-resolution / alias merge tests extended with hooded-figure style descriptors if gaps exist.

### Exit criteria

- Reveal “I’m Kallias” on a tracked hooded row renames that row; does not mint a parallel Kallias + keep anonymous hood forever without alias.

---

## Replay fixture (shared harness for A / C / D)

The audit already produced the only thing missing from this plan's verification story: **~108 real player turns with known-bad outcomes**. Exit criteria for A, C, and D currently lean on manual browser playtests, which do not run in CI and cannot be re-run after a refactor. Turn the export into a regression net.

**What it is:** a test fixture built from `backups/cluster-psi-1-prod-20260808-144926.json` — the (player text, narrator text) pairs plus the world's opening state — replayed through a tiny **in-memory reducer** over the pure services: `extractObjectAcquisition` / `extractItemMovements` → `sanitizeArchivistPatch` → clock estimate → dossier ranking/render. No LLM calls, no DB, no network. Deterministic and fast.

The reducer is deliberately small, but it must model enough state to make the assertions meaningful:

- one protagonist row plus aliases / `is_player`
- story resources with holder/location
- world clock minutes + rendered `world_time`
- threads/objectives/clues/resources/timeline arrays passed to `formatDossierBlock`

Do not call this "pure path only" and then assert held inventory or unique player rows without a state reducer/fake repository shape; those are stateful claims.

**What it asserts (each one a bug the audit actually found):**

| Assertion | Guards |
|---|---|
| Sword mints at seq 67–68 and is held by the protagonist thereafter | PR A |
| `"I draw my sword"` at the Agora fight resolves against a non-empty ledger | PR A (the meat-in-hand beat) |
| Clock advances past Day 1 across the ~108 turns | PR C |
| Clock never moves backwards at any turn | PR C backfill clamp |
| The dossier window at the Archon-hit turns contains the live goal, not only the two stale actives | PR D / R8 |
| Exactly one `is_player` row across the whole replay | PR B |

**Cost:** low-to-moderate — the export exists and the services are pure, but the in-memory reducer is real test code. **Build the reducer with PR A** (the first slice that needs it) and extend it per slice.

**Caveat to honour:** a fixture derived from one world proves those bugs stay fixed; it does not prove the features are good. Manual playtest exit criteria stay — this is additive.

## Explicit non-goals

- Rewriting Cluster Psi-1’s plot in prose by hand beyond data repair.
- Adding a full RPG inventory UI or quantity/consumables (still deferred per inventory plan).
- Softening Tracked Objects so the narrator invents weapons when the ledger is empty.
- Putting quest checklists in second-person narration.
- Making the archivist — or any LLM — the per-turn clock writer on open worlds. The deterministic estimator is primary; the LLM is a jump-detector, not a metronome.
- Raising the dossier caps. R8 is fixed by *ordering* what fills the window, not by widening it — the context budget is not negotiable.

## Layer map (where code goes)

| Concern | Home |
|---------|------|
| Acquisition / synonym / purchase parse | `domain/services/object-acquisition.ts` (+ tests) |
| Possession resolve | `domain/services/inventory-resolution.ts` (existing) |
| Patch merge / protagonist rename | `application/use-cases/apply-archivist-patch.ts` (A9 rename-in-place lives at `:502–511`), `domain/services/patch-sanitizer.ts` |
| Clock math + per-turn estimate | `domain/services/narrative-clock.ts` (**new**, owns minutes parse/render/estimate), `world-clock.ts` (existing band helper, may delegate) |
| Clock storage | `domain/ports/world-repository.ts`, SQLite + Mongo world repositories/models/tests — generalize the `ship_clock_minutes` invariant or add a separate open-world clock field before writing open-world minutes |
| Clock advance wiring | `infrastructure/narrator/narrate-turn.ts` — gate is `world.spatial_mode === 'bounded'` at `:243`, bounded clock block currently at `:361–383` |
| Dossier ranking (R8) | `domain/services/dossier-ranking.ts` (**new**) + structured deadline field/mapping if PR D chooses deadline proximity |
| Violence escalation helper (PR E option a) | `domain/services/` (**new**, pure; outputs exact threat/timeline/resource suggestions) |
| STATE / dossier render | `server/render/state-block.ts` |
| Turn guidance | `domain/services/narrator-guidance.ts` |
| Prompts | `packages/server/prompts/narrator-system.md`, `archivist-system.md`, `archivist-correction.md`, **`time-passage.md`** (de-Starship for PR C) |
| Subworld identity seed | `application/use-cases/enter-subworld.ts` + seed callers — weak defaults at `infrastructure/persistence/mongo/repositories/world-repository.mongo.ts:123` (`'Player'`) and `lib/worlds.ts:161` (`'You'`) |
| Replay fixture | `packages/server/tests/` (+ the existing `backups/` export) |

## Cluster Psi-1 → fix map

| Issue | Fix |
|-------|-----|
| Should be Joseph Osborne | PR B + PR 0 |
| Bought sword forgotten | PR A (+ PR 0 for this world) |
| Meat-in-hand fight | PR A (ledger empty) |
| Clock / Day 3 dead | PR C |
| A-plot abandoned | PR D |
| Power fantasy / no cost | PR E |
| Massacre without aftermath | PR E |
| Hooded figure confusion | PR F |
| New goals invisible behind stale objectives | PR D item 0 (R8 ranking) |
| “What do I do?” | PR D (+ optional UI later, out of this plan) |

## Done definition

A slice (PR A–F) is done when:

1. Unit tests for pure domain changes pass (`npm test` pretest depcruise still green).
2. **The slice's replay-fixture assertions pass** (see “Replay fixture”) — a prompt-only slice with no testable pure partner does not meet this bar and must say so explicitly rather than skipping it.
3. Relevant prompts updated if behavior depends on them.
4. Manual browser smoke for player-visible slices (A, B, C, D): buy gear → leave → use; rename; time advances; idle reasserts primary pressure.
5. No cross-layer import regressions.

The **plan / release** is done when the slice exit criteria above hold for the shipped set **and** the Release exit criteria in the section below are true (version + notes + header verify; promote only when ready to deploy).

---

## Release (version bump & notes)

Binding rules: `docs/RELEASING.md` and `CLAUDE.md` → "Release version bump & deploy". The header on `/` reads `pkg.version` from `packages/server/package.json` — that number must not lie.

### Versioning

| | |
|---|---|
| **Current workspace** | `0.4.0` (root + `@chronicles/server` + `@chronicles/contracts`) |
| **This plan ships as** | **MINOR → `0.5.0`** (player-visible story-continuity features, not a lone hotfix) |
| **If only a thin subset ships first** | Still **MINOR `0.5.0`**, with release notes trimmed to what actually landed. The earlier draft offered a **PATCH `0.4.1`** escape hatch for a solo PR A — **dropped.** Gear persisting across turns is new player-visible behavior, i.e. a feature, and `CLAUDE.md` says feature → MINOR. The hatch invited a rule violation for no benefit. Do **not** bump twice for the same merge stack. |
| **PR 0 (data repair)** | No version bump by itself (ops/data only). |
| **PR E** | If demoted (option b), it ships in a later bump — not folded silently into `0.5.0`'s notes. |

Bump **on the feature/release branch, before merge to `main`** — never as a post-merge commit on `main`.

### What to bump (single commit)

Prefer `npm version minor`, then **verify** all of:

1. `package.json` (repo root)
2. `packages/server/package.json` (version-of-record the header reads)
3. `packages/contracts/package.json`
4. `package-lock.json` — top-level `"version"` **and** `"packages": { "": { "version": … } }`

One commit. Do not rely on a later `npm install` to fix the lockfile.

### Release notes ("What's New")

Every bump prepends a `RELEASES` entry in:

`packages/server/src/components/release-notes/data.ts`

Shape: `{ version, date: 'YYYY-MM-DD', highlights: string[] }`, **newest-first**. Plain language for players — no `depcruise`, ports, use cases, or file paths. Same commit as the version bump when practical.

#### Draft entry for **v0.5.0** (edit date on ship day)

```ts
{
  version: '0.5.0',
  date: 'YYYY-MM-DD', // ship day
  highlights: [
    'Gear you buy or pick up sticks with you — even when the story uses a period name for the same thing (a xiphos still counts as your sword).',
    'Your character keeps one clear name across adventures and corrections, so the story does not split you into two people.',
    'Time moves forward in open-world stories, so deadlines and “three days until…” actually matter.',
    'When you drift, the main story pressure can resurface through the world — without a menu of quest options.',
    'Your active goals stay visible even as new ones pile up — a finished errand no longer crowds out what you actually care about.',
    'In grounded historical settings, superhuman feats and public violence draw real consequences: witnesses, fear, and the city’s response.',
    'Named strangers stay themselves more reliably when they finally tell you who they are.',
  ],
},
```

Trim the list to what actually shipped — drop the consequences line if PR E is demoted, drop the strangers line if PR F slips. The version stays `0.5.0` either way.

### Optional milestone doc

When cutting the release branch, add a dated milestone under `docs/plans/milestones/` per `docs/RELEASING.md` (post-restart naming: date-prefixed so it does not clobber pre-restart `v0.5.0.md`), e.g.:

`docs/plans/milestones/2026-MM-DD-v0.5.0-narrator-controls-story-continuity.md`

Point it at this plan; carry the version-bump + release-notes + promote exit criteria from `_template-milestone.md`.

### Deploy (when ready to ship)

1. Merge release branch → `main` (version + notes already on the branch).
2. Promote: merge/fast-forward `main` → `production`, push `production`.
3. Railway deploys `production`. Confirm header version on the live host.
4. **Do not** treat PR 0 data repair as a deploy gate for the code release unless prod play depends on it the same day.

### Release exit criteria

1. Workspace versions are **`0.5.0`** in root, server, contracts, and lockfile — **on the release branch before merge**.
2. `RELEASES` in `packages/server/src/components/release-notes/data.ts` has a matching **newest-first** entry with player-facing highlights (draft above, edited for what actually shipped).
3. After bump: restart `npm run dev`, confirm header on `/` shows the new version; open What’s New and confirm the entry.
4. After promote to `production`: header and What’s New match on the deployed app.
5. Shipped PR exit criteria (A–F as included in the drop) are met; `npm test` green.

## Related docs

- `docs/RELEASING.md` — version bump, release notes, promote to `production`.
- `docs/plans/_template-milestone.md` — milestone exit-criteria pattern (bump + notes + promote).
- `docs/plans/archive/inventory-item-tracking.md` — possession model and Tracked Objects rigidity (shipped).
- `docs/plans/thread-bootstrap-and-npc-plans.md` — dossier under-fill / focused extractors.
- `packages/server/prompts/narrator-system.md` — narrator controls.
- `packages/server/src/components/release-notes/data.ts` — What’s New source of truth.
- Audit source: `backups/cluster-psi-1-prod-20260808-144926.json`.

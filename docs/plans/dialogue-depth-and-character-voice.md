# Dialogue Depth & Character Voice — Implementation Plan

**Status:** planned (not started)
**Branch:** `feat/dialogue-depth-character-voice` (recommended)
**Trigger:** co-tester reports that Grok app + Grok Voice Think Fast 1.0 feels substantially deeper in character and dialogue than Chronicles play sessions.

## Goal

Close the *felt* gap between Grok Voice companion/voice chat and Chronicles NPC dialogue — **without** replacing the multi-agent novel engine with speech-to-speech, and without dissolving second-person narration into a single companion persona.

Finished work should mean: present agent NPCs speak with sticky, distinct registers; dialogue-heavy turns favor interactional craft (short pressure, one question, interruption, withhold) over uniform novelist monologue; planned moves carry dialogue-facing hints the narrator can stage; TTS-on sessions do not punish good ear-craft.

This is a **craft + staging** track, not a model-swap and not Character Actor Phase 4.

## Why the gap exists (diagnosis)

Grok Voice Think Fast is a **speech-to-speech conversation model** trained for realtime turn-taking, short human-like replies, and (in the 2.x line) RL toward “one question at a time / less fluff.” Presence often comes from **prosody + interactional timing**, not literary interiority.

Chronicles is a different product:

| Surface | Chronicles today | Grok Voice app |
|---|---|---|
| Model | `grok-4.3` text narrator + Haiku NPC agent + optional post-hoc TTS | Native S2S `grok-voice-think-fast-*` |
| Role | Second-person novelist mediating many NPCs | First-person character / assistant talking *to* you |
| Character source | goals, attitude, agenda, reveries → prose staging | Tight identity prompt + voice personality |
| Turn shape | Novel paragraphs + hard STATE law | Short spoken turns, interruptible |
| Depth type | Literary / multi-arc continuity | Interactional / relational presence |

So the co-tester is usually comparing **channel + product shape**, not “same Grok with worse prompts.” The transferable piece is interactional dialogue craft and sticky idiolect — not full S2S as the world engine.

## Done means

1. Present agent NPCs have a compact, sticky **speech register** (idiolect) available to the NPC agent and narrator STATE — not only goals/attitude.
2. On dialogue-heavy beats, turn guidance and/or craft rules bias toward **voice-native dialogue shape** (short spoken lines, one demand/question per NPC beat, interruption/withhold allowed).
3. `planned_actions` can carry optional **dialogue-facing staging hints** (not full prose) so the narrator stages personality, not just “asks about X.”
4. When TTS is likely relevant (or always as soft craft), dialogue scenes prefer **ear-friendly** structure over dense multi-paragraph scenic restatement between every line.
5. Tests cover: register rendering, plan schema/hints, dialogue-beat guidance gates, and prompt contract checks.
6. A real multi-NPC talk scene and a one-on-one confrontation both feel more distinct in playtest — not just “better atmosphere.”

## Non-goals (explicit cuts)

| Cut | Why / when |
|---|---|
| Replace narrator with Voice Agent API / S2S turn loop | Fights archivist, STATE authority, multi-NPC plans, append-only turns, token budgets |
| Full Character Actor agent (Phase 4 roadmap) | Correct long-term home for per-NPC dialogue generation; too large for this track |
| Schema migration for a big new `speech_register` table/column *if avoidable* | Prefer reusing existing text fields or a tiny structured JSON blob first |
| First-person companion mode as default play | Wrong product; multi-NPC novel remains the spine |
| Always-on length bands / hard max tokens for dialogue | Conflicts with craft-freedom; keep risk-gated sparse guidance |
| Matching Grok companion affection / 3D avatar systems | Out of product scope |

## Design principles

1. **Keep the split:** NPC agent decides; narrator stages. Do not make Haiku write full dialogue lines by default (token cost + prose quality). Plans stay decisions + *staging edges*.
2. **Sticky register over ephemeral attitude.** Attitude changes; register should survive dozens of turns unless the character deliberately shifts register under stress.
3. **Sparse guidance.** Dialogue craft fires when the beat is talk-shaped — not every travel/observe turn.
4. **STATE wins.** Register never overrides private-channel audience, object tracking, or “don’t invent orientation.”
5. **Ear and eye both count.** Prose must still read well on the page; when TTS is used, avoid walls of scenery between every spoken line on dialogue beats.
6. **Minimum surface area.** Prefer prompt + render + optional plan field before new LLM calls or schema.

---

## Recommended order

| Phase | Goal | Blast radius |
|---|---|---|
| **0** | Playtest rubric + baseline clips | Docs only |
| **1** | Dialogue-beat craft (narrator prompt + sparse guidance) | Prompts + pure guidance service |
| **2** | Speech register on agent NPCs (author once, render in STATE) | NPC agent + state-block + optional field storage |
| **3** | Dialogue-facing planned-action hints | NPC schema + prompts + state-block |
| **4** | TTS-aware dialogue packing (soft) | Guidance / optional TTS path notes |
| **5** | Optional side-path design note only: “phone call” S2S | Docs; no implementation unless greenlit |

Land **1 → 2 → 3** as the shippable core. Phase 0 is cheap and should happen first so “better” is testable.

---

## Phase 0 — Rubric & baseline (half day)

**Goal:** Agree what “deeper dialogue” means in Chronicles terms so we don’t optimize for pure banter at the expense of the novel.

### Deliverable

Add a short section to this plan (or a linked playtest note) with:

| Scenario | Must improve | Must not regress |
|---|---|---|
| One-on-one interrogation | Distinct register; one hard question; withhold/deflect | STATE secrets leak; PC dialogue authored by narrator |
| Three-present agents in a room | Cross-talk + one line that leaves the PC out occasionally | Everyone monologues at the PC every turn |
| Yield / “wait” under pressure | Legible next act (already clear-handle) + spoken demand | Menu of options |
| TTS listen-through of a talk scene | Lines are speakable; less scenic thrash between quotes | Novel texture disappears entirely |

Record 2–3 baseline turns (world + turn ids) before code lands.

### Exit

Co-tester + owner can score a scene 1–5 on: **distinctness**, **pressure**, **quote quality**, **continuity**.

---

## Phase 1 — Dialogue-beat craft (no schema)

**Goal:** When the turn is talk-shaped, bias craft toward interactional depth *without* changing character storage.

### Diagnosis

`narrator-system.md` already has show-don’t-tell, legible next act, and “NPCs act from own goals.” Sparse guidance in `domain/services/narrator-guidance.ts` already has a weak `stance === 'say'` path (only when the last assistant *summarized* speech). Most dialogue turns get **no** dialogue-specific craft cue.

### Changes

1. **`prompts/narrator-system.md` (Craft section)** — add a compact **Dialogue craft** bullet cluster:
   - On dialogue-heavy beats: prefer short spoken lines over paragraph monologues.
   - One pressure or question per NPC speaking beat; do not stack three interrogatives.
   - Allow interruption, silence, half-answer, topic hijack, and refusal to engage — when consistent with goals.
   - Distinct voices: do not give every NPC the same polished novelist diction; honor register / attitude / agenda when present in STATE.
   - Keep sensory staging, but do not re-paint the whole room between every line when nothing in the room changed.
   - Still never author the protagonist’s dialogue or choices.

2. **`domain/services/narrator-guidance.ts`** — add `pickDialogueBeatCue(ctx)`:
   - Fire when `stance === 'say'` **or** player text looks like speech (reuse classifier stance / light heuristics), **and** `presentNpcCount >= 1`.
   - Also fire on idle/yield with ≥1 present agent if recent assistant turns were speech-demand loops (share DNA with clear-handle, but emphasize *quoted* pressure rather than only physical handles).
   - Cue text roughly:
     > Dialogue beat: stage present NPCs with distinct spoken lines. Prefer one hard question or demand per speaker. Allow interruption, silence, or withhold when it fits goals. Do not summarize what someone “explains” — write the words. Keep scenic restatement thin unless the room or bodies change.
   - Keep it **one short paragraph**; never sparse-away when `stance === 'say'` and present NPCs > 0 (dialogue is the point of the turn).

3. **`tests/`** — unit tests for the guidance gate:
   - `say` + present NPC → cue present
   - `observe` / travel without speech → cue absent
   - meta / OOC stance → no dialogue craft

### Explicit non-change

Do not reintroduce always-on length bands. Do not add a second LLM call.

### Exit

- `npm test` covers guidance.
- Manual: same world, a pure talk turn produces more quoted NPC speech and less “he explains that…”.

---

## Phase 2 — Sticky speech register (character depth substrate)

**Goal:** Each agent-tier NPC carries a durable **how they talk** fingerprint the narrator can honor.

### Storage decision (recommended)

**Prefer no migration if possible.** Encode register as a short structured line inside an existing slow-churn field, **or** add one optional text column if cleaner.

| Option | Choice | Rationale |
|---|---|---|
| A. New `speech_register TEXT` column | **Recommended if any migration is already open nearby** | Clean render, no parse hacks, inspector-visible |
| B. Prefix block inside `description` or `long_term_agenda` | Fallback | Zero migration; fragile and fights other uses |
| C. JSON in `player_notes`-style blob on NPC | Avoid | Wrong semantics |

**Recommended default: Option A** — single nullable `speech_register` text field (≤200 chars), authored once by the NPC agent (or world-gen when agent is first promoted), almost never rewritten.

Shape (free text, not a rigid enum — genre-flexible):

```
clipped · bureaucratic · no small talk · default move: deflect with a counter-question · never monologues
```

or slightly structured for render stability:

```
register: clipped, formal under stress
default_move: counter-question
taboo: never apologizes in public
max_clauses: 2
```

Keep parser **tolerant**: if unstructured prose is stored, render it raw under `voice:`.

### Layering

| Layer | Work |
|---|---|
| Domain entity `Character` | `speech_register: string \| null` |
| Migration | SQLite + Mongo model parity |
| Repositories | dumb CRUD pass-through |
| NPC agent schema | optional `speech_register` on `npc_updates` — **set only when null** |
| `npc-agent-system.md` | Author once: concrete register; do not churn; genre/era-appropriate |
| World-gen / promotion | Optional: seed register when promoting to agent (nice-to-have, can lag) |
| `server/render/state-block.ts` | Under present NPCs: `voice: …` (capped ~160 chars) |
| Archivist | **Do not** extract speech_register from prose by default (avoid thrash); leave to NPC agent |

### Rules

- **Author once.** NPC agent may set `speech_register` only when empty.
- **Stress can bend delivery** via attitude/focus; do not rewrite the register every turn.
- **Historical fidelity** still applies (era-appropriate diction).
- Cap length hard in apply/sanitize (e.g. 200 chars).

### Tests

- NPC agent apply: set when null; ignore overwrite when already set (or only allow explicit rare update if we add a flag later).
- State-block renders `voice:` for present agents with register.
- Prompt contract test: npc-agent system mentions speech register author-once.

### Exit

Two present agents with different registers produce audibly/visibly different dialogue in playtest without prompt-stuffing every turn.

---

## Phase 3 — Dialogue-facing planned moves

**Goal:** Close the handoff gap between “asks about the account” and interactional staging.

### Diagnosis

`PlannedActionSchema` today:

- `intent` — what they want  
- `planned_action` — concrete move  
- `intent_type`, targets, `private_rationale`

Narrator STATE shows:

```
### PLANNED MOVES THIS TURN
- **Marcus** — pulls his chair around and asks what happened
  - intent: find out what Andrew did last night
```

That is enough for agency, weak for **voice**.

### Changes

1. **Extend `PlannedActionSchema`** with optional:

```ts
speech_hint: z.string().optional()
// e.g. "cuts him off; one hard question; no softener; two clauses max"
// Decisions/staging edge only — not full dialogue lines.
```

2. **`npc-agent-system.md`** — under planned_actions:
   - On talk-shaped plans (`intent_type` confront/warn/recruit/question/withhold, or plan implies speech), emit a short `speech_hint`.
   - Never write the full line the character will say (narrator owns prose).
   - Encode: interrupt? one question? withhold? formality shift? silence as the move?

3. **`state-block.ts` PLANNED MOVES** — when `speech_hint` present:

```
- **Marcus** — pulls chair around to face Andrew
  - intent: test whether Andrew is lying
  - speech: cuts him off; one hard question; no softener
```

4. **Narrator craft** — one hard rule bullet: honor `speech:` staging edges when present; still write the actual words in craft.

5. **Persistence** — if intents are stored for audit (`npc_intents`), add optional column or pack into existing metadata JSON **only if** cheap; otherwise speech_hint can be turn-ephemeral (computed each tick, shown only in STATE for that turn). **Prefer ephemeral first** to avoid migration #2 in the same PR as Phase 2.

### Tests

- Schema accepts speech_hint; omit is fine.
- State-block includes speech line only when set.
- Agent prompt contract mentions speech_hint for talk plans.

### Exit

Plans for confrontations routinely include speech_hint; narrator quotes feel sharper and less interchangeable.

---

## Phase 4 — Ear-aware dialogue (TTS soft path)

**Goal:** When players listen, talk scenes should not sound like a dense audiobook paragraph dump.

### Constraints

- Chronicles TTS is **post-hoc** on finished prose (not S2S). Prosody is limited unless the TTS pipeline supports style tags.
- Do not make the narrator write stage-direction soup (`[whispers]`) unless the TTS path can consume it.

### Changes (soft, risk-gated)

1. Guidance cue when dialogue beat **and** (optional) a future `ttsLikely` flag, or simply always on dialogue beats as a light ear note:
   - Prefer speakable lines; avoid re-describing the same static room between every exchange.
   - One breath of physical tell between lines is enough.

2. Inventory current TTS adapter (`infrastructure/tts/`) for supported emphasis/pause tags. If none: **do not invent tags** in prose. Track a follow-up for tag-aware TTS separately.

3. Document for playtesters: comparing Grok Voice S2S to Chronicles TTS will still favor Voice on raw presence; judge **written** dialogue quality first.

### Exit

Listen-through of a 4-turn talk scene is less fatiguing; written quality not degraded for silent readers.

---

## Phase 5 — Side-path note only (do not build yet)

**Optional future product:** “Phone call with one agent NPC” over Grok Voice Agent API → summary + archivist patch back into STATE.

Only design when Phases 1–3 are shipped and the gap is still “presence,” not “writing.” Architecture sketch:

```
Player opens call UI → Voice session (single NPC identity + register + private beliefs)
  → transcript + compact outcome summary
  → AdvanceTurn-compatible patch (beliefs, relationship, dossier) via existing ports
Novel remains system of record; call is a scene mode, not the engine.
```

Out of scope for this plan’s implementation PRs.

---

## Architecture sketch (core path)

```
Player say / talk beat
        │
        ▼
Classifier stance=say ──► narrator-guidance: dialogue craft cue (Phase 1)
        │
        ▼
NPC agent tick
  • author speech_register once (Phase 2)
  • planned_action + optional speech_hint (Phase 3)
        │
        ▼
state-block
  Present: voice: <register>
  PLANNED MOVES: action + intent + speech:
        │
        ▼
Narrator (grok-4.3)
  stages distinct quoted dialogue under STATE + craft rules
        │
        ▼
Optional TTS (post-hoc) — Phase 4 soft packing only
```

**Leak test:** Phases 1–3 should not force dual edits of domain decision logic *and* repository SQL beyond a single pass-through column. Repositories stay dumb CRUD.

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| S2S as main engine? | No | Wrong product shape; breaks multi-agent pipeline |
| Where does idiolect live? | Sticky `speech_register` on character | Goals/attitude already churn; voice should not |
| Who authors register? | NPC agent (once), optional world-gen later | Same home as personal goals / agenda |
| Who writes spoken words? | Narrator only | Quality + single prose voice for scene glue |
| Plan field for delivery? | Optional `speech_hint` | Staging edge without Haiku monologue |
| Guidance style | Sparse, dialogue-gated | Matches craft-freedom; avoids always-on bands |
| Character Actor | Deferred | Phase 4 roadmap; this track is the cheap 80% |
| Migrations | Prefer one small column for register; speech_hint ephemeral | Minimize schema churn |

## Accepted tradeoffs

- **Still not Grok Voice presence.** Prosody and full-duplex timing will remain superior on the app; we improve *writing and distinctness*.
- **Register can be wrong once.** Author-once means a bad first register sticks until a future edit tool/correction path — acceptable vs thrashing every turn.
- **speech_hint is soft.** Narrator may under-honor it; we accept soft compliance over a second LLM dialogue pass.
- **Token cost.** `voice:` + `speech:` lines add a small STATE tax only for present agents with data — cap lengths hard.

## Files (expected)

```
docs/plans/dialogue-depth-and-character-voice.md     THIS plan

packages/server/prompts/narrator-system.md           EDIT — dialogue craft bullets
packages/server/prompts/npc-agent-system.md          EDIT — register + speech_hint rules

packages/server/src/domain/services/narrator-guidance.ts   EDIT — pickDialogueBeatCue
packages/server/src/domain/entities/character.ts           EDIT — speech_register (Phase 2)
packages/server/src/lib/migrations.ts                      EDIT — column (Phase 2)
packages/server/src/lib/npc-agent.ts                       EDIT — schema + apply
packages/server/src/server/render/state-block.ts           EDIT — voice + speech lines
packages/server/src/infrastructure/persistence/**          EDIT — parity if column added

packages/server/tests/narrator-guidance*.ts or guidance tests   EDIT/NEW
packages/server/tests/npc-agent.test.ts                    EDIT
packages/server/tests/dossier or state-block tests         EDIT
packages/server/tests/prompts.test.ts                      EDIT
```

Exact paths for Mongo mappers follow whatever the current character model uses — keep SQLite/Mongo parity.

## PR strategy

| PR | Contents | Version bump |
|---|---|---|
| PR1 | Phase 1 only (prompt + guidance + tests) | PATCH or small MINOR if marketed |
| PR2 | Phase 2 (register field + render + agent author-once) | PATCH/MINOR with migration |
| PR3 | Phase 3 (speech_hint) | PATCH |
| PR4 | Phase 4 soft TTS notes / ear cue | PATCH |

Do **not** land all phases in one mega-PR. Playtest after PR1 before committing to migration in PR2.

**Branching:** cut from `main`. Do not implement on `production` or piggyback on `fix/plot-lifecycle-continuity` (unrelated).

**Versioning:** follow `docs/RELEASING.md` — bump on the feature branch before merge; promote `main → production` only when ready to deploy.

## Gates (each PR)

```sh
npm run depcruise
npm run type-check
npm test
# if persistence touched:
npm run test:mongo
```

Definition of done for behavior PRs: **stream a dialogue-heavy turn end-to-end in the browser** (and listen once if TTS is in scope for that PR).

## Success metrics (qualitative)

After PR1–3, co-tester re-scores the Phase 0 scenarios:

| Signal | Target |
|---|---|
| Distinctness (blind which NPC spoke from a line alone) | Clear improvement |
| Pressure / one-question feel | Clear improvement on interrogations |
| Continuity / STATE obedience | No regression |
| “Feels like Grok Voice” | **Not required** — only “feels like better characters in this novel” |

## Open questions (resolve at implementation time if needed)

1. **Migration now vs later?** If Phase 1 playtest already closes most of the gap, delay Phase 2 column and stash register in a constrained `long_term_agenda` line temporarily — only if migration friction is high. Default remains a real column.
2. **Should world-gen seed register?** Nice; not blocking.
3. **Inspector UI for speech_register?** Optional; raw STATE visibility may be enough for testers.

## Related

- `docs/plans/plot-lifecycle-continuity.md` — closed plot memory (orthogonal; ship separately)
- `docs/specs/agent-system-design.md` — Character Actor (future home for deeper dialogue generation)
- `docs/plans/archive/` craft-freedom / clear-handle work — sparse guidance pattern to extend, not replace
- Narrator craft freedom: keep numeric length bands out

---

## Implementation checklist (when starting code)

- [ ] Phase 0 rubric + 2 baseline world/turn refs
- [ ] Phase 1 narrator craft + dialogue guidance + tests
- [ ] Playtest PR1
- [ ] Phase 2 speech_register column + agent author-once + state-block
- [ ] Playtest PR2
- [ ] Phase 3 speech_hint on plans + render
- [ ] Playtest PR3
- [ ] Phase 4 only if TTS complaints remain
- [ ] Archive this plan to `docs/plans/archive/` when shipped

# NPC Private Knowledge — Implementation Plan

**Status:** shipped (v0.7.0)
**Branch target:** `feat/npc-private-knowledge` off `main`
**Target release:** next **MINOR** after the branch lands (e.g. `0.N.0` — bump on the feature branch before merge; see `docs/RELEASING.md`)
**Authored:** 2026-08-11
**Trigger:** Play report — whispers and texts are treated as public knowledge: co-present NPCs and off-scene NPCs act as if they heard private speech; no durable audience model.
**Related (do not conflate):**

| Doc | Relationship |
|---|---|
| [archive/narrator-controls-story-continuity](archive/narrator-controls-story-continuity.md) | Structure-first continuity (inventory, place, identity). This plan applies the same principle to **who knows what**. |
| [archive/narrator-craft-freedom](archive/narrator-craft-freedom.md) | Soft craft rules are not enough; knowledge needs **system facts in STATE**, not only “each NPC knows only what it perceived.” |
| [archive/npc-initiation-fixes](archive/npc-initiation-fixes.md) | Planned moves stage agency; they currently consume **shared** prior narration — private channels must not feed non-audience planners. |
| [specs/npc-narrator-runtime](../specs/npc-narrator-runtime.md) | Already states private fields shape behavior without exposition; does not define **inter-NPC information partitions**. |
| [specs/memory-architecture](../specs/memory-architecture.md) | “The LLM does not remember. The system decides.” Knowledge audience is another system decision. |

## Goal

Make **private communication private by structure**:

1. When the player **whispers**, speaks **aside**, or sends a **text / DM / private call** to a named character, only the **audience** (and optional deterministic overhearers) may treat that content as known.
2. Non-audience NPCs — same room or another room — must **not** plan, observe, or dialogue as if they heard it, unless the fiction later transmits it (retell, open radio, loud restatement).
3. The system remains the source of truth: **detect → stamp STATE → filter writes → constrain narrator/agent**. Prompts reinforce; they do not solely enforce.

**Principle:**

> **Public transcript is not world knowledge.** Shared history packing stays for the *player-facing* story; who is allowed to *act on* a line is an audience set the domain computes.

Success is not “the model tries harder to keep secrets.” Success is: a whisper-to-Marcus turn never produces Kyle-reacts-to-the-whisper prose or off-scene agent belief updates about that whisper **unless** Marcus (or a co-located overhearer) is in the audience — and unit tests lock the filters.

## Evidence (as-built)

Verified 2026-08-11 against live tree + Sequence Vigil (local Mongo world #5):

| Layer | Soft rule today | Hard enforcement |
|---|---|---|
| `narrator-system.md` | “Each NPC knows only what it has perceived” | **None** — full history + multi-NPC STATE in one prompt |
| `archivist-system.md` | Perception check on `observations_append` (same place / open channel) | **None** — `applyArchivistPatch` does not drop off-audience observations |
| NPC agent | Plans from personal goals | **Shared** `PRIOR NARRATION` for every tickable NPC in one batch |
| STATE | `private read (known only to X)` labels | Still **visible** to the same model staging all present NPCs |
| Channels | Whisper / text / phone | **Not modeled** — plain player/narrator prose |

**Smoking guns:**

1. **No `PrivateUtterance` / audience type** in domain or turn metadata.
2. **`runNpcAgentTick`** builds one `priorNarration` string for all agents (`npc-agent.ts`).
3. **`packNarratorHistory`** prefers full narrator prose — private lines ride along as public memory for the next turn’s omniscient call.
4. **Archivist** sees the full transcript; only prompt text asks for a perception check.

## Non-goals (explicit)

- **Do not** build full multiplayer fog-of-war or per-player knowledge graphs.
- **Do not** open multi-turn provider sessions so “Grok remembers who knows what.”
- **Do not** rewrite the entire history packer into vector memory (embeddings remain out of scope).
- **Do not** require a new DB table for v1 if turn metadata + pure domain filters suffice (same pattern as open-order v1).
- **Do not** make *all* dialogue private by default — room-scale public speech stays public.
- **Do not** block the narrator from *describing* a whisper on the page for the player (the PC knows what they said); block **non-audience NPC reaction and durable knowledge writes**.
- **Do not** solve “NPC A privately tells NPC B off-screen” as v1 — player-originated private channels first.

## Current control stack (knowledge-relevant)

```
player action
  → classifier
  → NPC agent (SHARED prior narration + all tickable NPCs)   ← leak
  → formatStateBlock (all present private fields visible)   ← soft-only partition
  → streamText(system + history FULL + STATE + action)      ← leak via history
  → archivist (full transcript → observations / facts)      ← leak if omniscient
```

## Architecture sketch (target)

```
player action
  → detectPrivateUtterance(playerText, knownCharacters)     // pure domain
  → mergeMetadata(playerTurnId, 'private_utterance', …)   // durable
  → NPC agent:
       publicDigest(prior) + per-NPC private lines only if audience
  → formatStateBlock:
       ### PRIVATE THIS TURN (audience: …) — non-audience MUST NOT act on content
  → streamText (history still full for PC continuity; STATE pins audience)
  → archivist apply path:
       drop observations_append / belief-ish writes for non-audience
       optional: tag memorable_facts with audience when private
```

**Dependency direction unchanged:** pure detect/filter/digest in `domain/services/`; markdown in `prompts/` + `server/render/`; wiring in `narrate-turn.ts` / `lib/npc-agent.ts` / archivist apply; no new onion violations.

---

## Domain model (v1)

```ts
type PrivateChannel = 'whisper' | 'aside' | 'text' | 'dm' | 'private_call'

type PrivateUtterance = {
  channel: PrivateChannel
  /** Character ids allowed to know the content this turn (and persist knowledge). */
  audienceCharacterIds: number[]
  audienceNames: string[]
  /** Optional excerpt for debug / agent private context (not printed as mechanics). */
  contentHint?: string
  createdTurnId: number
  /**
   * If true, co-located non-audience may overhear (failed stealth / loud whisper).
   * v1 default false for whisper/text; true only when player text implies loudness.
   */
  mayOverhear: boolean
  status: 'active' | 'expired'
}
```

**TTL / durability:**

- Stamp on the **player turn** via `turns.mergeMetadata(playerTurnId, 'private_utterance', …)` (open-order pattern).
- **Active for the current turn’s** agent + narrator + archivist pipeline.
- Optional: keep last N private utterances on recent user turns for “don’t retcon last whisper” guidance — not a full knowledge graph.

**Public vs private speech (detection conservative):**

| Pattern (player text) | Channel | Audience |
|---|---|---|
| `whisper to X`, `whisper X`, `lean in to X and…`, `aside to X` | `whisper` / `aside` | named known character(s) |
| `text X`, `text message to X`, `DM X`, `message X on…`, `iMessage…` | `text` / `dm` | named recipient |
| `call X privately`, `phone X in private`, `FaceTime X` (solo) | `private_call` | named party |
| bare `"Hello everyone"` / public say | **public** | no `PrivateUtterance` |
| whisper with no resolvable name | **public or no-op** — do not invent audience |

Prefer **structured name match** against known characters (same conservatism as open-order). Multi-audience (“whisper to Marcus and Kyle”) if both names resolve.

---

## Phased work

Recommended order: **0 → A → B → C → playtest → D (optional)**.

### Phase 0 — Characterization fixtures *(no product change)*

**Goal:** lock the leak with tests that fail today (or red→green on implement).

1. Fixture world: PC + Marcus + Kyle co-present; off-scene Jordana.
2. Player: `I whisper to Marcus, "The letter is under the floorboard."`
3. Capture (or assert expected post-change):
   - Kyle must not get `observations_append` about the floorboard.
   - Jordana’s agent context must not include the whispered content as shared prior.
   - STATE must expose an audience pin when detection hits.

**Files:** `packages/server/tests/private-utterance.test.ts` (new, pure first), later integration fakes.

**Exit:** pure detection tests green for positive/negative cases; integration tests red until A–C land (or written as `.todo` / skipped until implementation — prefer green pure suite first).

---

### Phase A — Detect + durable stamp *(pure domain + wire)*

**Goal:** every private player move is a system fact before agents/narrator run.

**Changes:**

1. **NEW** `domain/services/private-utterance.ts`
   - `detectPrivateUtterance(playerText, knownCharacters, createdTurnId): PrivateUtterance | null`
   - `privateUtteranceToMetadata` / `fromMetadata`
   - `isAudience(characterId, utterance)`
   - `publicDigest(priorNarration, utterance): string` — for agent tick: strip or replace private quoted spans with `[private to Marcus — content redacted]` when utterance is known; if no structured utterance, return prior unchanged
2. **EDIT** `narrate-turn.ts` (pre-stream, after player turn exists):
   - detect → `mergeMetadata(playerTurnId, 'private_utterance', …)`
   - pass `PrivateUtterance | null` into NPC agent + state render + guidance

**Tests:** detection matrix (whisper, text, public, unknown name, multi-name); metadata round-trip.

**Risk:** low–medium (false positives). Keep verbs tight; require a resolved known character.

---

### Phase B — Filter knowledge **writes** *(archivist apply path)*

**Goal:** non-audience rows never gain observations (or private belief lines) about private content.

**Changes:**

1. Pure helper `filterArchivistKnowledgeForAudience(patch, utterance, charactersByName)` in domain (or next to patch sanitizer):
   - For each `characters[]` entry with `observations_append` (and any belief-like append if present in schema): drop if character is not in audience **and** utterance is active.
   - When no private utterance: no-op.
2. Wire into archivist apply path **after** LLM patch, **before** persistence (`sanitizeArchivistPatch` / `applyArchivistPatch` edge — prefer pure sanitize so both SQLite and Mongo paths share it).
3. Prompt reinforce (`archivist-system.md`): private whisper/text → only audience gets observations; do not mint facts for others. Structure still wins.

**Non-goal in B:** full redaction of `memorable_facts` on the player row (PC may keep the secret as their fact).

**Tests:** patch fixture with observations on Marcus + Kyle + off-scene name → only Marcus survives for a whisper-to-Marcus utterance.

**Risk:** medium — archivist may encode private content into **thread/clue** rows. v1: if private utterance active, strip or refuse `story_clues` / thread summaries that quote the private content for non-audience… **Minimal v1:** filter character observations only; add clue/thread scrub in Phase D if playtest still leaks via dossier.

---

### Phase C — Constrain **reads** for agent + narrator *(render + agent context)*

**Goal:** non-audience minds never receive the private content as shared context for *this* turn’s decisions.

#### C1 — STATE pin (narrator)

**EDIT** `server/render/state-block.ts`:

```markdown
### PRIVATE THIS TURN (authoritative audience)
- channel: whisper
- audience: Marcus only
- Non-audience present NPCs MUST NOT react as if they heard the private content.
- Do not have off-scene NPCs reference it.
- The protagonist and audience may act on it; others only if later fiction transmits it.
```

Do **not** dump the secret text into STATE if it can be avoided (player action already has it). Optional one-line content hint only if detection confidence needs it for the model — prefer audience list without restating the secret.

**EDIT** `narrator-system.md` hard constraints: short pin — private STATE audience wins over history implication.

**EDIT** `narrator-guidance.ts` (sparse, risk-gated): when `privateUtterance` active, one line: *Honor PRIVATE THIS TURN audience; non-audience no reaction to the private content.*

#### C2 — NPC agent context split

**EDIT** `lib/npc-agent.ts` / user message builder:

- Replace raw `priorNarration` with:
  - `publicDigest(priorNarration, activePrivateUtterance)` for **all** NPCs, **plus**
  - for audience NPCs only: `PRIVATE TO YOU: <player private line or short digest>`
- User message: include `PRIVATE CHANNEL THIS TURN: audience = …` so planning does not invent “everyone heard.”
- Off-scene non-audience: never receive private content.

**Prompt** (`npc-agent-system.md`): one short rule under planned actions — if not in audience, do not plan reactions to private content; do not update beliefs from redacted material.

**Tests:**

- Unit: `publicDigest` redacts quoted whisper content when utterance provided.
- Unit: audience membership.
- Optional fake-port: agent message builder includes private block only for audience ids (if builder is pure-extractable).

**Risk:** medium — redaction heuristics on free prose can under- or over-redact. Prefer redacting **player action** from the *current* turn in agent “PLAYER IS ABOUT TO” more than brittle prior-narration regex: for v1, also pass the private player line only to audience in the agent user message, and use a coarse prior digest when utterance is active (`[Prior beat — private exchange with Marcus redacted]`).

**Implementation preference (v1, simpler):**

1. Current turn private content: **split agent “PLAYER IS ABOUT TO”** — audience NPCs get full player text; others get a redacted line (`[Player spoke privately to Marcus — content not audible to you]`).
2. Prior narration: if the previous turn had `private_utterance` metadata on the prior user turn, feed agents a short public digest instead of full prior prose (or full prose with a hard prefix: “Private lines in prior beat are not known to you unless you were audience”).

Deriving prior private utterance: load recent user turn metadata if port allows; else re-detect from prior user content (same pure function).

---

### Phase D — Optional harden *(after playtest)*

Only if leaks remain:

| Option | Work |
|---|---|
| **D1** | Scrub archivist clues/threads that embed private content while utterance active |
| **D2** | Per-NPC agent calls for audience vs non-audience (costly — last resort) |
| **D3** | History packer marks private spans in assistant turns (requires narrator/archivist to emit audience tags — heavy) |
| **D4** | Overhear rolls: co-located non-audience with `mayOverhear` when player said “loud enough” / failed stealth |

Default: **skip D** until playtest proves need.

---

## Playtest gate

Worlds: one **multi-cast room** (whisper) + one **modern phone** world (text).

| Script | Pass |
|---|---|
| Whisper secret to A with B present; ask B what they heard | B does not know the secret; may notice whispering *happened* without content |
| Text secret to C while D is co-present | D does not act on text content |
| Off-scene E ticks next turn | E’s plans/beliefs do not reference the secret |
| Later: A retells publicly | B/D may then know (public speech) |
| Continuity | Place / inventory / PC agency unchanged |

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Soft prompt only vs structure | **Structure first** | Soft rules already failed in play |
| Storage v1 | **Player-turn metadata** (`private_utterance`) | Same as open-order; no new table |
| Default room speech | **Public** | Only marked private channels restrict |
| Overhear v1 | **Off** unless player text implies loud / failed stealth | Conservative privacy |
| Who may know a whisper | **Named audience** (+ optional overhear later) | Matches player intent |
| Text / DM | **Recipient only** | Even if co-present |
| Filter priority | **Writes (B) + agent current-turn split (C2) before full history redaction** | Highest leak surface, least brittle |
| Full history packer rewrite | **Defer** | Player needs to see their own story; STATE + agent filters first |
| Version | **MINOR** | Player-visible behavior |
| Feature flag | **No** — constants for detection strictness at file top | Easy git rollback |

## Explicit cuts

- NPC-to-NPC secret graphs and “who told whom” multi-hop reasoning.
- Cryptographic / real multiplayer isolation.
- Auto-detecting every soft secret in free prose (“don’t tell anyone” without a channel verb) — too false-positive-heavy for v1.
- Vector memory of per-NPC knowledge bases.

## Accepted tradeoffs

- **Some leaks via long history** until D3: narrator may still *see* prior private lines in packed history; STATE + guidance + agent filters reduce **on-page and plan** leakage first.
- **Conservative detection** will miss exotic phrasing (“I cup my hand to her ear and mention the floorboard”) until patterns expand.
- **PublicDigest** may over-redact flavor when a private utterance is active — acceptable for one turn.
- **Archivist thread/clue** leakage possible until D1 — monitor in playtest.

## Sequencing / PRs

| PR | Contents | Effort |
|---|---|---|
| **0** | Pure detect + unit matrix | S |
| **A** | Stamp metadata + narrate-turn wire | S |
| **B** | Archivist knowledge write filter | S–M |
| **C** | STATE pin + agent context split + prompts + guidance | M |
| **gate** | Dual-script playtest | S |
| **D** | Optional harden | S–M |

May stack A+B+C as one PR if kept tight; prefer **A alone** first so detection is attributable.

**Suggested version:** MINOR for A–C train.

## Exit criteria

1. Unit: detection hits whisper/text/aside with known names; ignores public speech; unknown names do not invent audience.
2. Unit: archivist filter drops non-audience `observations_append` under active private utterance.
3. Unit: agent-facing player text is redacted for non-audience; full for audience.
4. STATE emits `### PRIVATE THIS TURN` when active.
5. Playtest scripts pass (whisper + text + off-scene).
6. `depcruise`, `type-check`, `npm test` green; `test:mongo` if ports touched.
7. Version bump + What’s New; plan archived when shipped.
8. Spec touch-up: `npc-narrator-runtime.md` / agent design — knowledge is audience-scoped by system fact.

## Rollback

| Layer | Rollback |
|---|---|
| Detection | Stop stamping metadata; filters no-op without utterance |
| Archivist filter | Revert sanitize hook |
| STATE / guidance | Revert render + one guidance line |
| Agent split | Restore shared full prior + full player text |

## Open questions for Andrew

1. **Overhear:** v1 never overhears, or allow “loud whisper” / failed stealth patterns?
2. **Should co-present NPCs notice *that* a whisper happened** (without content)? Recommend **yes** — “Marcus leans in; the others only see the huddle.”
3. **Group texts** (“text the team”): skip until multi-audience names are explicit?
4. **Ship before or after clear-handle 0.6.1 promote?** Independent; can parallel.

## Implementation checklist (executing agent)

- [x] Phase 0 / pure detect tests
- [x] Phase A stamp + wire
- [x] Phase B archivist write filter
- [x] Phase C STATE + agent split + prompts + guidance
- [ ] Playtest whisper + text scripts (manual)
- [x] Version bump + What’s New + archive plan
- [x] Spec one-paragraph update (audience-scoped knowledge)

---

## Appendix A — Leak matrix (before → after)

| Event | Before | After v1 |
|---|---|---|
| Whisper to Marcus, Kyle present | Kyle may answer the secret | Kyle may notice huddle; must not know content |
| Text to Jordana, Marcus present | Marcus may react to text | Marcus cannot act on text body |
| Off-scene agent tick | Shared prior may include secret | Public digest / no private player line |
| Archivist observations | Any named NPC possible | Non-audience dropped |
| Later public retell by Marcus | — | Public speech; others may learn |

## Appendix B — Mapping to layers

| Concern | Home |
|---|---|
| Detect / audience / digest / filter | `domain/services/private-utterance.ts` (+ sanitize helper) |
| Metadata stamp | `narrate-turn.ts` + `TurnRepository.mergeMetadata` |
| STATE dialect | `server/render/state-block.ts` |
| Agent context | `lib/npc-agent.ts` (strangler; no new decide logic in lib) |
| Soft reinforce | `prompts/narrator-system.md`, `archivist-system.md`, `npc-agent-system.md` |
| Sparse guidance | `domain/services/narrator-guidance.ts` |

## Appendix C — Why not “just strengthen the prompt”

Craft-freedom and continuity work already proved: when STATE and history **broadcast** a fact to one omniscient call, soft “don’t use this” loses to the transcript. Private knowledge needs the same treatment as inventory: **structure first.**

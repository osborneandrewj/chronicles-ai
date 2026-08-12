# Hub Simulation Logs, Clearance & Antagonist Ops — Implementation Plan

**Status:** implemented  

**Branch (recommended):** `feat/hub-sim-logs-antagonist-ops`  
**Depends on (shipped):** simulation-hub layering (`world_layer`, `parent_world_id`), `simulation_session`, `ReturnToHub` / `EnterSubworld`, Meta-Story Bible (`meta_story_json`), one-way bleed (`selectBleedThreads`), concealment gate.  
**Related plans:** [`archive/simulation-hub-redesign-plan.md`](./archive/simulation-hub-redesign-plan.md), [`archive/simulation-hub-implementation-plan.md`](./archive/simulation-hub-implementation-plan.md), [`narrator-history-and-archivist-lag.md`](./narrator-history-and-archivist-lag.md) (orthogonal).  
**Version on ship:** **MINOR** (player-visible hub capability + antagonist pressure loop).

---

## Goal

Close the missing **sim ↔ hub knowledge loop**:

1. Every subworld run produces a **greatly compacted** log artifact on the **hub** (never raw turn dumps).
2. **Hub NPCs** (and the player, when diegetically allowed) may **read those logs only with clearance**, typically by going to a **console** (authored place / interaction mode)—not by ambient omniscience.
3. A durable **hub antagonist** (the Meta-Story Bible “bad guy,” operationalized as a high-agency NPC) is the primary consumer of full logs, maintains a compact **PlayerModel**, and can **seed influence** into new simulations (vessels / plan pressure)—without replacing the player as `is_player`.

**North-star:** Meridian Directive staff can pull Sequence Vigil from a console *if cleared*; the antagonist uses that intel to anticipate and pressure the player across runs. Token budget stays bounded by **compaction + clearance + on-demand injection**, not “always inject all logs.”

---

## Done means

1. On subworld exit (and optionally on demand), a **SimRunReport** is persisted against the **hub** world, keyed by subworld id + codename.
2. Reports are **small** (hard caps: summary length, bullet counts, token estimate)—never full subworld transcripts.
3. Return paths are **idempotent**: same `(hub_world_id, subworld_id)` produces one report row whether exit is detected in narrator `onFinish`, play-page dead-player recovery, retry, or reload.
4. Hub characters carry a **clearance** level through a first-class projected field; only eligible NPCs (and eligible player moments) see full or partial report content in narrator / NPC-agent context.
5. **Console-gated access:** full log text is *not* in every hub turn’s STATE. It enters context when the active scene/place is console-capable (or the player/NPC action is a log-query), subject to clearance.
6. Meta-Story **antagonist** is linked to a concrete hub character row (or seeded as one) with high agency and default high clearance.
7. Antagonist (and only high-clearance paths) can form an **InfluencePacket** consumed by `EnterSubworld` (vessel NPC and/or plan constraints)—still one-way into the sim for *control*; reports are the reverse *intel* channel.
8. Concealment unchanged: pre-`has_awoken`, no hub/logs leak on inspect/list/API.
9. Tests: pure clearance + compaction + console gate; use-case report write on return; duplicate-close idempotency; mixed-clearance NPC-agent leak prevention; depcruise/type-check/suite green; one browser smoke post-awaken (console query yields compacted Vigil log for cleared NPC dialogue).

---

## Problem (current gaps)

| Gap | Today |
|-----|--------|
| Sim → hub knowledge | **None.** Bleed is hub → subworld only (`selectBleedThreads`). `ReturnToHub` places the player; it does not import sim facts. |
| Hub NPC awareness of “Sequence Vigil” | Narrator may invent; **STATE has no reports**. |
| Token risk if naïvely fixed | Dumping subworld turns into hub prompts would blow budget and drown STATE. |
| Antagonist | Bible field `antagonist: string` is prose wallpaper—not a character, not ops, not intel-driven. |
| Player anticipation | No durable PlayerModel; no post-run behavioral update. |

---

## Product principles

1. **Compact artifacts, not shared databases.** Subworlds keep their own turns/characters. The hub stores **reports**, not a live join to child `turns`.
2. **Clearance is structured truth.** Who may know what is domain state, not prompt hope.
3. **Diegetic access.** “Goes to a console” is the default UX for deep log pulls—matches facility fiction and keeps ambient hub turns cheap.
4. **Antagonist is ops, player is protagonist.** Single `is_player=1`. The bad guy is a major NPC.
5. **Influence is plan + vessel, not puppetry.** Sims stay playable; antagonist pressure is seeded constraints and faces, not remote control of every beat.
6. **Wrong beliefs allowed.** PlayerModel and classified notes can be incomplete or biased (hubris, politics).

---

## Domain model

### SimRunReport (hub-scoped artifact)

```ts
// Conceptual shape — pure entity under domain/entities/
type ClearanceLevel =
  | 'public_crew'      // sanitized status line only
  | 'operator'         // mission summary + outcomes
  | 'classified'       // + anomalies, identity hints, bleed hits
  | 'antagonist'       // full report (same payload as classified in v1, reserved)

type SimRunStatus = 'completed' | 'aborted' | 'death_exit' | 'awakening_exit' | 'ongoing'

type SimRunReport = {
  id: number                 // store-assigned row id
  hubWorldId: number
  subworldId: number
  codename: string           // player-facing sim name e.g. "Sequence Vigil"
  genreTags: string[]        // short, optional
  status: SimRunStatus
  // Compact body — HARD CAPS enforced in pure sanitizer
  headline: string           // ≤120 chars
  summary: string            // ≤600 chars (~150 tokens)
  outcomes: string[]         // max 5, each ≤120 chars
  anomalies: string[]        // max 4, each ≤120 chars (lucidity, rule breaks, bleed)
  personsOfInterest: string[] // max 4 names/roles only
  // Classification
  minClearance: ClearanceLevel  // floor to read beyond headline
  createdAt: string
  sourceTurnId: number | null   // hub or subworld turn that closed the run
}
```

**Identity / idempotency:**

- Store-assigned numeric `id` follows the rest of the repo.
- Persistence has a unique key on `(hub_world_id, subworld_id)` / `(hubWorldId, subworldId)`.
- `upsertByRun(report)` overwrites the compact report body for the same run but never creates a duplicate. Prefer keeping the earliest `createdAt`; update body/status/source fields on retry if they are better populated.
- `codename` is display text, not identity. It can be regenerated or renamed without breaking the unique key.

**Compaction rules (pure `compactSimRunReport` / builder):**

| Field | Cap |
|-------|-----|
| `headline` | 120 chars |
| `summary` | 600 chars |
| `outcomes[]` | 5 × 120 |
| `anomalies[]` | 4 × 120 |
| `personsOfInterest[]` | 4 × 40 |
| **Whole report rendered for prompt** | **≤ ~400 tokens** estimate (`ceil(chars/4)`) |

Generation: Haiku (or existing extract tier) **once** at run close over a **bounded** subworld window (e.g. last N turns + dossier snapshot + exit kind)—**not** full history. Fallback: deterministic stub from exit kind + codename + place names if LLM fails.

**Timing rule:** exit must not be held hostage by report quality. v1 writes a deterministic compact stub synchronously during close, then may enrich it with the summarizer in a background task. If we choose synchronous Haiku instead, document the latency acceptance and cap it tightly; the default is stub-now, enrich-later.

### Clearance on hub characters

```ts
// First-class character field (hub only; ignored on subworlds)
character.clearance_level: ClearanceLevel   // default 'public_crew' for ensemble
character.ops_roles?: string[]              // v1 optional; can stay in notes/traits until needed
```

Do **not** rely on `traits.clearance` for v1 unless the repository/entity projections are explicitly extended. SQLite currently has a legacy `traits_json` column and Mongo has embedded `traits`, but the domain `Character` projection does not expose them. Recommended v1 path: add `characters.clearance_level TEXT NOT NULL DEFAULT 'public_crew'` plus the matching Mongo field, entity field, repository projection, and narrow writer.

| Level | Typical holders | What console returns |
|-------|-----------------|----------------------|
| `public_crew` | Most ensemble | Codename + status + one-line headline |
| `operator` | Tech / sim-room staff | + summary + outcomes |
| `classified` | Senior staff, program | + anomalies + POIs |
| `antagonist` | Bible antagonist NPC | Full compacted report (+ later: PlayerModel write access) |

**Player clearance:** start `public_crew` or `operator` post-awaken (tune in seed); can rise via story. Player console use is allowed when action/scene implies it and clearance passes.

### Console access (diegetic gate)

```ts
// Pure: shouldInjectSimLogs(ctx) → InjectDecision
type ConsoleAccessContext = {
  worldLayer: 'hub' | 'subworld' | 'standalone'
  placeId: number | null
  placeName: string | null
  isConsoleCapablePlace: boolean // v1 derived from hub template simulationRoomKey -> seeded place
  playerText: string
  actingCharacterClearance: ClearanceLevel  // player or present NPC under focus
  hasAwoken: boolean
}
```

**Inject full eligible reports into narrator/NPC context only when:**

1. `worldLayer === 'hub'`, and  
2. `hasAwoken` (or internal system path post-concealment), and  
3. **Console intent** is true:
   - active place is console-capable. v1 derives this from the hub archetype `simulationRoomKey` by resolving that room's display name to the seeded `Place`, and treats the whole simulation room as console-capable, **or**
   - player text matches log-access language (`pull up`, `access log`, `sequence vigil`, `console`, `mission report`, …)—precision-biased regex like story-signal, **or**
   - NPC agent tick is explicitly in “console consult” mode (optional later),  
4. and clearance ≥ each report’s `minClearance` for the **slice** returned.

**Ambient hub turns** (corridor chat, mess hall): STATE may list **index only**—codename + status—for reports the present cast could *know exist*, not bodies. That keeps budget flat.

**Index line cap:** max 8 reports × one short line in ambient STATE.

### Hub antagonist (ops, not wallpaper)

| Concern | Approach |
|---------|----------|
| Identity | At hub seed (or first post-bible pass), ensure one character matches bible `antagonist` (name/role); set `clearance_level = 'antagonist'`, high agency tier, memorable public face vs hidden goal in durable NPC fields |
| PlayerModel | Hub-scoped compact JSON (see below); **writable** by antagonist-side extract after debrief / key hub scenes |
| Influence | `InfluencePacket` produced when entering a new subworld (and rarely mid-run later) |
| Visibility | Pre-awaken: still concealed with hub. Post-awaken: present as crew senior / program face |

```ts
type PlayerModel = {
  hubWorldId: number
  // All fields short; total render ≤ ~250 tokens
  tactics: string[]          // max 4
  softSpots: string[]        // max 3
  tells: string[]            // max 3
  openGoals: string[]        // max 3
  stanceTowardProgram: string  // ≤120 chars
  antagonistBeliefs: string[]  // max 3 — may be wrong
  updatedAt: string
}
```

### InfluencePacket (hub → subworld, control channel)

Complements existing **bleed motifs** (tone/wrongness). Does **not** reverse-write sim turns to hub.

```ts
type InfluencePacket = {
  hubWorldId: number
  targetSubworldId: number | null  // set on enter
  // Compact
  planSummary: string            // ≤200 chars
  vessel: {
    role: string                 // e.g. "rival legate", "friendly archivist"
    nameHint: string | null
    publicGoal: string           // ≤120
    hiddenGoal: string           // ≤120 — narrator/NPC may use carefully
  } | null
  pressureTags: string[]         // max 4 — e.g. "block_archive", "bait_trust"
  bleedMotifIds: string[]        // subset of bible motifs to emphasize
}
```

Consumed in `EnterSubworld` / first sim narrator assembly: seed vessel as character stub or archivist-facing prior; inject pressure into STATE once. **No per-turn full packet spam**—cache on subworld metadata / opening state.

**Persistence note:** `EnterSubworld` currently creates a normal open world, then marks it `subworld`. If packet state is persisted on the world, add a narrow world metadata field/port method or a dedicated `InfluencePacketRepository`; do not hide it in unprojected JSON the narrator cannot read.

---

## Token budget (binding)

| Surface | Budget rule |
|---------|-------------|
| Single report body in prompt | ≤ ~400 tokens |
| Console pull (one query) | Default **1 report** full body + optional index of others (max 8 lines) |
| Ambient hub STATE | Index only (≤ 8 lines); **0** full bodies |
| PlayerModel | ≤ ~250 tokens, only for antagonist NPC agent + optional narrator when antagonist present |
| InfluencePacket | ≤ ~200 tokens, once at sim entry (and rare updates) |
| Antagonist NPC agent | PlayerModel + **at most 1** report body if console mode, else index |

If over budget: drop anomalies → POIs → truncate summary. Never expand to raw turns.

---

## Architecture (hexagonal)

| Layer | Responsibility |
|-------|----------------|
| `domain/entities/` | `SimRunReport`, `PlayerModel`, `InfluencePacket`, clearance enums |
| `domain/services/` | `compactSimRunReport`, `filterReportsForClearance`, `shouldInjectSimLogs` (console gate), `buildInfluencePacket` (pure merge of model + bible + latest reports), clearance ordering |
| `domain/ports/` | `SimRunRepository` (list/get/upsert by hub, unique run key), optional `PlayerModelRepository` or explicit hub metadata port |
| `application/use-cases/` | `CloseSubworldAndReturn` wraps/extends `ReturnToHub` to build+store report; `QuerySimLog` (optional explicit); `EnterSubworld` attaches influence; seed antagonist linkage |
| `infrastructure/` | SQLite + Mongo adapters; Haiku report summarizer adapter; STATE/NPC render in `server/render/` |
| `composition/` | Wire ports only here |
| **Not** | New logic in `lib/`; no subworld SQL from hub repositories beyond ids for report generation orchestration |

**Report generation I/O:** application use case loads bounded subworld snapshot via existing ports (`turns.recentTurns`, dossier, world name), writes a deterministic stub through `simRuns.upsertByRun`, then optionally calls summarizer port and upserts the enriched compact service result.

**Close entrypoints:** both current close paths must call the same idempotent close operation:

- narrator `onFinish` when `detectSubworldExit` fires with `exitKind` and the closing narrator `sourceTurnId`
- play-page dead-player recovery when the authoritative player row is already `dead` on load

The second path may not have a fresh closing turn id; pass `sourceTurnId: null` and `exitKind: 'death'`.

---

## Phased delivery

### Phase 0 — Spec lock & characterization

- [ ] Confirm console place strategy: v1 treats the entire `simulationRoomKey` place as console-capable post-awaken. Defer room/furniture tags until a later UI/schema pass.
- [ ] List clearance defaults per ensemble slot in archetype seed.
- [ ] Document leak-surface: reports never appear in inspect payloads while concealed; post-awaken inspector may show **index** only (optional)—full bodies stay play-diegetic unless we explicitly add inspector later (**v1: no full reports in inspector**).
- [ ] Lock report close semantics: one `CloseSubworldAndReturn` use case, unique `(hub_world_id, subworld_id)`, deterministic stub written synchronously, optional background enrichment.
- [ ] Lock clearance storage: first-class `characters.clearance_level` (recommended) vs explicitly projected traits JSON. If deviating from first-class field, document the exact read/write port changes.

**Exit:** decisions recorded in this doc’s Decision log.

---

### Phase 1 — SimRunReport persistence + build on exit

**Bar:** exiting Sequence Vigil writes one compacted report on Meridian.

**Steps:**

1. Entity + Zod (contracts if cross-package) + `SimRunRepository` port.
2. Migration / Mongo model: `sim_run_reports` with unique index on `(hub_world_id, subworld_id)` / `(hubWorldId, subworldId)`.
3. Pure caps + `filterReportsForClearance`.
4. `SummarizeSimRun` port + Haiku adapter (bounded input).
5. Add `CloseSubworldAndReturn({ session, subworldId, exitKind, sourceTurnId })`:
   - writes deterministic stub → calls existing `returnToHub` → schedules optional summarizer enrichment
   - `exitKind` comes from `detectSubworldExit` in narrator `onFinish`, or from authoritative dead-player recovery in the play page
   - upserts report (`minClearance` default `operator` or `classified` for anomaly-heavy runs)
6. Tests: caps enforced; return-to-hub creates row; duplicate close does not duplicate; LLM failure still leaves deterministic stub; play-page recovery path can pass `sourceTurnId: null`.

**Exit:** unit + use-case tests green; manual exit produces exactly one report in DB. SQLite migration applies cleanly on boot; Mongo model/index exists and `npm run test:mongo` covers the new adapter.

---

### Phase 2 — Clearance + console injection (narrator / STATE)

**Bar:** hub ambient turns do not burn tokens on full logs; console (sim room) + clearance shows compacted body.

**Steps:**

1. Add/project `characters.clearance_level` (or explicitly projected equivalent) on SQLite + Mongo + domain entity; seed/default hub ensemble; antagonist → `antagonist`.
2. Pure `shouldInjectSimLogs` + `selectReportSliceForClearance` + index vs body selection.
3. Hub narrator context assembly (`getNarratorWorldState` / state-block render):
   - always (post-awaken, hub): optional **Simulation index** (codenames + status)
   - if console gate: **Log pull** section with 1 report filtered by **player** clearance (player is reading over shoulder / using console)
4. When a **high-clearance NPC is present** and console gate is true, NPC agent context gets the same filtered body for *their* clearance (antagonist sees more than public_crew), but never in a mixed-clearance shared prompt unless the whole prompt is filtered to the lowest clearance in the batch.
5. Prompt line (narrator): staff only recite log facts present in STATE; no inventing Vigil details not in index/body.
6. Tests: ambient = index only; console + low clearance = headline; console + classified = full compact body; subworld turns never appear; mixed low/high NPC-agent batch cannot leak classified text to low-clearance NPCs.

**Exit:** browser: post-awaken in sim room, “pull up Sequence Vigil” yields summary consistent with report; mess-hall turn does not include full body.

---

### Phase 3 — Operational hub antagonist + PlayerModel

**Bar:** bible antagonist is a real NPC who can use logs and update a model of the player.

**Steps:**

1. `linkAntagonistCharacter(hub, bible)` at hub seed or lazy first hub scene: match/create character, set clearance + agency + durable NPC fields from bible `antagonist` string.
2. `PlayerModel` store (hub metadata or small table); pure render + caps.
3. Post-report (and optionally after hub scenes where antagonist is present): light extract or deterministic heuristics to refresh PlayerModel from report outcomes + recent hub player lines (keep cheap).
4. NPC agent / guidance: when antagonist is present, inject PlayerModel + log **index**; body only on console gate.
5. Tests: linkage idempotent; model caps; antagonist clearance filters.

**Exit:** antagonist present in hub roster with clearance; after one Vigil run, model non-empty and antagonist can reference a **report-backed** fact in console scene.

**Antagonist linkage rule:** `MetaStoryBible.antagonist` is currently prose, not a stable id. The linker must be idempotent and bounded:

- First try exact/case-insensitive existing hub character name if the bible string yields a clear proper name.
- Else choose a single senior/role-compatible hub NPC deterministically and stamp an `antagonist_link` marker through the chosen storage path.
- Else create one hub NPC once.
- Store the linked `characterId` in a durable hub-scoped location (`PlayerModel`, dedicated antagonist link repo, or explicit world metadata port), not by re-parsing the prose every turn.

---

### Phase 4 — InfluencePacket into new subworlds

**Bar:** next sim after Vigil carries antagonist pressure (vessel and/or tags).

**Steps:**

1. Pure `buildInfluencePacket({ bible, playerModel, recentReports, seed })`.
2. Persist packet on enter (`EnterSubworld` or subworld `setting_details` / metadata).
3. Sim opening / STATE: vessel seed + pressure tags; keep bleed motifs via existing `selectBleedThreads`.
4. Do **not** write sim turns back to hub except via Phase 1 reports on exit.
5. Tests: packet caps; enter attaches packet; no hub←sim turn bleed.

**Exit:** second historical run shows a vessel or pressure consistent with prior report (playtest).

---

### Phase 5 — Polish & product edges (optional same release)

- [ ] Player clearance progression (earned operator access).
- [ ] Multi-report console UI line: “list protocols” → index; “open Sequence Vigil” → body.
- [ ] Ongoing runs: hub index shows `ongoing` without full body until close.
- [ ] Inspector: post-awaken **index only** for testers (still no raw subworld dumps).
- [ ] Telemetry: report token estimates, console inject rate.

---

## PR strategy

| PR | Scope |
|----|--------|
| **PR1** | Phase 1 — reports + return-to-hub write |
| **PR2** | Phase 2 — clearance storage + console STATE injection |
| **PR3** | Phase 3 — antagonist link + PlayerModel |
| **PR4** | Phase 4 — InfluencePacket on enter |

Each PR: `depcruise`, `type-check`, `npm test` (+ `test:mongo` if persistence touched).

---

## Non-goals

- Sharing raw subworld `turns` with hub prompts  
- Real-time hub surveillance of a live sim (status bit only if ever needed)  
- Second playable protagonist / swapping `is_player` to the antagonist  
- Full inspector dump of classified reports pre-awaken  
- Replacing Meta-Story Bible generation  
- Two-way bleed of hub cast into sim inspector  
- Putting classified log bodies into a shared NPC-agent prompt that includes low-clearance NPCs  

---

## Test plan

```bash
npm run depcruise
npm run type-check
npm test
npm run test:mongo   # when SimRunRepository / migrations land
```

**Manual (SIM_HUB playthrough):**

1. Play/exit a sim (e.g. death → awakening into hub sim room).  
2. Confirm exactly one report row for that codename/subworld after refresh/reload.  
3. Ambient hub location: narrator does not dump full Vigil summary.  
4. At console / sim room: player with clearance sees compacted log; ask a low-clearance NPC—they only know the headline or refuse.  
5. Antagonist (if present) can cite anomalies from the report.  
6. Enter a new sim: influence vessel or pressure tag observable once.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Token creep | Hard caps; ambient index only; one body per console pull |
| Narrator invents logs | Prompt rule + empty index ⇒ “no record” |
| Clearance ignored by LLM | Only inject allowed slices; don’t put classified text in context for low-clearance turns |
| Antagonist railroads every sim | One packet at entry; limited pressure tags; player agency unchanged |
| Concealment leak | Reports hub-scoped; inspect filtered until awoken; no parent/sim ids in client pre-awaken |
| Summarizer quality | Caps + deterministic fallback; don’t block exit on LLM failure |
| Console false positives | Precision-biased intent regex; v1 requires hub simulation-room capability for body injection |
| Duplicate reports from multiple return paths | Unique `(hub_world_id, subworld_id)` + `upsertByRun`; all return paths call one close use case |
| Clearance field invisible to render/domain | First-class projected `clearance_level` across SQLite, Mongo, entity, and ports |
| Classified body leaks in shared NPC prompt | Split by clearance or filter shared prompt to lowest clearance; add mixed-clearance test |
| Report enrichment delays stream completion | Deterministic stub now, background enrichment later |

---

## Decision log

| Decision | Choice | Why |
|----------|--------|-----|
| Knowledge direction | Reports hub←sim (intel); influence + bleed hub→sim (control) | Matches facility fiction; preserves sim autonomy |
| Log shape | Compact `SimRunReport`, not shared turns | Token + architecture |
| Access UX | **Console / sim-room gate** for bodies; ambient **index only** | Diegetic + budget |
| Bad guy | **Hub antagonist NPC**, not second protagonist | `is_player` stays the human |
| Antagonist intel | Highest clearance + PlayerModel | Anticipation without omniscience |
| v1 console place | Entire hub **simulation room** is console-capable | Fewer seed changes; refine tags later |
| Inspector | No full report bodies in v1 | Keep classified diegetic |
| Report identity | Numeric id + unique `(hub_world_id, subworld_id)` | Idempotent retries/reloads; codename stays display-only |
| Clearance storage | First-class `characters.clearance_level` | Existing traits JSON is not projected into domain/render paths |
| Report timing | Stub synchronously, enrich in background | Exit stays reliable; Haiku quality improves later |

---

## Implementation checklist

- [x] Phase 0 decisions (console place, clearance defaults)  
- [x] Phase 1 SimRunReport + repository + idempotent `CloseSubworldAndReturn`  
- [x] Phase 2 clearance storage + console injection + prompt rule  
- [x] Phase 3 antagonist linkage + PlayerModel  
- [x] Phase 4 InfluencePacket on EnterSubworld  
- [x] SQLite migration + Mongo model/index for every new persistence surface  
- [x] Mixed-clearance filtering via per-clearance slices (shared prompt uses player clearance; bodies never ambient)  
- [x] Concealment: pre-awaken no index/body inject (`shouldShowSimIndex` / `shouldInjectSimLogs`)  
- [ ] Gates + manual smoke  
- [x] MINOR version bump on feature branch: **0.9.0 → 0.10.0** (archive this plan when shipped)  

---

## Appendix — Example console STATE slice (illustrative)

**Ambient (mess hall), post-awaken:**

```text
## Simulation index (clearance-filtered)
- Sequence Vigil — death_exit — "Subject lost in third act; anomaly spike."
- Protocol Ashen — completed — "Objective recovered."
```

**Console pull (operator+), player: “Open Sequence Vigil”:**

```text
## Simulation log: Sequence Vigil
Status: death_exit
Summary: (≤600 chars compacted debrief)
Outcomes:
- …
Anomalies:
- Lucidity events near archive
POIs: …
```

Low-clearance present NPC receives only the index line for that codename in *their* agent context, not the body—unless the fiction is “reading over the player’s shoulder” (then use **player** clearance for shared screen, and note it in STATE as shared display).

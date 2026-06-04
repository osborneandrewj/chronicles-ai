# Chronicles AI — Complete System Design & Rebuild Specification

> **Purpose.** This document specifies the Chronicles AI engine in enough functional and technical
> detail to **rebuild it from scratch on a different architecture or stack**. It describes *what the
> system does and how it behaves* — the data model, the agents and their prompts, the exact turn
> pipeline, the deterministic algorithms, the API contracts, and the configuration — rather than
> prescribing a particular code organization. Where a behavior is load-bearing (a rebuild must
> replicate it to get the same product) it is marked **[ESSENTIAL]**; where a detail is an
> incidental implementation choice you are free to change, it is marked **[INCIDENTAL]**.
>
> It is written against the shipped system at **v0.6.21** (SQLite + raw `better-sqlite3`; Grok-4.3
> narrator + Claude Haiku 4.5 helpers; Next.js 15 App Router; Vercel AI SDK v5). A companion
> document, `hexagonal-architecture-blueprint.md`, proposes one *target* architecture; this document
> is architecture-neutral and is the source of truth for *behavior*.
>
> **Reading order.** §1 concepts → §2 data model → §3 agents (the LLM contracts) → §4 turn pipeline
> (the orchestration) → §5 context assembly (what the narrator sees) → §6 deterministic algorithms
> → §7 supporting subsystems → §8 HTTP API → §9 UI → §10 config/ops → §11 a suggested rebuild order.

---

## 1. Product & Domain Concepts

### 1.1 What it is

An **AI-powered, single-player interactive novel engine** with a persistent, structured world. The
player types free-text actions; a **Narrator** LLM streams second-person present-tense prose; behind
the scenes, factual LLM agents and deterministic systems extract and maintain structured world state
(characters, places, scenes, a story dossier, NPC cognition) so the world stays coherent and *alive*
across hundreds of turns. A side **Inspector** UI exposes that structured state and a player→archivist
**correction channel**. Narration can be read aloud via **TTS**.

The guiding design philosophy **[ESSENTIAL]**:

1. **The LLM does not remember.** The system, not the model, decides what context is injected each
   turn. Every LLM call is stateless.
2. **Separate creative from factual.** The Narrator (creative) writes prose; it is never the source
   of canon. The Archivist and classifiers (factual) extract canon; they never write drama.
3. **Authoritative state is structured and injected.** Time, location, identity, present cast,
   tactical pressure live in typed rows and are rendered into the prompt as ground truth the narrator
   may embellish but never contradict.
4. **The story log is append-only.** Player actions persist *before* streaming; narrator responses
   *after*. Turns are never edited or deleted; retries append.
5. **The world has momentum.** NPCs pursue goals, carry private cognition and charged memories
   ("reveries"), move between places over time, and act even when the player marks time.

### 1.2 Ubiquitous language

| Term | Meaning |
|---|---|
| **World** | A play instance / save. The root scope — everything else is `world_id`-scoped. Has a premise, an initial-state snapshot, a free-text world clock, a current scene cursor, and an optional real-world `setting_region`. |
| **Turn** | One append-only log entry: `role` is `user` (player action) or `assistant` (narrator prose). Carries a JSON `metadata` blob (per-agent model/usage/cost, classification, patches). |
| **Scene** | A bounded narrative unit with a place, a number, a status (`active`/`completed`), and prose pacing dials (`scene_mood`/`pace`/`focus`). Opened/closed by turn references. |
| **Place** | A named location with a `kind` and optional real-world geo anchor (OSM street/neighborhood/lat-lng + `geo_status`). |
| **Character** | The player (`is_player=1`, exactly one) or an NPC. Carries identity/description plus a large set of NPC-cognition fields (goals, focus, beliefs, agenda, relationship-to-player, reveries, journey state, daily loop, aliases, agency tier). |
| **Memorable fact** | Append-only one-sentence fact about a character, suffixed with `[t:N]` turn provenance. |
| **Observation** | Append-only sentence: what a *present NPC* noticed about the protagonist's off-pattern behavior. |
| **Story dossier** | The *playable pressure*: `story_threads` (quest/mystery/threat/relationship/background), `story_clues`, `story_objectives`, `story_resources`, `timeline_events`. |
| **NPC agency tier** | `npc` (passive, narrator-handled) → `local` (present, ticks every turn) → `nearby` → `distant` → `dormant`. Governs whether the NPC agent runs for them. |
| **Reverie** | A charged NPC memory with `match_tags` and `intensity`; "flares" deterministically when the current scene's tags overlap. Shapes behavior as subtext; invisible to prose. |
| **NPC intent** | A durable row recording an NPC's *planned action* before the narrator runs, later reconciled (`staged`/`modified`/`ignored`/`contradicted`) against the prose. |
| **Occupancy snapshot** | A deterministic, reproducible crowd/traffic/encounter-hook snapshot for the current place, regenerated per scene. |
| **Correction** | A player message sent *directly to the archivist* (not the narrator) to assert/fix canon; logged in `world_corrections`. |

---

## 2. Data Model [ESSENTIAL]

The schema is the backbone of a rebuild. Below is the **logical model** (storage-neutral), followed
by storage notes. The shipped system uses SQLite with integer autoincrement PKs and `TEXT`
timestamps (`datetime('now')`, UTC); a rebuild may use UUIDs/`TIMESTAMPTZ`/JSONB freely. All
child tables are `world_id`-scoped with `ON DELETE CASCADE` from `worlds`.

It was built across 25 incremental migrations; a rebuild can create the final shape directly. The
migration history is itself informative (it documents *why* each field exists) but is **[INCIDENTAL]**
to the end state.

### 2.1 `worlds`
| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `name` | text, not null | |
| `premise` | text, not null | The world bible / system premise injected into every narrator call. |
| `initial_state_json` | text, not null | Snapshot `{time, location, identity, playerName?}` captured at creation. |
| `world_time` | text, null | **Free-text** authoritative world clock (e.g. `"Day 1, morning"`, `"4:42 AM"`). Not a real timestamp. (Named `world_time`, *not* `current_time` — that bare identifier collides with the SQLite `CURRENT_TIME` keyword.) |
| `current_scene_id` | FK→scenes, null | The active scene cursor. |
| `setting_region` | text, null | Real-world `"City, State, Country"` for geocoding bias; null if fictional. |
| `archived_at` | text, null | Null = active; ISO string = soft-archived. |
| `created_at` | text | |

### 2.2 `turns` [ESSENTIAL — append-only]
| Column | Type | Notes |
|---|---|---|
| `id` | PK | Monotonic; also used as the global turn ordering. |
| `world_id` | FK, not null | |
| `role` | text, not null | `CHECK IN ('user','assistant')`. |
| `content` | text, not null | Player action text, or narrator prose. |
| `scene_id` | FK→scenes, null | Scene the turn belongs to. |
| `metadata` | text (JSON), null | Per-turn agent ledger — see §2.12. |
| `created_at` | text | |

Index: `(world_id, id)`. **Never updated except `metadata`** (cost/patch stamping). Per-world display
turn numbers are derived, not stored (see §6.7).

### 2.3 `characters` [ESSENTIAL — the richest entity]
Core identity: `id`, `world_id`, `name`, `description`, `is_player` (0/1), `current_place_id`
(FK→places, SET NULL), `status` (`active`/`inactive`/`dead`), `voice_id`, `created_at`, `updated_at`.
Unique index on `(world_id, lower(name))`.

Append-only text channels (newline-separated; `[t:N]` provenance where noted):
- `memorable_facts` — one fact/sentence per line, `[t:N]` suffix.
- `observations` — what present NPCs noticed about the protagonist, `[t:N]` suffix.
- `player_notes` — player-asserted canon from the correction channel (no provenance tags).
- `aliases` — alternate descriptors that resolve to this row.

Scene-immediate NPC state (overwritten):
- `active_goal`, `current_attitude` — short strings; null = cleared.

NPC agency & scheduling:
- `agency_level` — `npc`/`local`/`nearby`/`distant` (+ legacy `agent`); default `npc`.
- `appearance_count` — int, default 0 (drives auto-promotion).
- `last_seen_turn_id`, `last_agent_tick_turn_id` — for deterministic tick scheduling.

NPC cognition (narrator-visible, not player-visible):
- `personal_goals`, `private_beliefs`, `long_term_agenda`, `tool_access` — multi-line, overwritten.
- `relationship_to_player` — one compact relationship anchor.
- `current_focus`, `recent_activity` — present mental state / off-scene activity log.
- `daily_loop` — JSON time-banded routine `{morning?,midday?,evening?,night?: {activity, place?}}`.

NPC journey state (no teleporting):
- `in_transit_to_place_id` (FK, SET NULL), `arrival_world_time` (free-text ETA),
  `last_known_situation` (present-tense physical snapshot).

`reveries` (legacy text column) — **dormant** since v0.6.18; reveries now live in `npc_reveries`.

### 2.4 `places`
`id`, `world_id`, `name`, `description`, `kind`, `player_notes`, `created_at`, `updated_at`. Unique
`(world_id, lower(name))`. Real-world geo anchor: `osm_display_name`, `osm_street`,
`osm_neighborhood`, `osm_lat`, `osm_lng`, `geo_status` (`unresolved`/`ok`/… default `unresolved`),
`geo_resolved_at`.

### 2.5 `scenes`
`id`, `world_id`, `place_id` (FK, SET NULL), `title`, `summary`, `scene_number` (unique per world),
`status` (`active`/`completed`), `opened_at_turn`/`closed_at_turn` (FK→turns), `created_at`,
`updated_at`. Prose dials (all CHECK-constrained, nullable): `scene_mood`
(`atmospheric`/`tense`/`violent`/`intimate`/`wondrous`), `pace` (`slow`/`medium`/`fast`), `focus`
(`environment`/`characters`/`action`/`internal`).

### 2.6 Story dossier
- `story_threads` — `title` (unique per world), `kind` (`quest`/`mystery`/`threat`/`relationship`/`background`, default `mystery`), `status` (`active`/`resolved`/`failed`/`dormant`), `summary`, `stakes`, `rewards`, `consequences`, `hidden` (narrator-visible pressure), `relevance_tags_json` (string[] for place/topic matching), `source_turn_id`, `resolved_turn_id`.
- `story_clues` — `title` (unique per world), `thread_id` (FK, SET NULL), `detail`, `implication`, `status` (`open`/`interpreted`/`spent`/`false_lead`).
- `story_objectives` — `title` (unique per world), `thread_id`, `status` (`active`/`blocked`/`completed`/`failed`), `detail`, `blocker`, `completed_turn_id`.
- `story_resources` — `name` (unique per world), `owner_character_id` (FK, SET NULL), `kind`, `status`, `detail`.
- `timeline_events` — `title`, `summary` (not null), `importance` (int 1–5, CHECK, default 3; only ≥3 are kept), `world_time`, `thread_id`, `turn_id`.

### 2.7 `npc_intents` [ESSENTIAL — the plan/reconcile ledger]
`id`, `world_id`, `character_id`, `player_turn_id` (FK), `narrator_turn_id` (FK, null until
reconciled), `agency_level`, `intent_text`, `planned_action`, `intent_type`, `target_character_id`,
`target_place_id`, `private_rationale`, `expected_visibility` (`public`/`narrator`/`npc_private`/`narrator_blind`, default `narrator`), `narrator_disposition`
(`staged`/`modified`/`ignored`/`contradicted`, null until reconciled), `narrator_interpretation`,
`outcome_summary`, `resolved_outcome`, `reconciliation_confidence` (0–1), `archived_patch`,
timestamps. Partial index on pending rows (`narrator_turn_id IS NULL`).

### 2.8 `npc_reveries` [ESSENTIAL]
`id`, `world_id`, `character_id`, `text`, `match_tags` (CSV string, default `''`), `intensity`
(REAL 0–1, default 0.5), `is_cornerstone` (0/1, reserved), `created_turn_id`, `last_flared_turn_id`,
`created_at`. Cap of **3 per character** enforced by app + migration.

### 2.9 Living-place tables
- `place_profiles` — one per place: `profile_kind`, `capacity_min`/`capacity_max`, `typical_roles_json`, `open_hours_json`, `traffic_level` (`none`/`low`/`medium`/`high`/`surge`), `ambience_tags_json`, `match_tags_json`, `encounter_rules_json`. Unique `(world_id, place_id)`.
- `population_templates` — reusable occupant archetypes keyed by `place_profile_kind`: `role`, `label`, `description`, `behavior_tags_json`, `match_tags_json`, `seed_premise`, `promotable` (0/1), `weight`.
- `place_occupancy_snapshots` — append: `place_id`, `scene_id`, `source_turn_id`, `world_time`, `occupancy_json` (the rendered snapshot).

### 2.10 `world_corrections`
`id`, `world_id`, `turn_id` (FK, SET NULL — the turn it was pinned to), `player_text`,
`archivist_reply`, `applied_patch` (JSON), `created_at`. Index `(world_id, created_at DESC)`.

### 2.11 `tts_audio_cache`
`id`, `world_id`, `turn_id`, `model_key`, `voice_id`, `text_hash`, `content_type`, `audio` (BLOB),
`byte_length`, `created_at`, `accessed_at`. Unique `(world_id, turn_id, model_key, voice_id, text_hash)`.

### 2.12 `turns.metadata` JSON shape [ESSENTIAL — the cost & audit ledger]
Stamped incrementally during a turn (a JSON-merge/patch is used so later writes don't clobber
earlier ones). Keys: `narrator` `{model, usage, toolResults?}`, `classifier`
`{model, method, classification:{stance,input_mode}, usage, error?}`, `npc_agent`
`{model, usage, patch} | {model, error}`, `npc_promotion` `{promoted[], tiers{}}`,
`npc_intent_reconciler` `{model, usage, results[], error?, skipped?}`, `archivist`
`{model, usage?, patch?} | {model, skipped, reason} | {model, error}`, `tts` `{chars}`. `usage`
objects follow the AI SDK shape (`inputTokens`, `outputTokens`, cached variants).

---

## 3. The Agent System [ESSENTIAL]

Seven LLM touchpoints (4 built, plus designed-but-stubbed roles). Each is defined by **(model,
provider, temperature, prompt, output schema)**. Prompts ship as git-diffable `prompts/*.md` loaded
and cached at runtime. The full prompt texts are in `prompts/`; below are the contracts + the
load-bearing rules a rebuild must preserve.

### 3.1 Models & pricing
| Agent | Model ID | Provider | Streaming | Notes |
|---|---|---|---|---|
| Narrator | `grok-4.3` | xAI (`@ai-sdk/xai`) | yes | temp 0.8 implied; `maxDuration` 60s; tool-enabled; `stopWhen: stepCountIs(2)`. |
| Classifier | `claude-haiku-4-5-20251001` | Anthropic | no | `maxOutputTokens: 200`; heuristic-first. |
| NPC agent | `claude-haiku-4-5-20251001` | Anthropic | no | `maxRetries: 1`. |
| Intent reconciler | `claude-haiku-4-5-20251001` | Anthropic | no | |
| Archivist | `claude-haiku-4-5-20251001` | Anthropic | no | `generateObject`. |
| World generator | `claude-haiku-4-5-20251001` | Anthropic | no | quick-start world seed. |
| Region extractor | `claude-haiku-4-5-20251001` | Anthropic | no | |

Pricing (USD per **million** tokens) used for cost accounting:
`claude-sonnet-4-6` {in 3, cachedIn 0.3, out 15} · `claude-haiku-4-5-20251001` {in 1, cachedIn 0.1,
out 5} · `grok-4.3` {in 1.25, cachedIn 0.2, out 2.5}. TTS: **4.2** per million characters.

> **[INCIDENTAL]** Exact model choices are swappable. The split that is **[ESSENTIAL]** is:
> a *strong creative streaming model* for the narrator, and *cheap fast structured-output models*
> for the factual helpers.

### 3.2 Narrator (creative, streaming)
- **Output:** plain prose only (no JSON). Second-person present tense.
- **Inputs:** system prompt (`narrator-system.md`) + compacted recent history + one trailing user
  message = premise block + STATE block + `CLASSIFICATION:` line + turn-guidance + `PLAYER ACTION:`.
- **Tools:** `map_route`, `place_lookup` (real-world geography; see §7.6).
- **Load-bearing prompt rules [ESSENTIAL]:** vary length dramatically by moment (1–5 sentences up to
  550–850+ words; opening turn 500–750 words); never restate the previous turn; time-transition
  phrases ("Two hours later") are one-time, never on consecutive turns; STATE is authoritative for
  time/location/present cast; stay inside the protagonist's perception (no omniscient off-scene
  facts); never present a menu of choices or end on a question to the player; never break the fourth
  wall; never narrate an NPC's reverie/private subtext onto the page (render as behavior only); each
  NPC knows only what it perceived; don't invent sexual orientation (default to ordinary case unless
  player/canon establishes otherwise); the world has momentum — act on idle turns with one intrusion
  at a time; treat `### NEARBY` ambient occupancy as texture (never a census); `possible encounters`
  are soft affordances, never quest markers, and never use mechanics vocabulary in prose; honor
  historical/setting fidelity (period units & tech).

### 3.3 Classifier (factual)
- **Output schema:** `{ stance: 'do'|'say'|'think'|'observe'|'meta', input_mode: 'in-character'|'ooc'|'ambiguous' }`.
- **Behavior [ESSENTIAL]:** a deterministic heuristic runs first (see §6.8); the LLM is called only
  when no rule matches. Result carries `method: 'heuristic'|'llm'|'fallback'`. Fallback on error is
  `{do, in-character}`. The scene digest (`PLACE` + `PRESENT NPCS`) is passed so a bare question
  with an NPC present classifies as `say`, alone as `observe`.

### 3.4 Archivist (factual) — the canon extractor
- **Output:** `ArchivistPatch` (all fields optional; empty patch is valid). The correction variant
  adds a required `reply` string.
- **`ArchivistPatch` schema [ESSENTIAL — this is the core contract]:**
  - `current_time?: string`
  - `scene?:` discriminated union on `action`: `{action:'keep_open'}` | `{action:'close', summary}` | `{action:'open', title, place_name}`
  - `scene_context?: { scene_mood?, pace?, focus? }` (same enums as §2.5)
  - `places?: [{ name, description?, kind?, player_notes_append? }]`
  - `characters?: [{ name, is_player?, description?, current_place_name?, memorable_facts_append?, status?, active_goal?:string|null, current_attitude?:string|null, observations_append?, player_notes_append?, aliases?:string[], reveals_name_of? }]`
  - `story_threads?: [{ title, kind?, status?, summary?, stakes?, rewards?, consequences?, hidden?, relevance_tags?:string[] }]`
  - `story_clues?: [{ title, thread_title?, detail?, implication?, status? }]`
  - `story_objectives?: [{ title, thread_title?, status?, detail?, blocker? }]`
  - `story_resources?: [{ name, owner_name?, kind?, status?, detail? }]`
  - `timeline_events?: [{ title, thread_title?, summary, importance?:1..5 }]`
- **Load-bearing extraction rules [ESSENTIAL]** (full text in `prompts/archivist-system.md`):
  preserve facts unless prose clearly changes them (empty patch when nothing changed); **story
  pressure must be dossier rows, not just facts**; time advances only when narration says so; the
  current scene/place is **sticky** (don't relocate on a mere mention; known places are reference,
  not location evidence); **canonical names** — resolve variants/titles/short forms to existing rows;
  descriptor drift → `aliases`, a revealed proper name → `reveals_name_of` on the existing row
  (never a duplicate); avoid transit/status pseudo-places; characters in three buckets
  (present-named, present-unnamed-but-recurring → descriptive name, mentioned-off-scene);
  **scene `open` is REQUIRED whenever the player's `current_place_name` changes**, and the player
  must move with the relocating cast; `memorable_facts_append` is append-only, ≤1/char/turn;
  `observations_append` is NPC-only, present-only, off-pattern-only; routine service workers stay
  incidental; never write `player_notes_append` from this channel (narrator-extraction path); no
  deletes (use `status`); promote `NEARBY PROMOTABLE OCCUPANTS` only on direct engagement.
- **Correction variant** (`archivist-correction.md`): player speaks *to the archivist*; writes
  `player_notes_append`; handles merges (`{name:<fuller form>, aliases:[<shorter>]}`) and status
  changes; never advances scene/time; returns a 1–2 sentence `reply`.

### 3.5 NPC agent (creative-adjacent, structured)
- **Output:** `{ npc_updates?: NpcUpdate[], planned_actions?: PlannedAction[] }`.
  - `NpcUpdate`: `name` + any of `current_focus`, `activity_append` (off-scene past-tense),
    `current_place_name`, `personal_goals`, `private_beliefs`, `reveries_add:[{text, match_tags[], intensity?}]`,
    `daily_loop`, `relationship_to_player`, `long_term_agenda`, `tool_access`,
    `in_transit_to:string|null`, `arrival_world_time:string|null`, `last_known_situation`.
  - `PlannedAction`: `npc_name`, `intent`, `planned_action`, `intent_type?`, `target_npc_name?`,
    `target_place_name?`, `private_rationale?`.
- **Load-bearing rules [ESSENTIAL]:** runs *before* the narrator; **one plan per present agent NPC,
  every turn** (unplanned present agents revert to narrator improvisation); off-scene NPCs get a
  single past-tense `activity_append`; author a `daily_loop` once; **no teleporting** (move via
  `in_transit_to` + `arrival_world_time`, advance `last_known_situation` each turn, arrive only when
  the clock catches up); reveries added rarely (cap 3, long cooldown), never restated; private
  beliefs may be wrong; plans react to `recent_plan_outcomes` (if the narrator keeps ignoring a plan,
  pick a different move); respect known real-world geography and setting/era fidelity.

### 3.6 Intent reconciler (factual)
- **Output:** `{ results: [{ intent_id, disposition:'staged'|'modified'|'ignored'|'contradicted', interpretation?, outcome_summary?, confidence?:0..1 }] }`.
- **Behavior:** runs *after* narrator prose; reads pending intents (`narrator_disposition IS NULL`)
  for the player turn; labels each against the prose; persists disposition/interpretation/outcome.
  Skips cleanly (`no_intents`/`no_pending`) when there's nothing to do.

### 3.7 World generator & region extractor (setup-time)
- **World generator** (`generateWorldFromGenre(genre, playerName?)`): output `{ name (2–5 words),
  premise (one vivid paragraph), location (first scene place), time (e.g. "Day 1, morning"),
  identity (1–2 sentences on the protagonist) }`. System prompt: a world designer that invents a
  fresh, specific, coherent opening; avoid clichés and brand names.
- **Region extractor** (`extractSettingRegion(premise, location)`): output
  `{ is_real_world: boolean, region: string|null }` → Nominatim-style `"City, State, Country"` or
  null if fictional.

### 3.8 Designed-but-not-built agents [INCIDENTAL to current product]
World Seeder, Wiki Compiler, World Linter, Character Actor, Story Conductor (currently a hardcoded
"proceed"), and the Living-World offscreen-advancement loop are specified in the older
`docs/specs/*` but not implemented at v0.6.21. A rebuild can ignore them for parity or implement them
behind the same turn-pipeline seams.

---

## 4. The Turn Pipeline [ESSENTIAL]

This is the single most important behavior to replicate. It is implemented today as one streaming
HTTP handler (`POST /api/chat?worldId=N`) but the *ordering and fail-modes* are what matter, not the
hosting. Two LLM calls are cheap/pre-stream (classifier, NPC agent), one is the streamed narrator,
and two are post-stream factual (reconciler, archivist).

### 4.1 Request & guards
1. Validate `worldId` (query param) and load the world (404 if missing).
2. Parse body `{ messages: UIMessage[] }`; extract the latest user message's text (400 if empty).
3. **Meta-command guard:** if the text is a slash meta-command (`/help`, `/inspect`, `/usage`,
   `/pause`), return a deterministic streamed text reply — **no LLM, no persistence** (§7.7).
4. **Idempotency / replay guard [ESSENTIAL]:** compare against the latest persisted user content and
   the latest assistant. If the same user text already has a completed assistant *and* the incoming
   history does **not** include that assistant, replay the persisted assistant verbatim (don't spend
   another cycle). Distinguish an *in-flight retry* (same text, no assistant yet → don't duplicate
   the user row) from an *intentional repeat* (same text, assistant present in history → allow).
5. **Daily cost cap [ESSENTIAL]:** if today's token sum ≥ the daily limit, return HTTP 429 with
   `{error:'daily_token_limit_reached', used, limit}` **before any LLM call**.

### 4.2 Pre-stream (synchronous; failures here are fail-closed except where noted)
6. Determine the active scene id.
7. **Persist the player turn** (`role='user'`, current scene) — unless it's an in-flight retry.
8. Read `priorState = getNarratorWorldState(worldId)` (before classifying, so the classifier sees
   who's present).
9. Capture `playerTurnId` (for `[t:N]` provenance on NPC activity).
10. **NPC attention update:** `recordAppearancesAndAutoPromote(world, presentCharacters, playerTurnId)`
    bumps appearance counts and re-tiers NPCs (§6.4).
11. **Classify** the action (heuristic-first; §3.3 / §6.8).
12. **Lazy geocoding (fail-open):** `resolveUnresolvedPlaces(worldId)` makes one Nominatim attempt
    per still-unresolved place; errors are logged and swallowed.
13. **NPC agent tick (fail-open) [ESSENTIAL gate]:** run only if `shouldTickNpcAgent(stance,
    input_mode, state)` — i.e. `input_mode==='in-character'`, stance ∉ {`meta`,`think`}, and either
    stance ∈ {`do`,`say`} or a present NPC is `local`/`nearby`. On any error, degrade to plan-less
    narration. Persists `npc_updates` and inserts `npc_intents` rows for each planned action.
14. **Occupancy snapshot (fail-open):** `buildPlaceOccupancySnapshot(worldId, playerTurnId)` (§6.2),
    persisted so the next state read picks it up.
15. Re-read `narratorState = getNarratorWorldState(worldId)` (to include the just-persisted snapshot).
16. **Reverie flares (pure):** collect scene tags, score reveries for present + off-scene NPCs, pick
    top-K, stamp `last_flared_turn_id` (§6.1).
17. **Assemble the narrator prompt** (§5): system = `NARRATOR_BASE`; messages = compacted history +
    one trailing user message (premise + STATE + classification line + turn guidance + player action).

### 4.3 Stream (the only thing the player waits on)
18. `streamText({ model: xai('grok-4.3'), messages, tools, stopWhen: stepCountIs(2) })` and pipe the
    UI message stream to the client. A trailing `message-metadata` part carrying the real DB
    `dbTurnId` is appended after the stream drains (the client keys TTS/cost on it).

### 4.4 Post-stream (`onFinish`; all fail-open — the turn already streamed)
19. If the text is empty, return (no turn persisted).
20. **Persist the narrator turn** (`role='assistant'`); record `narratorTurnId`.
21. **Stamp upfront metadata immediately** (narrator usage + classifier + npc_agent + promotion) so
    the cost footer is correct the instant the stream ends.
22. **Intent reconciliation** (if any plans): label `npc_intents` for this player turn against the
    prose; stamp results into metadata.
23. **Archivist gating [ESSENTIAL]:**
    - Compute a `deterministicPatch` from explicit travel keywords (§6.6).
    - `runArchivistLlm = hasRichStorySignal(player, narrator)` OR (no deterministic patch AND a
      travel verb appears).
    - If not running the LLM but a deterministic patch exists → apply it, stamp
      `model:'deterministic-archivist'`.
    - If not running and no patch → stamp `archivist:{skipped:true, reason:'no_state_change_signal'}`.
    - Else run `extractPatch(premise, priorState, recentTurns, occupancy, isCorrection=false,
      bootstrapDossier)` where `bootstrapDossier` is true when there are zero active threads and the
      turn has rich story signal (forces ≥1 thread). On success apply the patch and stamp it; on
      error stamp `{error}`. **Always non-blocking** — tracked so SIGTERM can await in-flight
      archivist calls (Railway sends SIGTERM ~10s before SIGKILL).
24. **Duplicate detection (log-only):** after applying a patch, log likely-duplicate character pairs
    (§6.5).

### 4.5 The two ordering invariants [ESSENTIAL]
- **Player action persists BEFORE the stream; narrator response AFTER.** This keeps the log
  append-only and consistent even if the stream dies mid-flight.
- **Everything factual (archivist, reconciliation, dedup) is POST-stream and fail-open.** The player
  is never blocked by extraction; a failed archivist call costs structured state, not the turn.

---

## 5. Context Assembly — What the Narrator Sees [ESSENTIAL]

The narrator prompt is assembled from a **system message** + **compacted history** + **one trailing
user message**. There is no token-counting budget enforcer in the shipped code (the documented 8K
assembler is aspirational); instead, history is bounded by turn count and content is truncated
field-by-field. A rebuild may add a real token budget, but must reproduce the *content and ordering*.

### 5.1 History compaction [ESSENTIAL]
- Load the last `NARRATOR_HISTORY_TURNS = 13` turns; the final one is the current action (handled
  separately), leaving 12 of prior history.
- Of those, the most recent `FULL_HISTORY_TURNS = 6` are included **verbatim** as role-tagged
  messages; older ones are **compacted** to `[Earlier narrator/player turn, compacted: <first 320
  chars>]`.

### 5.2 The trailing user message
Concatenation, in order:
```
<PREMISE block>

<STATE block>

CLASSIFICATION: stance=<stance>, input_mode=<input_mode>

<TURN GUIDANCE block>

PLAYER ACTION:
<player text>
```
- **PREMISE block:** `## PREMISE\n<world.premise>`.

### 5.3 The STATE block [ESSENTIAL — the authoritative-state rendering]
Built by `formatStateBlock(state, plannedActions, recentNarratorProse, reveries)`. Section order and
headers (verbatim) a rebuild should reproduce:

```
## STATE
<3 fixed preamble lines: facts are fixed / Place line is physical location / Time line is the clock>
- Time: <world_time ?? '(unset)'>
- Scene: <title> (scene <n>)            [+ "- pacing: …" if set]
- Place: <name>\n  <description>         [suppressed if recent prose clearly travelled elsewhere]
  - real-world geo: <street/neighborhood>   [if resolved]

### Present
- <name> (<role>) — <desc≤180>
  [player]   - continuity: preserve location/items/injuries/obligations…
             - <last 3 memorable_facts, one per line>
  [npc]      - personal goal(s) / agenda / relationship to protagonist / private read /
               ⚡ FLARING SUBTEXT / private subtext / diegetic tools / focus / goal / attitude /
               activity (last 2) / behavior cue (last 2)        [each present only if set, truncated]

### NEARBY (ambient — not durable characters)       [from occupancy snapshot]
- density: <density>
- <group label> — <behavior>[ (could become someone)]
- traffic: vehicles <n>, pedestrians <n>[; <motion>]
- possible encounters (latent — surface only if the protagonist engages; never as a quest marker):
  - <hook narrator_cue>

### KNOWN PLACES (real-world geography — authoritative)
- <place> — <geo>                                   [only places with geo_status='ok']

### OFF-SCENE NPCs (tracked — do not contradict)
- <name at where>[ → <dest> (ETA <time>)]
  - situation: <last_known_situation> / last activity: <…> / routine: <activity for time band>

### PLANNED MOVES THIS TURN (agent NPCs)
- **<npc>** — <planned_action ?? intent>            [+ "- intent: …" if both differ]

## PLAYER CANON                                       [player_notes if any]

## STORY DOSSIER
<preamble: playable pressure, not exposition; hidden pressure can move the world but not be blurted>
### ACTIVE QUESTS / ACTIVE THREADS / CURRENT OBJECTIVES / CLUES / RESOURCES / RECENT TIMELINE
  (sliced: 4 quests, 4 threads, 5 objectives, 6 clues, 6 resources, 5 timeline; timeline importance≥3)
```

Special markers the narrator prompt depends on **[ESSENTIAL]**:
- `⚡ FLARING SUBTEXT (private; render ONLY as a physical tell, hesitation, misread, or charged
  choice this turn — never name, quote, paraphrase, or describe it on the page): <text>`
- `private read (known only to <NPC>; never let another NPC act on it): <belief>`
- `private subtext (… color tone and choices only, never state on the page): <text>`

### 5.4 Turn guidance [ESSENTIAL behaviorally]
`formatNarratorTurnGuidance(...)` emits a `## TURN GUIDANCE` block that adapts to the turn:
- For OOC/meta: "Brief reply in the narrator voice — keep the fiction in place; do not advance."
- Otherwise a beat cue chosen from the situation (recognition / spectacle / confrontation /
  danger-transition / media-feed / investigative / observe-only / dialogue), plus: a time-check line
  (echo the exact clock) for time-check moves; an investigative "internal pressure only — do not name
  these…" line listing objective/clue hints; a continuity nudge; a momentum cue when the player has
  been idle ≥ 2 turns ("the world acts…"); and "Leave at least one branch the player can pursue."

### 5.5 Scene digest for the classifier
`formatSceneDigestForClassifier(state)` → `PLACE: <name>` + `PRESENT NPCS: <names | "(none — the
protagonist is alone)">`.

---

## 6. Deterministic Algorithms [ESSENTIAL — reproduce exactly]

These are pure, non-LLM systems. Reproducing them is what makes the rebuild *behave the same*. All
are deterministic given their inputs (the occupancy sim is seeded so the same place/scene reproduces
the same crowd).

### 6.1 Reverie flaring
Constants: `MAX_REVERIES_PER_NPC = 3`, `REVERIE_COOLDOWN_TURNS = 15`, per-turn flare cap = 2.
- `canMintReverie`: true if the NPC has no reveries OR `playerTurnsSinceLast >= cooldown`.
- `computeReverieFlares(candidates, sceneTags, {presentCharacterIds, perTurnCap=2})`:
  1. Normalize tags (`trim().toLowerCase().replace(/\s+/g,' ')`).
  2. For each candidate, `overlap = |match_tags ∩ sceneTags|`; skip if 0; `score = overlap × intensity`.
  3. Keep the single highest per `character_id`; ties broken by higher `intensity`, then lower `id`.
  4. Global sort: present characters first, then `score` desc, then `id` asc. Return top `perTurnCap` ids.
- `match_tags` stored as CSV; pruning keeps top 3 by `intensity desc, last_flared_turn_id desc
  (null=-1), id desc`.

### 6.2 Occupancy simulation (deterministic crowds)
- **PRNG:** `mulberry32(hashSeed(seedKey))` where `hashSeed` is a cyrb53-lite 32-bit hash and
  `seedKey = "w:<worldId>|p:<placeId>|s:<sceneId>"` → same place+scene ⇒ identical crowd.
- **Profile inference:** `classifyPlaceKind(name)` maps keywords to a kind
  (bar/restaurant/cafe/hospital/office/market/road/transit/park) via an alias table; falls back to a
  default profile (capacity, traffic level, match tags).
- **Snapshot build:** reuse the latest snapshot if the scene is unchanged; else pick weighted
  population templates until a traffic-derived target count (or 6 groups) is reached; plural labels
  get a random 1–3 count, singular ("a/an/the …") get 1. Output `PlaceOccupancy {density, seed,
  groups[], traffic?, encounter_hooks[]}`.
- **Encounter hooks:** *continuation* hooks score active threads by tag overlap with the place's
  match tags + a promotable occupant's tags (`score = overlap(thread, place) + overlap(thread,
  carrier)`), sorted by score then thread id, capped at 3, strength `strong` if score ≥ 2 else
  `ambient`; if none, a *seed* hook is drawn from a random promotable occupant with a `seed_premise`.

### 6.3 World time bands
`WorldTimeBand ∈ {morning, midday, evening, night}`. Parse a free-text clock: a clock regex
(requires `:mm` or am/pm to avoid matching "Day 3") → hour with 12h correction → band by hour
(`5–10`=morning, `11–16`=midday, `17–20`=evening, else night). Fallback keyword scan
(dawn/noon/dusk/night families); default `midday`.

### 6.4 NPC promotion ladder
`AUTO_PROMOTE_THRESHOLD = 3`. Per turn: bump `appearance_count` for each eligible present NPC; when
it reaches 3 and tier is `npc`, promote to `local`; present NPCs are set to `local`. Offscreen NPCs
re-tier by turn gap `turnsAway = currentTurn − last_seen` (∞ if never): `≤3`→nearby, `≤10`→distant,
`≤20` (or `≤40` if it has an open thread: any of active_goal/personal_goals/current_focus)→dormant,
else demote to `npc`. Transient service NPCs (regex on name/desc for courier/cashier/etc.) with no
durable signal are demoted/kept passive.

### 6.5 Character dedup (log-only signal)
For non-player, non-dead pairs, flag as likely-duplicate if: (a) same `current_place_id` and one name
is a descriptor while the other isn't; (b) near-identical normalized name (`nameKey` lowercases,
strips punctuation and stop-words the/a/an/of/and); (c) a shared distinctive memorable-fact line
(≥25 chars, provenance stripped).

### 6.6 Deterministic archivist patch (no-LLM fast path)
Fires when the player text explicitly states a destination ("go/walk/run/drive/head/return to X",
"enter X"), the destination differs from the current place, and the narrator prose accepts it
(mentions the place + a motion/arrival verb). Emits a minimal `{places, characters(player move),
scene:{action:'open'}}` patch; else null.

### 6.7 Provenance & turn numbers
- Memorable facts / observations: appended as `"<text> [t:<turnId>]"`, newline-joined; `[t:N]`
  stripped for display.
- Per-world display turn numbers are derived by ranking the world's turn ids (not stored).

### 6.8 Classifier heuristics (pre-LLM)
In order, first match wins → else LLM:
1. **meta/ooc** if text contains `ooc|out of character|meta`, system words (`what/which model`,
   `system prompt|token|usage|cost|debug|ui|interface|app`), save/load patterns, or recap words.
2. **say/in-character** if it starts with a quote or contains speech verbs (say/ask/tell/reply/…).
3. **think/in-character** for think/remember/wonder/realize/feel/consider/decide.
4. **observe/in-character** for look/listen/watch/examine/inspect/scan/study/read/check/search/google.
5. **do/in-character** for go/walk/run/drive/open/take/… (movement/manipulation verbs).
6. **bare question** ending in `?` → `say` if NPCs present, else `observe`.
7. **short imperative** (1–3 words) → `do`.

### 6.9 Story-signal heuristic
`hasRichStorySignal` returns true if the combined player+narrator text matches any of: character
introduction words, time-passage words, action/change words (dies/wounded/takes/gives/learns/…),
clue/discovery words, communication words (call/text/email/…), or a quoted dialogue span
(`["“][^"”]{2,}["”]`). Gates whether the archivist LLM runs and whether dossier bootstrap fires.

---

## 7. Supporting Subsystems

### 7.1 World creation & seeding [ESSENTIAL]
`createWorld({name, premise, initialState:{time, location, identity, playerName?}})` seeds, in one
unit: the world row, **one place** (name derived from `location` head clause, kind via
`classifyPlaceKind`), **one player character** (`is_player=1`, identity = `initialState.identity`,
placed at the seed place), and **scene 1** (`status='active'`), then sets the world cursor
(`world_time`, `current_scene_id`). Two creation entry points:
- **Full form** (`createWorldAction`): explicit name/premise/location/time/identity.
- **Quick start** (`createBasicWorldAction`): pick a genre (from a 43-entry `GENRES` list) →
  `generateWorldFromGenre` synthesizes the fields.
Both then run `setSettingRegionForWorld` (region extraction) and `generateOpeningTurn`, and redirect
to the play page.

### 7.2 Opening turn
`generateOpeningTurn(worldId, premise)`: call the narrator with `NARRATOR_BASE` + premise + STATE +
an `OPENING TURN:` directive (no player input; 500–750 word rich opening), persist the assistant
turn, then run the archivist with an opening flag (forces dossier/place-kind bootstrap).

### 7.3 Geocoding (best-effort, real-world anchoring)
Places start `geo_status='unresolved'`. `resolveUnresolvedPlaces` makes one Nominatim attempt per
place (biased by `worlds.setting_region`), caches `osm_*` fields, sets `geo_status`. Bounded
parallelism + per-call timeout; always fail-open.

### 7.4 NPC journey state
Off-scene NPCs move across turns without teleporting via `in_transit_to_place_id` +
`arrival_world_time` + `last_known_situation` (§3.5, §2.3). The narrator reads these to stage phone
calls / off-scene references accurately.

### 7.5 Cost, pricing, budget [ESSENTIAL for parity]
- `costForUsage(model, usage)` and `costForTts(chars)` price calls from §3.1's table.
- `summarizeTurn(id, metadata)` aggregates per-agent `AgentCost {model, inputTokens, outputTokens,
  cachedInputTokens, cost}` from `turns.metadata` (narrator/archivist[legacy `extractor`]/classifier/
  npc_agent/tts) into a `TurnCost {…, total}`.
- Daily cap: `DEFAULT_DAILY_TOKEN_LIMIT = 200_000` (env `DAILY_TOKEN_LIMIT`); `todaysTokens()` sums
  all agent tokens from turns created today (UTC). Checked pre-stream → HTTP 429.

### 7.6 Narrator tools (real-world geography)
- `map_route({origin, destination, mode?})` → route facts (status/provider/summary/durationMinutes?/
  distanceKm?/routeHints?/caveats[]), OSRM-backed.
- `place_lookup({query, region?})` → place facts (displayName/street/neighborhood/city/lat/lng/
  caveats[]), Nominatim-backed.
Used so the narrator never invents addresses; `stopWhen: stepCountIs(2)` allows one tool round-trip.

### 7.7 Meta-commands (deterministic, no LLM)
`/help` (list commands), `/inspect` (dump `getFullWorldState` JSON), `/usage` (token totals + latest
turn metadata), `/pause` (in-fiction pause, no state change). Detected before the pipeline; returned
as a streamed text response.

### 7.8 TTS & audio caching
xAI TTS (`https://api.x.ai/v1/tts`, model key `xai-tts-mp3-v1`, default voice `eve`, speed 0.7–1.5,
mp3). `POST /api/tts` (with `?warm=1` → 204 prewarm): cache key `(worldId, turnId, model_key,
voice_id, sha256(text))`; L1 = DB lookup before synth (`X-TTS-Cache: HIT`), on miss synthesize and
tee to background cache; L2 retention keeps only the newest **2** distinct turns per world. Text
capped at 12000 chars. `POST /api/tts/record` accumulates synthesized char counts onto
`turns.metadata.$.tts.chars` for billing.

---

## 8. HTTP API Contracts [ESSENTIAL surface]

| Route | Method | Input | Output | Notes |
|---|---|---|---|---|
| `/api/chat?worldId` | POST | `{messages: UIMessage[]}` | SSE UI-message stream (+ trailing `message-metadata {dbTurnId}`) | The turn pipeline (§4). 400/404/429. |
| `/api/turns?worldId&before&limit` | GET | query (limit default 60, max 200) | `{turns: Turn[] (old→new), usage: TurnCost[], hasMore}` | History pagination ("Load older"). |
| `/api/usage?worldId` | GET | query | `{turns: TurnCost[], total}` | All-time per-turn cost. |
| `/api/world-state?worldId` | GET | query | `FullWorldState` | Inspector full state. |
| `/api/world-correction?worldId` | POST | `{worldId, text(1–2000)}` | `{id, reply, appliedPatch, createdAt}` | Correction channel → archivist; applies patch, logs row, stamps cost on latest turn. 400/404/502. |
| `/api/world-corrections?worldId&limit` | GET | query (limit default 50, 1–200) | `{corrections: [{id, turnId, playerText, archivistReply, createdAt}]}` | Inspector Archivist scrollback. |
| `/api/tts?worldId` | POST | `{text, voice?, worldId?, turnId?}` or `?warm=1` | audio stream (+ cache headers) or 204 | §7.8. |
| `/api/tts/record?worldId` | POST | `{turnId, chars}` | 204 | TTS char metering. |

World creation/archival are **Server Actions** (not REST): `createWorldAction`,
`createBasicWorldAction`, archive/unarchive.

---

## 9. UI Surfaces

- **Pages:** `/` (world list, active + archived), `/worlds/new` (full form + quick-start genre
  tabs), `/worlds/[worldId]/play` (server-rendered initial hydration of messages/usage, then the
  Chat client component).
- **`Chat`:** message list (old→new, autoscroll), input with a slash-command menu, "Load older"
  pagination, an inspector toggle, and TTS playback. Calls `/api/chat` (streaming transport),
  `/api/turns`, `/api/usage` (refetched ~2s after a turn so the archivist patch has committed),
  `/api/world-state`.
- **`WorldInspector`:** a drawer with four tabs — **Now** (scene/place/present cast), **Story**
  (quests/threads/objectives/clues/resources), **Wiki** (all characters/places/scenes, accordioned),
  **Archivist** (correction scrollback + a box to submit a new correction). Calls `/api/world-state`,
  `/api/world-corrections`, `/api/world-correction`. Uses an AbortController to guard stale responses.

> UI specifics are largely **[INCIDENTAL]**; the **[ESSENTIAL]** surfaces are: a streaming chat, a
> structured-state inspector, and a correction channel.

---

## 10. Configuration & Operations

- **Runtime/stack (shipped):** Next.js 15 App Router, React 19, TypeScript, Vercel AI SDK v5
  (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/xai`), `better-sqlite3`, `zod`. Node runtime; chat route
  `maxDuration = 60`.
- **DB:** `better-sqlite3` at `DATABASE_PATH ?? <cwd>/chronicles.sqlite`; `:memory:` during Next
  build and in tests; pragmas `journal_mode=WAL`, `foreign_keys=ON`; `runMigrations` on open
  (idempotent, `user_version`-gated, FK disabled around the run for rebuild-style migrations).
- **Env vars:** `XAI_API_KEY` (narrator + TTS), `ANTHROPIC_API_KEY` (helpers), optional
  `DATABASE_PATH`, `DAILY_TOKEN_LIMIT` (default 200000), `TTS_VOICE` (default `eve`), `TTS_SPEED`.
- **Scripts (`scripts/*.mjs`):** `copy-world`/`clone-world-fresh` (export/import a world with PK/FK
  remap), `opening-turn`, `seed-andy`/`seed-joe` fixtures, `merge-characters`, `backfill-setting-
  region`, world-12 repairs. These define operational boundaries (world is the unit of
  export/repair) — **[INCIDENTAL]** to a rebuild but useful as parity tests.
- **Tests:** Vitest, `tests/**/*.test.ts`, in-memory DB, "seed a world then assert" pattern. Heaviest
  coverage on the archivist patch apply, migrations, npc-agent, reveries, dossier, world-time,
  occupancy, dedup — i.e. the deterministic seams of §6.
- **Deploy (shipped):** Railway, auto-deploy from `main`, prod SQLite at `/data/chronicles.sqlite`,
  migrate-on-boot, SIGTERM grace to drain in-flight archivist calls.
- **Version signal [ESSENTIAL discipline]:** `package.json` version is rendered in the app header as
  the only at-a-glance "what's running" trust signal; bump it on the release branch, in both
  `package.json` and `package-lock.json`, and restart (Next does not HMR JSON imports).

---

## 11. Suggested Rebuild Order

A dependency-ordered path to reach feature parity on any stack:

1. **Persistence + worlds + turns + the streaming chat loop.** Get a narrator streaming against a
   premise with append-only turns and the idempotency/replay guard. (Schema §2.1–2.2, pipeline §4.1,
   §4.3, narrator §3.2, context §5.)
2. **Typed world state:** characters/places/scenes + `getNarratorWorldState` + the STATE block (§2.3–
   2.5, §5.3). The narrator now sees authoritative state.
3. **The Archivist + patch apply.** This is the hardest, highest-value piece: the `ArchivistPatch`
   schema, the extraction rules, and the *apply algorithm* (name resolution, alias/`reveals_name_of`
   merging, sticky scene, the scene-open-on-move invariant, dossier upserts). (§3.4, §2.6.)
4. **Classifier (heuristic-first) + turn guidance** (§3.3, §6.8, §5.4).
5. **Story dossier** end to end (extraction → STATE rendering → inspector) (§2.6, §5.3).
6. **Cost ledger + daily cap + usage API + inspector** (§2.12, §7.5, §8).
7. **NPC cognition & agency:** promotion ladder, the NPC agent, intents + reconciliation, journey
   state (§2.3, §2.7, §3.5–3.6, §6.4).
8. **Living place simulation:** profiles/templates + deterministic occupancy + encounter hooks +
   `### NEARBY` rendering (§2.9, §6.2, §5.3).
9. **Reveries:** table, minting cooldown, deterministic flaring, FLARING SUBTEXT rendering (§2.8,
   §6.1).
10. **Correction channel** + world-corrections log + inspector Archivist tab (§3.4, §2.10, §8).
11. **Real-world geography:** region extraction, geocoding, narrator map tools (§7.3, §7.6).
12. **TTS + caching**, meta-commands, quick-start world generation, world archiving (§7.7–7.8, §3.7).

At each step the **[ESSENTIAL]** behaviors above are the acceptance criteria; the stack, ORM, HTTP
framework, and UI toolkit are free to differ.

---

### Appendix A — Enum reference (verbatim)

| Domain | Enum | Values |
|---|---|---|
| turn role | | `user`, `assistant` |
| character status | | `active`, `inactive`, `dead` |
| agency level | | `npc`, `local`, `nearby`, `distant` (legacy `agent`) |
| classifier stance | | `do`, `say`, `think`, `observe`, `meta` |
| classifier input_mode | | `in-character`, `ooc`, `ambiguous` |
| scene action | | `keep_open`, `close`, `open` |
| scene_mood | | `atmospheric`, `tense`, `violent`, `intimate`, `wondrous` |
| pace | | `slow`, `medium`, `fast` |
| focus | | `environment`, `characters`, `action`, `internal` |
| thread kind | | `quest`, `mystery`, `threat`, `relationship`, `background` |
| thread status | | `active`, `resolved`, `failed`, `dormant` |
| clue status | | `open`, `interpreted`, `spent`, `false_lead` |
| objective status | | `active`, `blocked`, `completed`, `failed` |
| intent visibility | | `public`, `narrator`, `npc_private`, `narrator_blind` |
| intent disposition | | `staged`, `modified`, `ignored`, `contradicted` |
| traffic level | | `none`, `low`, `medium`, `high`, `surge` |
| place geo_status | | `unresolved`, `ok`, … |

### Appendix B — Tuning constants (reproduce for parity)

| Constant | Value | Where |
|---|---|---|
| `NARRATOR_HISTORY_TURNS` | 13 | history window |
| `FULL_HISTORY_TURNS` | 6 | verbatim vs compacted boundary |
| compaction excerpt | 320 chars | older-turn compaction |
| narrator `stopWhen` | `stepCountIs(2)` | one tool round-trip |
| `maxDuration` | 60s | chat route |
| `MAX_REVERIES_PER_NPC` | 3 | reveries |
| `REVERIE_COOLDOWN_TURNS` | 15 | reveries |
| reverie flare cap | 2 / turn | reveries |
| `AUTO_PROMOTE_THRESHOLD` | 3 appearances | promotion |
| promotion turn-gaps | 3 / 10 / 20 (40 w/ thread) | tiering |
| occupancy groups cap | 6 | occupancy |
| `MAX_HOOKS` | 3 | encounter hooks |
| classifier `maxOutputTokens` | 200 | classifier |
| `DEFAULT_DAILY_TOKEN_LIMIT` | 200000 | cost cap |
| TTS retention | 2 turns/world | tts cache |
| TTS text cap | 12000 chars | tts route |
| correction text cap | 2000 chars | correction route |
| `/api/turns` limit | 60 default, 200 max | pagination |
```

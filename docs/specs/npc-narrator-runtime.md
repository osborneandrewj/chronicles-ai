# Current Database and NPC/Narrator Design

**Status**: Current-state reference for this branch.
**Source of truth**: `src/lib/migrations.ts`, `src/lib/db.ts`, `src/lib/world-state.ts`, `src/lib/npc-agent.ts`, `src/app/api/chat/route.ts`.
**Schema level**: SQLite migration 19 on this branch.

This document describes the database architecture as it exists today and the runtime relationship between NPCs, the NPC agent, the narrator, and the archivist. The older target architecture in `02-database-design.md` remains useful for direction, but the code is authoritative for current behavior.

For the accepted v2 direction based on the combined design evaluation, see `29-v0.6.9-milestone.md`.

## Goals

The current architecture optimizes for four constraints:

1. Keep play turns append-only so the chat log can become the durable "book."
2. Keep world state typed enough for the narrator to receive compact, reliable context.
3. Let recurring NPCs develop independent state without making every walk-on expensive.
4. Separate creative prose generation from factual state extraction and correction.

## Storage Stack

The app uses SQLite through `better-sqlite3`.

- Runtime DB path comes from `DATABASE_PATH`; local dev falls back to `chronicles.sqlite` in the repo root.
- During Next production build page-data collection, the DB opens as `:memory:` to avoid build-worker locks against a mounted production volume.
- SQLite runs with WAL journal mode and foreign keys enabled.
- Migrations are code-owned in `src/lib/migrations.ts`; `runMigrations(db)` executes when the singleton DB opens.
- Access is raw prepared SQL in `src/lib/db.ts`, `src/lib/worlds.ts`, `src/lib/archivist.ts`, `src/lib/npc-agent.ts`, and related modules. There is no ORM in the current implementation.
- `turns.metadata` is a JSON text column patched with SQLite JSON functions so narrator, classifier, NPC agent, archivist, TTS, and promotion metadata can merge without clobbering each other.

## High-Level Entity Model

```text
worlds
  owns turns, characters, places, scenes, story dossier rows, corrections, TTS cache

places
  anchor scenes and character locations
  may cache real-world geography

scenes
  identify the current narrative container
  point to a place

characters
  include one player character plus NPCs
  carry durable identity, current location, social state, and agentic NPC cognition

turns
  append-only user and assistant prose
  carry per-turn model/cost/extraction metadata

story_threads / story_clues / story_objectives / story_resources / timeline_events
  story-shaped memory used to keep current pressure, clues, objectives, and resources visible

world_corrections
  inspector archivist scrollback and audit log for player-asserted canon

tts_audio_cache
  bounded replay cache for synthesized narration audio
```

## Current Tables

### `worlds`

`worlds` is the root aggregate.

Core fields:

- `id`
- `name`
- `premise`
- `initial_state_json`
- `world_time`
- `current_scene_id`
- `setting_region`
- `created_at`

`premise` is sent to the narrator and NPC agent as high-level context. `world_time` is the authoritative clock. `current_scene_id` points to the active scene used by the narrator state assembler. `setting_region` biases real-world place resolution.

### `turns`

`turns` is append-only story text.

Core fields:

- `id`
- `world_id`
- `role`: `user` or `assistant`
- `content`
- `metadata`
- `scene_id`
- `created_at`

The route persists the player action before the narrator call, then persists the assistant/narrator response after streaming completes. Metadata on assistant rows can include:

- `narrator`: model, usage, tool results
- `classifier`: stance and input-mode classification
- `npc_agent`: model, usage, patch, or error
- `npc_promotion`: tier changes
- `archivist`: extracted patch, usage, skip reason, or error
- `tts`: synthesized character count

The route has retry/idempotency logic: if the latest user text already has a persisted assistant response and the client is retrying, the existing assistant turn is replayed instead of spending another model call.

### `places`

`places` contains world-local location records.

Core fields:

- `id`
- `world_id`
- `name`
- `description`
- `kind`
- `player_notes`
- `osm_display_name`
- `osm_street`
- `osm_neighborhood`
- `osm_lat`
- `osm_lng`
- `geo_status`
- `geo_resolved_at`
- `created_at`
- `updated_at`

Places are upserted by the archivist and used by scenes, characters, NPC movement, narrator state, and real-world geography tools. `player_notes` is written by the correction channel and treated as player-asserted canon.

### `scenes`

`scenes` is the current narrative container.

Core fields:

- `id`
- `world_id`
- `place_id`
- `title`
- `summary`
- `scene_number`
- `status`: `active` or `completed`
- `opened_at_turn`
- `closed_at_turn`
- `created_at`
- `updated_at`

The world cursor points to the current scene. Scene opening and closing are driven by archivist patches after narrator prose establishes a transition.

### `characters`

`characters` stores both the protagonist and NPCs. There is one player character per world today.

Identity and public state:

- `id`
- `world_id`
- `name`
- `description`
- `aliases`
- `is_player`
- `current_place_id`
- `memorable_facts`
- `status`
- `player_notes`
- `created_at`
- `updated_at`

Scene/social state:

- `active_goal`
- `current_attitude`
- `observations`

Agentic NPC state:

- `agency_level`
- `appearance_count`
- `last_seen_turn_id`
- `last_agent_tick_turn_id`
- `personal_goals`
- `current_focus`
- `recent_activity`
- `private_beliefs`
- `reveries`
- `relationship_to_player`
- `long_term_agenda`
- `tool_access`
- `in_transit_to_place_id`
- `arrival_world_time`
- `last_known_situation`

`memorable_facts`, `observations`, and `recent_activity` are newline-separated logs with turn provenance tags. `player_notes` is newline-separated player canon without narrator-turn provenance. `aliases` is newline-separated alternate descriptors or names that resolve to the same canonical row.

### Story Dossier Tables

The story dossier is the narrator-visible memory of what is currently playable.

`story_threads`:

- active or dormant quests, mysteries, threats, relationships, and background pressure
- can carry stakes, rewards, consequences, and hidden pressure

`story_clues`:

- discovered evidence, leads, implications, false leads, and spent clues

`story_objectives`:

- active, blocked, completed, or failed next steps

`story_resources`:

- tools, allies, injuries, authority, assets, or other play-relevant resources

`timeline_events`:

- concise historical beats with world time, importance, and optional thread link

These rows are written by the archivist after narrator turns or by the correction channel.

### `world_corrections`

`world_corrections` stores the inspector Archivist tab scrollback.

Core fields:

- `id`
- `world_id`
- `turn_id`
- `player_text`
- `archivist_reply`
- `applied_patch`
- `created_at`

The correction channel is explicitly separate from the main narration chat. The narrator never receives the player correction text directly; it only sees the resulting state on later turns.

### `tts_audio_cache`

`tts_audio_cache` stores a small bounded replay cache keyed by world, assistant turn, TTS model, voice, and text hash.

Core fields:

- `world_id`
- `turn_id`
- `model_key`
- `voice_id`
- `text_hash`
- `content_type`
- `audio`
- `byte_length`
- `created_at`
- `accessed_at`

## Runtime Turn Pipeline

The main `POST /api/chat` flow is:

```text
client submits player action
  |
  v
validate world and request body
  |
  v
handle meta commands, retry replay, and daily token cap
  |
  v
insert user turn if this is not an in-flight retry
  |
  v
read prior narrator world state
  |
  v
record present-NPC appearances and update agency tiers
  |
  v
classify player action
  |
  v
resolve unresolved real-world places
  |
  v
run NPC agent when needed
  |
  v
re-read state and format narrator state block
  |
  v
stream narrator response
  |
  v
insert assistant turn and metadata
  |
  v
run deterministic or LLM archivist patch
  |
  v
apply structured world-state updates
```

The important ordering is that the NPC agent runs before the narrator, while the archivist runs after the narrator.

## Narrator State Assembly

`getNarratorWorldState(worldId)` builds a deliberately bounded view:

- current world time
- active scene
- current place
- present characters: player plus NPCs in the current place
- known characters
- known places
- story dossier

`formatStateBlock(state, plannedActions)` converts that state into the narrator prompt. The state block includes:

- fixed time/place/scene facts
- present character facts
- NPC goals, agendas, attitudes, beliefs, reveries, tools, focus, activity, observations
- real-world place anchors
- tracked off-scene NPC location and journey state
- planned moves for this turn
- player canon
- story dossier

The narrator system prompt instructs the model to respect state as authoritative while keeping the prose diegetic. Hidden/private NPC fields may shape behavior, but should not be dumped as exposition.

## NPC Agency Model

NPCs are not all equally expensive. The `characters.agency_level` column controls how much independent behavior they receive.

Current levels:

- `npc`: passive walk-on; narrator handles directly.
- `local`: present or highly relevant; eligible for every-turn NPC agent ticks.
- `nearby`: recently present; eligible every 2 turns.
- `distant`: off-scene but relevant; eligible every 5 turns.
- `dormant`: remembered but not actively ticked.

The legacy `agent` value may still be accepted by some query paths for migration compatibility, but the intended current vocabulary is proximity based.

Promotion and cooling are deterministic:

- Present non-player characters have `appearance_count` bumped.
- At the threshold, an ordinary NPC promotes to `local`.
- Agent-tier NPCs not present cool down through `nearby`, `distant`, `dormant`, and eventually back to `npc`.
- Transient service NPCs, such as couriers or cashiers, are kept passive unless durable story signals justify attention.

This keeps recurring characters alive without spending tokens on every incidental person.

## NPC Agent Contract

The NPC agent runs before the narrator on selected in-character turns.

Inputs:

- premise
- world time
- setting region
- protagonist location
- every eligible agent-tier NPC
- recent prior narration
- the player's new input
- known places and real-world geography anchors

Outputs:

1. `npc_updates`: persistent state changes for agent-tier NPCs.
2. `planned_actions`: one-turn action intents for present agent-tier NPCs.

Persistent updates may change:

- `current_focus`
- `recent_activity`
- `current_place_id`
- `personal_goals`
- `private_beliefs`
- `reveries`
- `relationship_to_player`
- `long_term_agenda`
- `tool_access`
- journey fields: destination, ETA, last known situation

The apply layer only accepts updates for existing agent-tier non-player characters. Movement targets must match known places. Unknown characters and unknown places are dropped as safety rails.

## Relationship Between NPCs and the Narrator

The narrator is the prose renderer and scene dramatist. The NPC agent is the behavioral planner for agent-tier NPCs. The archivist is the state recorder.

That division looks like this:

```text
NPC database state
  |
  v
NPC agent decides agent-tier NPC updates and this-turn plans
  |
  v
Narrator receives updated state plus planned_actions
  |
  v
Narrator renders the scene as prose
  |
  v
Archivist extracts what the prose established
  |
  v
Database becomes the next turn's state
```

Key rules:

- Agent-tier NPCs own their intended decisions through `planned_actions`.
- The narrator stages those decisions as natural prose, dialogue, hesitation, refusal, or action.
- Passive NPCs are still entirely narrator-controlled unless promoted.
- The narrator may use private NPC cognition to shape visible behavior, but must not expose database fields as narration.
- Off-scene NPCs are grounded by `current_place_id`, `in_transit_to_place_id`, `arrival_world_time`, and `last_known_situation`; the narrator should not teleport them or invent unsupported addresses.
- The archivist records the actual outcome after the narrator finishes. If the narrator stages an NPC plan differently than expected, the post-turn patch follows the prose because the prose is the append-only canonical book.

This makes the relationship asymmetric: NPCs constrain and inform the narrator before a turn, while narrator prose determines what becomes canonical after the turn.

## Narrator, NPC Agent, and Archivist Boundaries

### Narrator

Owns:

- second-person present-tense prose
- sensory detail, dialogue, pacing, and consequence
- map/place tool calls when needed for route or landmark grounding

Does not own:

- direct database writes
- correction-channel text
- exposing hidden/private NPC state as mechanical explanation

### NPC Agent

Owns:

- agent-tier NPC continuity
- off-scene activity
- present agent NPC action plans
- private cognition updates
- journey state for tracked NPCs

Does not own:

- creating places
- creating characters
- narrator prose
- passive NPC behavior unless they are promoted

### Archivist

Owns:

- extracting typed world-state patches from narrator turns
- creating or merging characters and places
- opening/closing scenes
- updating world time
- writing story dossier rows
- applying player corrections through the separate inspector channel

Does not own:

- main narration prose
- pre-narrator NPC decision-making

## Character Identity and Merging

Character identity is resolved through:

- case-insensitive exact name matching
- alias matching
- conservative token overlap for non-descriptive names
- explicit correction-channel alias merges

When rows merge, the kept row preserves the strongest or freshest useful state:

- longer descriptions usually win
- newer scalar state can win for location, focus, attitude, and relationship
- line logs merge and deduplicate
- strongest status and strongest agency level win
- aliases from the losing row are carried forward

The player row is protected from silent NPC merges.

## Player Canon

Player-asserted canon is stored in:

- `characters.player_notes`
- `places.player_notes`
- `world_corrections.applied_patch`

The correction prompt can write player notes. The normal narrator-extraction archivist is instructed not to. On later turns, `formatStateBlock` emits a `PLAYER CANON` section so the narrator respects corrected facts without replaying the correction conversation into the fiction.

## Invariants

- `turns` are append-only.
- User turns are persisted before narrator generation.
- Assistant turns are persisted after the stream completes.
- Structural world-state changes happen after assistant prose exists.
- `world_id` scopes all story state.
- The active scene is found through `worlds.current_scene_id` and `scenes.status`.
- The player character's location follows scene transitions.
- NPC agent updates cannot create new places or characters.
- Corrections do not appear in the main narration chat.
- The narrator sees state, not raw correction chat.

## Design Risks and Pressure Points

- Prompt-only write boundaries are not perfect. The normal archivist is told not to write `player_notes`, but the apply layer does not hard-gate by caller.
- The NPC agent updates state before the narrator writes the turn. If the narrator ignores a plan, the database may briefly contain an intended state until the archivist records the actual prose outcome.
- Time is free-text, so ETA comparison is prompt-guided rather than deterministic.
- Long newline logs can grow; prompt formatters trim recent lines, but storage is unbounded.
- Agency tiers are stored on `characters`, so future multiplayer or parallel-scene support will need more precise attention scheduling.
- The target docs still describe a future PostgreSQL/Drizzle shape. Engineers should treat migrations and prepared statements as the current implementation.

## v2 Pressure Relief

The v2 roadmap accepts five targeted improvements rather than a rewrite:

- Add `npc_intents` so every NPC-agent plan can be reconciled against narrator prose.
- Add `relationships` so trust, fear, leverage, promises, and debts become first-class state.
- Move memory-like character lines toward rows with `importance`, `decay_score`, and `visibility`.
- Treat narrator surprise as visibility filtering, not as an all-purpose hidden-secret field.
- Run dormant-NPC reverie work as background maintenance, not inside the chat hot path.

The important pushback: the current project prompts should not be replaced by generic "Westworld-style" sketches. They already encode project-specific constraints around diegesis, geography, journey state, player canon, service NPCs, and prose shape. v2 should add narrow clauses for intent/outcome tracking and visibility, not discard the accumulated prompt work.

## Useful Code Entry Points

- `src/lib/migrations.ts`: schema history and current table definitions.
- `src/lib/db.ts`: shared prepared statements and read/write helpers.
- `src/lib/worlds.ts`: world creation and initial seed rows.
- `src/lib/world-state.ts`: narrator/inspector state assembly and prompt formatting.
- `src/lib/npc-promotion.ts`: deterministic NPC appearance counting and tier changes.
- `src/lib/npc-agent.ts`: pre-narrator agent-tier NPC planning and updates.
- `src/lib/archivist.ts`: patch schemas, extraction, correction path, upserts, merges, and apply transaction.
- `src/app/api/chat/route.ts`: main turn orchestration.
- `prompts/narrator-system.md`: narrator behavioral contract.
- `prompts/npc-agent-system.md`: NPC agent behavioral contract.
- `prompts/archivist-system.md`: narrator-turn extraction contract.
- `prompts/archivist-correction.md`: player correction contract.

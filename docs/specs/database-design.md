# Database Design

## 1. Overview

> **Datastore status (onion-arch-refactor branch, 2026-06-08).** The original target — a single PostgreSQL 17 instance with the pgvector extension and Drizzle ORM — is **superseded**. The live/default store is now **SQLite via raw `better-sqlite3`** (no Drizzle, no Postgres), with migrations applied on boot. A full **MongoDB + Mongoose** adapter has been built behind the `PERSISTENCE=mongo` flag but is **not yet cut over** (`PERSISTENCE` defaults to `sqlite`; the production Mongo cutover and backfill are a deferred manual gate). Both adapter sets implement the **same repository ports** (`packages/server/src/domain/ports/`), so nothing above `infrastructure/` knows which store is live. The SQL schema below is kept as the **logical source of truth** — it still describes the entities, columns, constraints, and indexes faithfully — with **Mongo mapping notes** added per section (see §1.1). Read the SQL/`SQLTYPE`s as logical types: in SQLite they map to its affinities (`TEXT`/`INTEGER`/`REAL`, JSON stored as `TEXT`); in Mongo to BSON documents.

All persistent state lives in one logical schema, organized into three tiers, introduced across implementation phases:

- **Core Tables (Phase 1)** — worlds, characters, scenes, turns
- **Seeding + Knowledge Tables (Phase 2-3)** — world_sources, wiki_pages, timeline_events, relationships, story_threads, memory_chunks
- **Living World Tables (Phase 4)** — npc_agendas
- **Multiplayer Tables (Phase 5)** — users, player_characters, notifications

Design principles:
- UUIDs for all primary keys (safe for distributed systems, prevents enumeration)
- `created_at` / `updated_at` timestamps on mutable tables
- Turns are append-only (no `updated_at`); the `TurnRepository` port is append-only by construction (insert / recentTurns / turnsBefore / mergeMetadata — no general update)
- JSONB columns for flexible/evolving data
- Denormalize where it eliminates expensive joins on hot paths
- Foreign keys with CASCADE deletes (world deletion cleans up everything)

### 1.1 MongoDB mapping (PERSISTENCE=mongo)

The Mongo adapter (`packages/server/src/infrastructure/persistence/mongo/`) maps this logical schema onto Mongoose models. The mapping rules below are general; individual sections add table-specific notes:

- **Shape.** 15 top-level collections plus 2 embedded subdocuments (a small structure is embedded in its parent document rather than given its own collection).
- **Monotone integer ids and turn sequence.** A dedicated `counters` collection with an atomic `findOneAndUpdate` `$inc` issues every collection a monotone **integer** `id` and the per-scene/per-world turn sequence. Ordering **never** depends on Mongo's `ObjectId` — it depends on these integer counters, preserving the same ordering guarantees the SQL `turn_number` / sequential ids provide.
- **CHECK constraints → enums and ranges.** SQL `CHECK` / enumerated status fields become Mongoose `enum`s. Numeric ranges (e.g. importance `1..5`, intensity `0..1`) become `min`/`max` validators.
- **Case-insensitive uniqueness.** SQL `lower(name)` / `lower(title)` unique indexes become a normalized `nameKey` / `titleKey` field carrying a **unique index scoped per `worldId`**.
- **Provenance.** `[t:N]` provenance markers in extracted facts are preserved verbatim.
- **Transactions.** The Mongo `UnitOfWork` wraps work in `session.withTransaction`, with a **replica-set fail-fast at boot** (transactions require a replica set). The SQLite `UnitOfWork` uses an immediate transaction.

The SQLite adapter (`packages/server/src/infrastructure/persistence/sqlite/`) holds the 14 `*.sqlite.ts` repositories plus `unit-of-work.sqlite.ts`; its repo methods are `async` (sync `better-sqlite3` calls wrapped in `Promise.resolve`) to satisfy the shared async ports.

## 2. Entity Relationship Diagram

```
                    ┌──────────┐
                    │  users   │ (Phase 5)
                    └────┬─────┘
                         │ 1:N
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                         worlds                                │
│  id, name, premise, genre, tone, setting_details, status     │
└──┬──────────┬──────────┬──────────┬──────────┬───────────────┘
   │ 1:N      │ 1:N      │ 1:N      │ 1:N      │ 1:N
   ▼          ▼          ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐ ┌─────────────┐
│ chars  │ │ scenes │ │ sources │ │wiki_page │ │ timeline    │
│        │ │        │ │  (P2)   │ │  (P2)    │ │ events (P2) │
│        │ │        │ │         │ │          │ │             │
└───┬────┘ └───┬────┘ └─────────┘ └──────────┘ └─────────────┘
    │          │ 1:N
    │          ▼
    │     ┌─────────┐
    │     │  turns   │
    ├────▶│         │ (character_id FK)
    │     └─────────┘
    │
    │     ┌──────────────┐
    │     │relationships │ (Phase 2)
    └────▶│ char_a / b   │
          └──────────────┘

┌──────────────────┐
│ story_threads    │ (Phase 2)
│ world_id FK      │
│ source_ids UUID[]│
└──────────────────┘

┌──────────────────┐
│  memory_chunks   │ (Phase 2)
│  world_id FK     │
│  embedding vector│
└──────────────────┘

┌──────────────────┐
│  npc_agendas     │ (Phase 4)
│  character_id FK │
│  agenda clocks   │
└──────────────────┘

┌──────────────────┐
│ player_characters│ (Phase 5)
│ user_id FK       │
│ character_id FK  │
└──────────────────┘

┌──────────────────┐
│  notifications   │ (Phase 5)
│  user_id FK      │
│  world_id FK     │
└──────────────────┘
```

## 3. Phase 1 Tables (Core)

### 3.1 `worlds`

The root entity. Every other table belongs to a world.

```sql
CREATE TABLE worlds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  premise       TEXT NOT NULL,
  genre         VARCHAR(100),
  tone          VARCHAR(100),
  setting_details JSONB DEFAULT '{}',
  status        VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- setting_details JSONB structure (flexible, not enforced):
-- {
--   "time_period": "medieval",
--   "clock": {
--     "label": "Day 1, Morning",
--     "elapsed_minutes": 0,
--     "calendar_system": "local"
--   },
--   "deadlines": [
--     {
--       "id": "mission_launch",
--       "label": "Mission launch",
--       "due_at_label": "Day 1, Evening",
--       "remaining_minutes": 360,
--       "status": "active"
--     }
--   ],
--   "content_boundaries": {
--     "rating": "mature",
--     "allowed_intensity": ["battlefield violence", "political horror"],
--     "restricted_content": ["sexual violence"],
--     "fade_to_black": ["torture"],
--     "tone_notes": "grim consequences without eroticized cruelty"
--   },
--   "magic_system": "low fantasy",
--   "geography": "island archipelago",
--   "key_factions": ["The Iron Council", "The Drift Walkers"],
--   "narrative_rules": ["no resurrection", "consequences are permanent"],
--   "existing_technology": ["sail ships", "iron weapons", "hand-copied manuscripts"],
--   "nonexistent_technology": ["printing press", "firearms", "telegraph", "newspapers"]
-- }
```

**Indexes**: Primary key only for Phase 1. Status index added if needed for filtering.

**Status values**: `active` (playable), `paused` (temporarily inactive), `archived` (read-only).

**Content boundaries**: `setting_details.content_boundaries` stores world-level tone and safety constraints. All agents must treat these as authoritative style constraints, not suggestions. This lets a world remain intense or grim while still avoiding content the user has excluded.

**Existence constraints**: `setting_details.existing_technology` and `nonexistent_technology` declare what is and is not present in the world. Both lists are authoritative for the World Linter and Archivist — a player or LLM introducing "the Daily Herald" into a world whose `nonexistent_technology` includes `printing press` should be flagged as an anachronism rather than silently absorbed into canon. The lists are non-exhaustive; absence from either list means "not yet declared." Linter behavior is conservative when something is undeclared.

### 3.2 `characters`

All characters in a world — both player characters and NPCs.

```sql
CREATE TABLE characters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  is_player     BOOLEAN NOT NULL DEFAULT false,
  traits        JSONB DEFAULT '{}',
  status        VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_characters_world_id ON characters(world_id);

-- traits JSONB structure:
-- {
--   "personality": ["cautious", "curious", "loyal"],
--   "abilities": ["swordsmanship", "herbalism"],
--   "goals": ["find the lost city", "protect their sister"],
--   "fears": ["deep water", "betrayal"],
--   "boundaries": [
--     "will not marry under political pressure",
--     "will not swear fealty to anyone who has not earned it",
--     "refuses to discuss the death of his brother"
--   ],
--   "appearance": "tall, weathered, scar across left cheek",
--   "speech_style": "formal, measured, avoids contractions",
--   "name_profile": {
--     "given_name": "Rameses",
--     "family_name": "Osborne",
--     "display_name": "Rameses Osborne",
--     "culture": "imperial frontier",
--     "source": "player_curated",
--     "reuse_key": "osborne"
--   },
--   "location": {
--     "label": "Rusty Anchor tavern",
--     "scene_id": "<uuid>",
--     "visibility": "present"
--   },
--   "identity": {
--     "species": "human",
--     "origin": "village herbalist",
--     "current_titles": ["Warden of Port Haven"],
--     "former_titles": [],
--     "factions": ["Drift Walkers"],
--     "not_facts": ["not nobility"]
--   },
--   "presentation": {
--     "worn_equipment": ["weathered cloak", "iron pendant"],
--     "visible_markers": ["scar across left cheek"],
--     "disguise": null,
--     "public_reputation": "local troublemaker"
--   }
-- }
```

**Status values**: `active`, `inactive` (left the story), `dead` (killed in narrative).

**Name curation**: `characters.name` is the display name used in prose, but `traits.name_profile` stores structured parts and generation provenance. User-created player characters must not use raw handles, numbers, emoji, or decorative symbols. In themed worlds, the name profile should include culture/faction/class context so future NPC generation can produce lore-compatible variation without reusing a tiny global name pool.

World creation and seeding should maintain a per-world name registry in `worlds.setting_details.name_registry` or a later dedicated table. The registry tracks `reuse_key` values and recent given/family names so generators can penalize duplicates such as repeated surnames across unrelated NPCs.

**Identity vs. presentation**: `traits.identity` stores what the character is. `traits.presentation` stores what the character appears to be wearing, carrying, impersonating, or signaling. Narrator and Actor prompts must not infer that equipment changes identity. Use `identity.not_facts` for facts the model is likely to hallucinate, such as "wearing Arch-Confessor armor" becoming "is an Arch-Confessor."

**Boundaries vs. goals**: `traits.goals` describes what the character pursues; `traits.boundaries` describes what they will refuse, resist, or walk away from regardless of player pressure. The Actor agent treats boundaries as hard refusals — the player can persuade an NPC over time only by changing the underlying state (proving loyalty, removing a deal-breaker fact, etc.), not by re-asking. Boundaries are first-class because LLM-controlled characters default to agreement under pressure unless explicitly authored to push back. Player characters may also have boundaries that gate proxy actions in Phase 5.

**Locality**: `traits.location` is the character-level current location for Phase 1. It should be kept in sync with the active scene for the player and later extended for NPCs in Phase 4. The context assembler uses it to build the authoritative state block.

**Design note**: In Phase 1, each world has exactly one player character (`is_player = true`). In Phase 5, multiple players each have their own character linked through `player_characters`.

### 3.3 `scenes`

A scene is a narrative container — a location, situation, or set piece. The story progresses through scenes sequentially, though in Phase 4+ parallel scenes are possible.

```sql
CREATE TABLE scenes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  scene_number  INTEGER NOT NULL,
  status        VARCHAR(50) NOT NULL DEFAULT 'active',
  location      VARCHAR(255),
  metadata      JSONB DEFAULT '{}',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenes_world_id ON scenes(world_id);
CREATE UNIQUE INDEX idx_scenes_world_number ON scenes(world_id, scene_number);
```

**Status values**: `active` (current scene), `completed` (concluded).

**`scene_number`**: Sequential within a world. The unique index on `(world_id, scene_number)` prevents duplicate numbering. In Phase 4, parallel scenes share a `scene_number` but have different `id`s — the unique constraint will need to be relaxed.

**Tactical state metadata**: For action-heavy or mission-style scenes, use `scenes.metadata.tactical_state` as the compact current battlefield/mission state. This is intentionally JSONB in Phase 1 so the project can support tactical campaigns without creating premature dedicated tables.

Example:
```json
{
  "tactical_state": {
    "objectives": [
      { "id": "kill_cardinal", "label": "Kill Cardinal Varak Thul", "status": "complete" },
      { "id": "extract_team", "label": "Extract surviving kill-team", "status": "at_risk" }
    ],
    "threats": [
      { "id": "lesser_daemon", "label": "Manifesting Lesser Daemon", "status": "active", "distance_meters": 8 }
    ],
    "allies": [
      { "character_id": "<uuid>", "label": "Sergeant Aulus", "status": "wounded", "wounds": ["head wound", "armor breach"] }
    ],
    "casualties": [
      { "label": "Two battle-brothers", "status": "dead" }
    ],
    "resources": [
      { "label": "Melta bombs", "remaining": 1 },
      { "label": "Teleport lock", "status": "unstable", "capacity": 4 }
    ],
    "extraction": {
      "method": "Thunderhawk",
      "status": "contested",
      "window_seconds": 120
    },
    "scene_clock": {
      "label": "Extraction window",
      "remaining_seconds": 120,
      "status": "collapsing"
    }
  }
}
```

The authoritative state builder should prefer this structured metadata over prose when present, then condense it into a small prompt block.

### 3.4 `turns`

The fundamental unit of the story. Every player action and narrator response is a turn. This table is append-only.

```sql
CREATE TABLE turns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id      UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  world_id      UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
  type          VARCHAR(50) NOT NULL,
  content       TEXT NOT NULL,
  turn_number   INTEGER NOT NULL,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_turns_scene_id ON turns(scene_id);
CREATE INDEX idx_turns_world_id_created ON turns(world_id, created_at);
CREATE UNIQUE INDEX idx_turns_scene_number ON turns(scene_id, turn_number);
```

**Type values**:
- `scene_opening` — narrator's scene-setting text (no character)
- `player_action` — player's input (character_id = player character)
- `narrator_response` — narrator's story continuation (no character)
- `npc_action` — NPC dialogue/action generated by Character Actor (Phase 4)
- `system_event` — scene transitions, proxy activations (Phase 4+)

**`world_id` denormalization**: Turns belong to scenes which belong to worlds. The denormalized `world_id` on turns avoids a join when querying "all turns in a world" for context assembly. Cost: one extra UUID per row (~16 bytes). Benefit: eliminates joins on the hottest query path.

**`metadata` JSONB structure**:
```json
{
  "model": "grok-4.3",
  "prompt_tokens": 2847,
  "completion_tokens": 312,
  "total_tokens": 3159,
  "latency_ms": 1834,
  "estimated_cost_usd": 0.023,
  "context_turns_used": 15,
  "resolution": {
    "intent": "strike the heretic's left leg with a power sword",
    "stance": "attempt",
    "outcome": "partial_success",
    "world_state_delta": "heretic left leg wounded; mobility reduced; leg not severed",
    "input_mode": "tactical_intent"
  },
  "stream_error": false
}
```

**Action resolution metadata**: Player input is stored verbatim in `content`, but any adjudicated outcome belongs in `metadata.resolution`. This prevents player phrasing from authoring reality directly. The Narrator describes the resolved outcome rather than blindly accepting assertions like "I cut the enemy's leg off."

**Input mode metadata**: `metadata.resolution.input_mode` distinguishes contested tactical intent from player-authored cinematic framing or emotional interiority. Examples: `tactical_intent`, `asserted_outcome`, `cinematic_framing`, `emotional_interiority`, `meta_or_unclear`. Cinematic framing ("everything changes in a burst of light") and emotional interiority ("I am devastated") can shape tone without automatically resolving a contested outcome.

**No `updated_at`**: Turns are never modified after creation. This is a deliberate constraint — the story is an immutable log.

## 4. Phase 2-3 Tables (Seeding + Knowledge System)

The knowledge system follows a Karpathy-style LLM wiki pattern:

1. **Raw sources are immutable** — user seeds, generated seed packets, simulated expedition logs, prior adventure logs, uploaded lore, play turns, and system summaries are preserved as source material.
2. **Compiled wiki pages evolve** — the LLM updates wiki/timeline/relationship/thread entries as a working layer over the sources.
3. **Canon is explicit** — generated content starts as soft canon unless accepted, directly established in play, or otherwise promoted.
4. **Linting flags conflicts** — contradictions and duplicates are reviewed instead of silently overwritten.

### 4.1 `world_sources`

Immutable source documents used by the World Seeder, Archivist, wiki compiler, and linter.

```sql
CREATE TABLE world_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  source_type     VARCHAR(50) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  content         TEXT NOT NULL,
  source_turn_id  UUID REFERENCES turns(id) ON DELETE SET NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sources_world_type ON world_sources(world_id, source_type);
CREATE INDEX idx_sources_world_created ON world_sources(world_id, created_at);
```

**Source type values**:
- `user_seed` — premise, rules, constraints, and preferences entered by the user
- `seed_packet` — structured output from the World Seeder
- `expedition_log` — simulated scout or historical POV adventure log
- `prior_adventure_log` — imported transcript, PDF extraction, or campaign log from earlier play
- `uploaded_lore` — imported notes or documents
- `play_turn` — source reference for player/narrator turns established during play
- `system_summary` — generated scene/world summaries used for compaction

**Design note**: Source documents are append-only. If the LLM revises its interpretation, it updates compiled wiki/timeline/relationship/thread rows, not the original source.

### 4.2 `wiki_pages`

Auto-generated knowledge base entries extracted by the Archivist.

```sql
CREATE TABLE wiki_pages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  content       TEXT NOT NULL,
  category      VARCHAR(100) NOT NULL,
  source_turn_id UUID REFERENCES turns(id) ON DELETE SET NULL,
  source_ids    UUID[] DEFAULT '{}',
  canon_status  VARCHAR(50) NOT NULL DEFAULT 'soft',
  confidence    VARCHAR(50) NOT NULL DEFAULT 'medium',
  embedding     vector(1024),
  metadata      JSONB DEFAULT '{}',
  last_verified_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wiki_world_id ON wiki_pages(world_id);
CREATE INDEX idx_wiki_world_category ON wiki_pages(world_id, category);
CREATE INDEX idx_wiki_world_canon ON wiki_pages(world_id, canon_status);
CREATE UNIQUE INDEX idx_wiki_world_title ON wiki_pages(world_id, lower(title));
CREATE INDEX idx_wiki_embedding ON wiki_pages
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Category values**: `character`, `location`, `item`, `faction`, `event`, `lore`, `concept`.

**`source_turn_id`**: Links back to the turn that generated or last updated this wiki page. Enables provenance tracking.

**`source_ids`**: Source document UUIDs that support the compiled page. This is intentionally denormalized for fast provenance display.

**`canon_status`**: `hard`, `soft`, `rumor`, `myth`, `false`, `disputed`. Seeded content defaults to `soft`; directly established gameplay facts can be promoted to `hard`.

**`confidence`**: `low`, `medium`, `high`. Confidence expresses extraction certainty, not narrative truth. A `rumor` can have high confidence if the source clearly states that people believe it.

**`embedding`**: 1024-dimensional Voyage AI vector for semantic search. The HNSW index (a pgvector feature) was part of the superseded Postgres target. **Current reality:** embedding/vector search is an unbuilt **Phase-2 slot** — `MemoryRepository.searchSimilar()` is a no-op returning `[]` in both the SQLite and Mongo adapters, and neither store populates the embedding column. The 1024-dim shape and HNSW parameters below are retained as the intended design for when embeddings land.

**Unique title per world**: The `lower(title)` unique index prevents duplicate wiki entries (case-insensitive).

### 4.3 `timeline_events`

Chronological record of significant in-world events.

```sql
CREATE TABLE timeline_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  description     TEXT NOT NULL,
  source_turn_id  UUID REFERENCES turns(id) ON DELETE SET NULL,
  source_ids      UUID[] DEFAULT '{}',
  scene_id        UUID REFERENCES scenes(id) ON DELETE SET NULL,
  world_timestamp VARCHAR(255),
  significance    VARCHAR(50) NOT NULL DEFAULT 'minor',
  visibility      VARCHAR(50) NOT NULL DEFAULT 'known',
  canon_status    VARCHAR(50) NOT NULL DEFAULT 'soft',
  confidence      VARCHAR(50) NOT NULL DEFAULT 'medium',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_timeline_world_id ON timeline_events(world_id);
CREATE INDEX idx_timeline_world_created ON timeline_events(world_id, created_at);
CREATE INDEX idx_timeline_world_canon ON timeline_events(world_id, canon_status);
CREATE INDEX idx_timeline_world_visibility ON timeline_events(world_id, visibility);
```

**`world_timestamp`**: In-world time as a string (e.g., "Day 3, Evening", "Year 412, Spring"). Not a real timestamp — narrative worlds have arbitrary time systems.

**Time authority**: `timeline_events` records what happened when. It does not own the current clock. During Phase 1, the current clock and active deadlines live in `worlds.setting_details.clock` and `worlds.setting_details.deadlines`. Later phases may promote that data to dedicated clock/deadline tables if scheduling, travel time, or multiplayer turn order requires stronger constraints.

**`significance`**: `minor` (routine events), `major` (plot turning points), `critical` (world-changing events). Used to filter timeline views and prioritize retrieval.

**`visibility`**: `known`, `rumored`, or `hidden`. Living World advancement may create hidden events that are true in the world but not yet known to the player, or rumored events that can surface through tavern talk, briefings, augury reports, intercepted messages, and changed location state. The context assembler must not expose hidden events to the player-facing narrator unless the current scene gives the player a plausible way to learn them.

### 4.4 `relationships`

Tracks connections between characters.

```sql
CREATE TABLE relationships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  character_a_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  character_b_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  type            VARCHAR(100) NOT NULL,
  description     TEXT,
  sentiment       VARCHAR(50) DEFAULT 'neutral',
  source_turn_id  UUID REFERENCES turns(id) ON DELETE SET NULL,
  source_ids      UUID[] DEFAULT '{}',
  canon_status    VARCHAR(50) NOT NULL DEFAULT 'soft',
  confidence      VARCHAR(50) NOT NULL DEFAULT 'medium',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT different_characters CHECK (character_a_id != character_b_id)
);

CREATE INDEX idx_relationships_world ON relationships(world_id);
CREATE INDEX idx_relationships_char_a ON relationships(character_a_id);
CREATE INDEX idx_relationships_char_b ON relationships(character_b_id);
CREATE INDEX idx_relationships_world_canon ON relationships(world_id, canon_status);
CREATE UNIQUE INDEX idx_relationships_pair ON relationships(
  world_id,
  LEAST(character_a_id, character_b_id),
  GREATEST(character_a_id, character_b_id),
  type
);
```

**`type`**: `ally`, `enemy`, `family`, `romantic`, `mentor`, `rival`, `employer`, `unknown`.

**`sentiment`**: `hostile`, `negative`, `neutral`, `positive`, `devoted`. Tracked over time as relationships evolve.

**NPC knowledge**: Use `metadata` to track what one character believes about another, separate from objective truth. Examples: `known_identity`, `known_titles`, `mistaken_beliefs`, `last_interaction_label`, and `trusts_claimed_rank`. This lets NPCs react differently without letting their assumptions overwrite the canonical character record.

**Relationship anchors**: For major NPC/player relationships, `metadata` should include a compact durable memory used in every scene where both characters are present. Suggested fields: `known_identity`, `known_titles`, `last_interaction_label`, `last_meaningful_turn_id`, `trust_level`, `promises`, `threats`, `secrets_shared`, `open_tensions`, and `private_sentiment`. This prevents an NPC from reverting to pre-meeting behavior once the original conversation falls out of recent-turn context.

**Unique pair constraint**: The `LEAST/GREATEST` trick ensures only one relationship row exists per pair per type, regardless of insertion order (A→B and B→A are the same relationship).

### 4.5 `story_threads`

Tracks open narrative threads (quests, mysteries, conflicts).

```sql
CREATE TABLE story_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  description     TEXT NOT NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'active',
  priority        VARCHAR(50) NOT NULL DEFAULT 'normal',
  source_turn_id  UUID REFERENCES turns(id) ON DELETE SET NULL,
  source_ids      UUID[] DEFAULT '{}',
  resolved_turn_id UUID REFERENCES turns(id) ON DELETE SET NULL,
  canon_status    VARCHAR(50) NOT NULL DEFAULT 'soft',
  confidence      VARCHAR(50) NOT NULL DEFAULT 'medium',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_threads_world_status ON story_threads(world_id, status);
CREATE INDEX idx_threads_world_canon ON story_threads(world_id, canon_status);
```

**Status values**: `active` (ongoing), `resolved` (concluded), `abandoned` (dropped), `dormant` (paused).

**Priority**: `background` (ambient world events), `normal` (standard plot threads), `urgent` (immediate narrative tension).

**Living World linkage**: `metadata` may include `npc_agenda_ids`, `clock_labels`, `last_advanced_world_time`, and `offscreen_consequences` for threads that can progress while the player is elsewhere.

### 4.6 `memory_chunks`

Chunked, embedded summaries for semantic retrieval. These are NOT raw turns — they are processed, condensed memory units created by the Archivist.

```sql
CREATE TABLE memory_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  chunk_type    VARCHAR(50) NOT NULL,
  source_turn_ids UUID[] DEFAULT '{}',
  source_ids    UUID[] DEFAULT '{}',
  canon_status  VARCHAR(50) NOT NULL DEFAULT 'soft',
  confidence    VARCHAR(50) NOT NULL DEFAULT 'medium',
  embedding     vector(1024),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_world_type ON memory_chunks(world_id, chunk_type);
CREATE INDEX idx_memory_world_canon ON memory_chunks(world_id, canon_status);
CREATE INDEX idx_memory_embedding ON memory_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**`chunk_type`**: `scene_summary` (condensed scene), `character_moment` (significant character event), `relationship_moment` (emotional or social shift), `tactical_state_delta` (objective/threat/resource/casualty update), `world_change` (world state change), `dialogue_highlight` (important conversation).

**`source_turn_ids`**: Array of turn UUIDs that contributed to this memory chunk. Enables provenance tracking without a join table.

**HNSW index parameters**: `m = 16` (connections per node, balances recall vs. build time), `ef_construction = 64` (build-time accuracy). These are good defaults for collections up to ~100K vectors.

**`source_ids`**: Source document UUIDs that support the memory chunk. Most chunks also keep `source_turn_ids` because turn provenance is frequently needed in the play UI.

## 5. Phase 4 Table (Living World)

### 5.1 `npc_agendas`

Tracks durable plans for major NPCs who can act while offscreen. This table is intentionally for major actors only: faction heads, rivals, companions with independent goals, recurring antagonists, patrons, warlords, and other characters whose movement changes the world.

```sql
CREATE TABLE npc_agendas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id          UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  character_id      UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  title             VARCHAR(255) NOT NULL,
  goal              TEXT NOT NULL,
  motivation        TEXT,
  current_plan      TEXT,
  status            VARCHAR(50) NOT NULL DEFAULT 'active',
  priority          VARCHAR(50) NOT NULL DEFAULT 'normal',
  secrecy           VARCHAR(50) NOT NULL DEFAULT 'rumored',
  player_relevance  VARCHAR(50) NOT NULL DEFAULT 'medium',
  clock             JSONB NOT NULL DEFAULT '{}',
  resources         JSONB NOT NULL DEFAULT '[]',
  allies            JSONB NOT NULL DEFAULT '[]',
  enemies           JSONB NOT NULL DEFAULT '[]',
  constraints       JSONB NOT NULL DEFAULT '[]',
  consequence       TEXT,
  next_check_at     VARCHAR(255),
  last_advanced_at  VARCHAR(255),
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_npc_agendas_world_status ON npc_agendas(world_id, status);
CREATE INDEX idx_npc_agendas_character ON npc_agendas(character_id);
CREATE INDEX idx_npc_agendas_world_priority ON npc_agendas(world_id, priority);
```

**Status values**: `active`, `paused`, `completed`, `failed`, `cancelled`.

**Priority values**: `background`, `normal`, `urgent`.

**Secrecy values**: `public`, `rumored`, `hidden`. Secrecy controls what can be shown in narrator context. Hidden agendas can still advance, but their exact facts should not appear in player-facing prose until discovered.

**Player relevance values**: `low`, `medium`, `high`. The Living World service uses this to decide which agendas to advance when token or cost budgets are tight.

**`clock` JSONB structure**:
```json
{
  "label": "Secession crusade preparations",
  "progress": 40,
  "max": 100,
  "step_hint": "Advances quickly if the player leaves Karthax or Imperial patrols are weakened",
  "consequence_at_full": "Dravik openly declares rebellion and invades Veyr Secundus"
}
```

**`metadata` JSONB structure**:
```json
{
  "current_location": {
    "label": "Karthax Palace-Bastion",
    "scene_id": "<uuid>",
    "visibility": "elsewhere"
  },
  "linked_thread_ids": ["<uuid>"],
  "last_player_interference": "The player refused to endorse Dravik's levy request",
  "advance_history": [
    {
      "world_time": "Day 18",
      "from": 40,
      "to": 65,
      "reason": "Player departed the planet; no loyalist blockade remained"
    }
  ]
}
```

**Design note**: Do not create agendas for every NPC. A good initial heuristic is: create agendas for major seeded NPCs with independent goals, recurring NPCs who gain player relevance, and faction leaders tied to active story threads. Minor NPCs remain in `characters` and relationships only.

**Advancement outputs**: When an agenda clock changes significantly or completes, deterministic application code updates `npc_agendas`, may patch `characters.traits.location`, may update `story_threads.metadata`, and appends `timeline_events` with the appropriate `visibility`.

## 6. Phase 5 Tables (Multiplayer)

### 6.1 `users`

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255) NOT NULL,
  avatar_url    TEXT,
  settings      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 6.2 `player_characters`

Links users to characters in worlds. One user can have characters in multiple worlds.

```sql
CREATE TABLE player_characters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id    UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  control_mode    VARCHAR(50) NOT NULL DEFAULT 'manual',
  proxy_settings  JSONB DEFAULT '{}',
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT unique_user_world UNIQUE (user_id, world_id)
);

CREATE INDEX idx_pc_user ON player_characters(user_id);
CREATE INDEX idx_pc_world ON player_characters(world_id);

-- control_mode: 'manual' | 'soft_proxy' | 'full_proxy'
-- proxy_settings JSONB:
-- {
--   "auto_proxy_after_minutes": 30,
--   "proxy_restrictions": ["no combat", "no romantic interactions"],
--   "proxy_personality_override": null
-- }
```

### 6.3 `notifications`

```sql
CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  world_id      UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  type          VARCHAR(50) NOT NULL,
  title         VARCHAR(255) NOT NULL,
  content       TEXT,
  read          BOOLEAN NOT NULL DEFAULT false,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read)
  WHERE read = false;
```

**Notification types**: `turn_waiting` (your turn), `proxy_activated` (AI took over), `world_invite`, `scene_transition`, `thread_resolved`.

## 7. Migration Strategy

> **Mechanism note (current branch).** Drizzle Kit is gone along with Postgres — there is no `db:generate` / `db:migrate` / `db:studio`. The live SQLite store applies its migrations **on boot** via raw `better-sqlite3`. The phase plan and immutability discipline below remain the intended logical sequence; treat the `NNNN_description.sql` naming as the logical migration units, not Drizzle-generated artifacts. Under `PERSISTENCE=mongo`, schema is shaped by the Mongoose models (`packages/server/src/infrastructure/persistence/mongo/models/index.ts`) and indexes are declared on those models rather than via SQL DDL.

### Principles
- One migration per logical change
- Prefer reversible migrations where the store supports them
- Never modify a deployed migration — create a new one
- Name format: `NNNN_description.sql` (logical migration unit)
- Test migrations against production-like data before deploying

### Phase Migration Plan

```
Phase 1 (MVP):
  0001_create_worlds.sql
  0002_create_characters.sql
  0003_create_scenes.sql
  0004_create_turns.sql

Phase 2 (World Seeding + LLM Wiki Compiler):
  0005_create_world_sources.sql
  0006_create_wiki_pages.sql          (includes pgvector index)
  0007_create_timeline_events.sql
  0008_create_relationships.sql
  0009_create_story_threads.sql
  0010_create_memory_chunks.sql       (includes pgvector index)

Phase 3 (Memory + Knowledge):
  (no new tables — live Archivist extraction, embeddings, context retrieval)

Phase 4 (Agent Orchestra):
  0011_create_npc_agendas.sql
  0012_add_timeline_visibility.sql
  0013_add_scene_parallel_support.sql (relax unique constraint)

Phase 5 (Multiplayer):
  0014_create_users.sql
  0015_create_player_characters.sql
  0016_add_world_owner.sql            (add owner_user_id to worlds)
  0017_create_notifications.sql
  0018_add_character_controller.sql   (add controller_type to characters)
```

### Key Constraint: Phase 1 Migrations Are Immutable

Once a migration has been committed or deployed, never edit it in place. Later phases may add new tables, add columns, or relax constraints through forward migrations, but Phase 1 migration files themselves remain immutable.

The JSONB columns (`setting_details`, `traits`, `metadata`) absorb flexible data during early development so most Phase 2 additions can be modeled as new tables. Known later exceptions are explicit forward migrations, such as relaxing the scene-number constraint for parallel scenes and adding ownership/controller fields for multiplayer.

### Structural Evolution: JSONB → Typed Columns

JSONB is a deliberate Phase 1-2 convenience, not a permanent home for any field with documented internal structure. Several JSONB blocks already have specified shapes (`scenes.metadata.tactical_state`, `npc_agendas.clock`, `turns.metadata.resolution`, parts of `worlds.setting_details`). These will be promoted to typed columns or sibling tables when **any** of the following triggers fire:

1. **Query trigger.** Any application code reads or writes the field with a JSON-path expression more than twice (e.g. `WHERE setting_details->>'clock'->>'remaining' < 60`). At that point the field is no longer "flexible data" — it is a column wearing a JSONB hat, and indexable structured storage will be faster and safer.
2. **Constraint trigger.** Any field acquires a non-null requirement, a numeric range, a foreign key reference, or a uniqueness rule. JSONB cannot enforce these without check constraints that are awkward to maintain; a real column with `NOT NULL` / `CHECK` / `REFERENCES` is the right shape.
3. **Migration trigger.** Any internal field needs renaming, type narrowing, or default backfilling across existing rows. Doing this safely inside JSONB requires hand-rolled UPDATE statements with JSON manipulation; a column migration is straightforward.
4. **Cross-row aggregation trigger.** Any report or dashboard needs to aggregate the field across worlds (e.g. "average tactical clock progress at scene end"). JSON-path aggregation works but is slow; a column with a btree index is the right answer.

**Expected promotions, by phase:**

- **Phase 3 (Archivist live extraction):** `scenes.metadata.tactical_state` is read on most narrator turns to populate the authoritative state block. Once the Archivist begins writing structured tactical deltas, promote it to a dedicated `scene_tactical_state` row (1-to-1 with `scenes`) with typed columns for `objectives`, `threats`, `allies`, `casualties`, `resources`, `extraction_status`, `scene_clock_progress`, `scene_clock_max`.
- **Phase 4 (Living World):** `npc_agendas.clock` is advanced on every Living World pass. Promote `clock_label`, `clock_progress`, `clock_max`, `clock_consequence`, and `clock_due_at` to typed columns on `npc_agendas`. Retain a `clock_metadata` JSONB for anything that doesn't fit.
- **Phase 4 (Conductor logging):** `turns.metadata.resolution.stance` and `turns.metadata.resolution.outcome` are queried for analytics. Promote `resolution_stance` and `resolution_outcome` to columns; leave the rest of `resolution` in JSONB.

Promotions are non-destructive forward migrations: add the new column, backfill from JSONB, switch reads to the column, leave the JSONB in place for one release as a fallback, then drop the JSONB key in a follow-up migration. The point of this section is to make the trigger criteria explicit so that "we'll just leave it in JSONB" never wins by default once the field is being queried structurally.

## 8. Query Patterns

### Hot Paths (must be fast)

**Get recent turns for context assembly** (runs on every player action):
```sql
SELECT id, type, content, character_id, turn_number, created_at
FROM turns
WHERE world_id = $1
ORDER BY created_at DESC
LIMIT $2;
-- Uses idx_turns_world_id_created
```

**Get active scene for a world**:
```sql
SELECT * FROM scenes
WHERE world_id = $1 AND status = 'active'
ORDER BY scene_number DESC
LIMIT 1;
-- Uses idx_scenes_world_id
```

**Semantic memory retrieval** (Phase 3+) — the `<=>` cosine operator below is pgvector syntax from the superseded target; on the live stores this is the unbuilt Phase-2 slot (`MemoryRepository.searchSimilar()` returns `[]`):
```sql
SELECT id, content, chunk_type, 1 - (embedding <=> $1) AS similarity
FROM memory_chunks
WHERE world_id = $2
  AND canon_status IN ('hard', 'soft')
ORDER BY embedding <=> $1
LIMIT $3;
-- Uses idx_memory_embedding (HNSW)
```

**Wiki search** (Phase 3+):
```sql
SELECT id, title, content, category, canon_status, confidence, 1 - (embedding <=> $1) AS similarity
FROM wiki_pages
WHERE world_id = $2
  AND canon_status IN ('hard', 'soft', 'rumor', 'myth', 'disputed')
ORDER BY embedding <=> $1
LIMIT $3;
-- Uses idx_wiki_embedding (HNSW)
```

**Active major NPC agendas** (Phase 4+):
```sql
SELECT *
FROM npc_agendas
WHERE world_id = $1
  AND status = 'active'
  AND priority IN ('normal', 'urgent')
ORDER BY
  CASE priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
  updated_at ASC
LIMIT $2;
-- Uses idx_npc_agendas_world_status and idx_npc_agendas_world_priority
```

### Write Paths

**Insert turn** (runs on every player action and narrator response):
```sql
INSERT INTO turns (scene_id, world_id, character_id, type, content, turn_number, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;
```

Turn number is determined inside the same transaction as the insert. Even in Phase 1, two browser tabs or a double-submit can race, so turn insertion must lock the scene's turn-number sequence before calculating the next value.

Recommended Phase 1 approach:
```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext($1::text)); -- scene_id
SELECT COALESCE(MAX(turn_number), 0) + 1 FROM turns WHERE scene_id = $1;
INSERT INTO turns (scene_id, world_id, character_id, type, content, turn_number, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;
COMMIT;
```

Phase 5 can keep this strategy or move to serializable transactions if multiplayer turn ordering needs broader world-level locking.

## 9. Data Lifecycle

### Turn Data
- **Created**: on every player action and narrator response
- **Modified**: never (append-only)
- **Deleted**: only on world deletion (CASCADE)
- **Archived**: not individually — world archival covers this

### Wiki Pages
- **Created**: by the wiki compiler during seeding, or by Archivist on first mention during play
- **Modified**: by the compiler or Archivist when new information contradicts or extends existing entry
- **Deleted**: only on world deletion (CASCADE)

### World Sources
- **Created**: during world seeding, imports, play-turn provenance capture, or compaction
- **Modified**: never (append-only)
- **Deleted**: only on world deletion (CASCADE)

### Memory Chunks
- **Created**: by Archivist after each scene or periodically
- **Modified**: never (create new chunks, don't update old ones)
- **Deleted**: potentially by a future compaction process that merges old chunks

### NPC Agendas
- **Created**: by World Seeder for major NPCs, by Archivist when live play establishes a new independent agenda, or manually by user/world tools
- **Modified**: by Living World advancement when time passes, by Archivist when player actions interfere with plans, or by direct gameplay outcomes
- **Completed/failed**: when the clock consequence resolves, the NPC dies, the goal becomes impossible, or the player decisively resolves the thread
- **Deleted**: only on world deletion (CASCADE)

### Growth Estimates

For a single-player world with ~100 turns per session:
- `turns`: ~100 rows/session, ~1KB/row → ~100KB/session
- `world_sources`: ~5-15 seeding rows plus optional play/source references → ~50-200KB initial seed
- `wiki_pages`: ~10-20 pages after first session, growing slowly → ~50KB
- `memory_chunks`: ~5-10 per scene → ~20KB/session
- `timeline_events`: ~5-10 per session → ~10KB/session
- `npc_agendas`: ~3-20 rows per world, updated in place → negligible storage

A heavy-use world with 1000 turns would accumulate ~1MB of turn data, ~500KB of wiki, ~200KB of memory chunks. Well within the capacity of the live single-file SQLite store (or a single Mongo instance once cut over).

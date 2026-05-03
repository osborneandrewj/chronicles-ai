# Database Design

## 1. Overview

All persistent state lives in a single PostgreSQL 17 instance with the pgvector extension. The schema is organized into three tiers, introduced across implementation phases:

- **Core Tables (Phase 1)** — worlds, characters, scenes, turns
- **Knowledge Tables (Phase 2)** — wiki_pages, timeline_events, relationships, story_threads, memory_chunks
- **Multiplayer Tables (Phase 4)** — users, player_characters, notifications

Design principles:
- UUIDs for all primary keys (safe for distributed systems, prevents enumeration)
- `created_at` / `updated_at` timestamps on mutable tables
- Turns are append-only (no `updated_at`)
- JSONB columns for flexible/evolving data
- Denormalize where it eliminates expensive joins on hot paths
- Foreign keys with CASCADE deletes (world deletion cleans up everything)

## 2. Entity Relationship Diagram

```
                    ┌──────────┐
                    │  users   │ (Phase 4)
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
│ chars  │ │ scenes │ │wiki_page│ │ timeline │ │ story_      │
│        │ │        │ │  (P2)   │ │ _events  │ │ threads (P2)│
│        │ │        │ │         │ │  (P2)    │ │             │
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
│  memory_chunks   │ (Phase 2)
│  world_id FK     │
│  embedding vector│
└──────────────────┘

┌──────────────────┐
│ player_characters│ (Phase 4)
│ user_id FK       │
│ character_id FK  │
└──────────────────┘

┌──────────────────┐
│  notifications   │ (Phase 4)
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
--   "magic_system": "low fantasy",
--   "geography": "island archipelago",
--   "key_factions": ["The Iron Council", "The Drift Walkers"],
--   "narrative_rules": ["no resurrection", "consequences are permanent"]
-- }
```

**Indexes**: Primary key only for Phase 1. Status index added if needed for filtering.

**Status values**: `active` (playable), `paused` (temporarily inactive), `archived` (read-only).

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
--   "appearance": "tall, weathered, scar across left cheek",
--   "speech_style": "formal, measured, avoids contractions"
-- }
```

**Status values**: `active`, `inactive` (left the story), `dead` (killed in narrative).

**Design note**: In Phase 1, each world has exactly one player character (`is_player = true`). In Phase 4, multiple players each have their own character linked through `player_characters`.

### 3.3 `scenes`

A scene is a narrative container — a location, situation, or set piece. The story progresses through scenes sequentially, though in Phase 3+ parallel scenes are possible.

```sql
CREATE TABLE scenes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  scene_number  INTEGER NOT NULL,
  status        VARCHAR(50) NOT NULL DEFAULT 'active',
  location      VARCHAR(255),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenes_world_id ON scenes(world_id);
CREATE UNIQUE INDEX idx_scenes_world_number ON scenes(world_id, scene_number);
```

**Status values**: `active` (current scene), `completed` (concluded).

**`scene_number`**: Sequential within a world. The unique index on `(world_id, scene_number)` prevents duplicate numbering. In Phase 3, parallel scenes share a `scene_number` but have different `id`s — the unique constraint will need to be relaxed.

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
- `npc_action` — NPC dialogue/action generated by Character Actor (Phase 3)
- `system_event` — scene transitions, proxy activations (Phase 3+)

**`world_id` denormalization**: Turns belong to scenes which belong to worlds. The denormalized `world_id` on turns avoids a join when querying "all turns in a world" for context assembly. Cost: one extra UUID per row (~16 bytes). Benefit: eliminates joins on the hottest query path.

**`metadata` JSONB structure**:
```json
{
  "model": "claude-sonnet-4-20250514",
  "prompt_tokens": 2847,
  "completion_tokens": 312,
  "total_tokens": 3159,
  "latency_ms": 1834,
  "estimated_cost_usd": 0.023,
  "context_turns_used": 15,
  "stream_error": false
}
```

**No `updated_at`**: Turns are never modified after creation. This is a deliberate constraint — the story is an immutable log.

## 4. Phase 2 Tables (Knowledge System)

### 4.1 `wiki_pages`

Auto-generated knowledge base entries extracted by the Archivist.

```sql
CREATE TABLE wiki_pages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  content       TEXT NOT NULL,
  category      VARCHAR(100) NOT NULL,
  source_turn_id UUID REFERENCES turns(id) ON DELETE SET NULL,
  embedding     vector(1024),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wiki_world_id ON wiki_pages(world_id);
CREATE INDEX idx_wiki_world_category ON wiki_pages(world_id, category);
CREATE UNIQUE INDEX idx_wiki_world_title ON wiki_pages(world_id, lower(title));
CREATE INDEX idx_wiki_embedding ON wiki_pages
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Category values**: `character`, `location`, `item`, `faction`, `event`, `lore`, `concept`.

**`source_turn_id`**: Links back to the turn that generated or last updated this wiki page. Enables provenance tracking.

**`embedding`**: 1024-dimensional Voyage AI vector for semantic search. The HNSW index enables fast approximate nearest neighbor queries.

**Unique title per world**: The `lower(title)` unique index prevents duplicate wiki entries (case-insensitive).

### 4.2 `timeline_events`

Chronological record of significant in-world events.

```sql
CREATE TABLE timeline_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  description     TEXT NOT NULL,
  source_turn_id  UUID REFERENCES turns(id) ON DELETE SET NULL,
  scene_id        UUID REFERENCES scenes(id) ON DELETE SET NULL,
  world_timestamp VARCHAR(255),
  significance    VARCHAR(50) NOT NULL DEFAULT 'minor',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_timeline_world_id ON timeline_events(world_id);
CREATE INDEX idx_timeline_world_created ON timeline_events(world_id, created_at);
```

**`world_timestamp`**: In-world time as a string (e.g., "Day 3, Evening", "Year 412, Spring"). Not a real timestamp — narrative worlds have arbitrary time systems.

**`significance`**: `minor` (routine events), `major` (plot turning points), `critical` (world-changing events). Used to filter timeline views and prioritize retrieval.

### 4.3 `relationships`

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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT different_characters CHECK (character_a_id != character_b_id)
);

CREATE INDEX idx_relationships_world ON relationships(world_id);
CREATE INDEX idx_relationships_char_a ON relationships(character_a_id);
CREATE INDEX idx_relationships_char_b ON relationships(character_b_id);
CREATE UNIQUE INDEX idx_relationships_pair ON relationships(
  world_id,
  LEAST(character_a_id, character_b_id),
  GREATEST(character_a_id, character_b_id),
  type
);
```

**`type`**: `ally`, `enemy`, `family`, `romantic`, `mentor`, `rival`, `employer`, `unknown`.

**`sentiment`**: `hostile`, `negative`, `neutral`, `positive`, `devoted`. Tracked over time as relationships evolve.

**Unique pair constraint**: The `LEAST/GREATEST` trick ensures only one relationship row exists per pair per type, regardless of insertion order (A→B and B→A are the same relationship).

### 4.4 `story_threads`

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
  resolved_turn_id UUID REFERENCES turns(id) ON DELETE SET NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_threads_world_status ON story_threads(world_id, status);
```

**Status values**: `active` (ongoing), `resolved` (concluded), `abandoned` (dropped), `dormant` (paused).

**Priority**: `background` (ambient world events), `normal` (standard plot threads), `urgent` (immediate narrative tension).

### 4.5 `memory_chunks`

Chunked, embedded summaries for semantic retrieval. These are NOT raw turns — they are processed, condensed memory units created by the Archivist.

```sql
CREATE TABLE memory_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  chunk_type    VARCHAR(50) NOT NULL,
  source_turn_ids UUID[] DEFAULT '{}',
  embedding     vector(1024),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_world_type ON memory_chunks(world_id, chunk_type);
CREATE INDEX idx_memory_embedding ON memory_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**`chunk_type`**: `scene_summary` (condensed scene), `character_moment` (significant character event), `world_change` (world state change), `dialogue_highlight` (important conversation).

**`source_turn_ids`**: Array of turn UUIDs that contributed to this memory chunk. Enables provenance tracking without a join table.

**HNSW index parameters**: `m = 16` (connections per node, balances recall vs. build time), `ef_construction = 64` (build-time accuracy). These are good defaults for collections up to ~100K vectors.

## 5. Phase 4 Tables (Multiplayer)

### 5.1 `users`

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

### 5.2 `player_characters`

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

### 5.3 `notifications`

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

## 6. Migration Strategy

### Principles
- One migration per logical change
- All migrations must be reversible (include down/rollback SQL)
- Never modify a deployed migration — create a new one
- Name format: `NNNN_description.sql` (Drizzle Kit generates these)
- Test migrations against production-like data before deploying

### Phase Migration Plan

```
Phase 1 (MVP):
  0001_create_worlds.sql
  0002_create_characters.sql
  0003_create_scenes.sql
  0004_create_turns.sql

Phase 2 (Knowledge):
  0005_create_wiki_pages.sql          (includes pgvector index)
  0006_create_timeline_events.sql
  0007_create_relationships.sql
  0008_create_story_threads.sql
  0009_create_memory_chunks.sql       (includes pgvector index)

Phase 3 (Agent Orchestra):
  (no new tables — scene status changes, thread linking)
  0010_add_scene_parallel_support.sql (relax unique constraint)

Phase 4 (Multiplayer):
  0011_create_users.sql
  0012_create_player_characters.sql
  0013_add_world_owner.sql            (add owner_user_id to worlds)
  0014_create_notifications.sql
  0015_add_character_controller.sql   (add controller_type to characters)
```

### Key Constraint: Phase 1 Schema Is Additive-Only

Phase 2+ adds tables — it does not modify Phase 1 tables. The JSONB columns (`setting_details`, `traits`, `metadata`) absorb any flexible data needed before the next migration. This means Phase 1 migrations never need to be altered retroactively.

## 7. Query Patterns

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

**Semantic memory retrieval** (Phase 2+):
```sql
SELECT id, content, chunk_type, 1 - (embedding <=> $1) AS similarity
FROM memory_chunks
WHERE world_id = $2
ORDER BY embedding <=> $1
LIMIT $3;
-- Uses idx_memory_embedding (HNSW)
```

**Wiki search** (Phase 2+):
```sql
SELECT id, title, content, category, 1 - (embedding <=> $1) AS similarity
FROM wiki_pages
WHERE world_id = $2
ORDER BY embedding <=> $1
LIMIT $3;
-- Uses idx_wiki_embedding (HNSW)
```

### Write Paths

**Insert turn** (runs on every player action and narrator response):
```sql
INSERT INTO turns (scene_id, world_id, character_id, type, content, turn_number, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;
```

Turn number is determined by `SELECT COALESCE(MAX(turn_number), 0) + 1 FROM turns WHERE scene_id = $1`. In Phase 4 (multiplayer), this becomes a serializable transaction to prevent race conditions.

## 8. Data Lifecycle

### Turn Data
- **Created**: on every player action and narrator response
- **Modified**: never (append-only)
- **Deleted**: only on world deletion (CASCADE)
- **Archived**: not individually — world archival covers this

### Wiki Pages
- **Created**: by Archivist on first mention
- **Modified**: by Archivist when new information contradicts or extends existing entry
- **Deleted**: only on world deletion (CASCADE)

### Memory Chunks
- **Created**: by Archivist after each scene or periodically
- **Modified**: never (create new chunks, don't update old ones)
- **Deleted**: potentially by a future compaction process that merges old chunks

### Growth Estimates

For a single-player world with ~100 turns per session:
- `turns`: ~100 rows/session, ~1KB/row → ~100KB/session
- `wiki_pages`: ~10-20 pages after first session, growing slowly → ~50KB
- `memory_chunks`: ~5-10 per scene → ~20KB/session
- `timeline_events`: ~5-10 per session → ~10KB/session

A heavy-use world with 1000 turns would accumulate ~1MB of turn data, ~500KB of wiki, ~200KB of memory chunks. Well within single-instance Postgres capacity.

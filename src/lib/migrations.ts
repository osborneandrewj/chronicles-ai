import type Database from 'better-sqlite3'

export type Migration = {
  version: number
  name: string
  up: (db: Database.Database) => void
}

// Snapshot of the pre-v4 hardcoded premise + initial state. Used by migration 4
// to backfill existing turns into a default world so we don't lose the running
// chat. Kept verbatim here; the live copy in src/lib/prompt.ts / src/lib/state.ts
// is removed as part of v0.3 and replaced by per-world rows.
const LEGACY_PREMISE = `
You are the narrator of a solo interactive novel set in a quiet Cornish fishing village
in the late 1890s. The protagonist is a young letter-writer who has just returned home
after seven years away in London. The harbour is preparing for a storm; rumours about a
wrecked schooner circulate in the pub. The tone is literary, restrained, sensory.
`.trim()

const LEGACY_INITIAL_STATE = {
  time: 'Late afternoon, autumn 1897',
  location: 'Mevagissey harbour, Cornwall — pubs and quay still in view',
  identity:
    'Young letter-writer, recently returned home after seven years in London. Travel-worn, carrying a single case. Name not yet established.',
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_turns',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS turns (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
          content    TEXT    NOT NULL,
          state_json TEXT,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `)
      const cols = db.prepare("PRAGMA table_info('turns')").all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'state_json')) {
        db.exec('ALTER TABLE turns ADD COLUMN state_json TEXT')
      }
    },
  },
  {
    version: 2,
    name: 'split_turn_states',
    up: (db) => {
      db.exec(`
        CREATE TABLE turn_states (
          turn_id    INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
          state_json TEXT    NOT NULL,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO turn_states (turn_id, state_json, created_at)
          SELECT id, state_json, created_at FROM turns WHERE state_json IS NOT NULL;
        ALTER TABLE turns DROP COLUMN state_json;
      `)
    },
  },
  {
    version: 3,
    name: 'turn_metadata',
    up: (db) => {
      db.exec('ALTER TABLE turns ADD COLUMN metadata TEXT')
    },
  },
  {
    // v0.3 — open the schema. Introduces a `worlds` table and scopes every
    // existing turn / turn_state to a world. SQLite can't add a NOT NULL FK
    // column in place, so we rebuild both tables with the standard
    // create-new + copy + drop + rename dance. runMigrations() disables
    // foreign_keys around the migration run so dropping `turns` while
    // `turn_states` still references it does not abort.
    version: 4,
    name: 'worlds',
    up: (db) => {
      db.exec(`
        CREATE TABLE worlds (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          name               TEXT    NOT NULL,
          premise            TEXT    NOT NULL,
          initial_state_json TEXT    NOT NULL,
          created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `)

      const insertWorld = db.prepare<[string, string, string]>(
        'INSERT INTO worlds (name, premise, initial_state_json) VALUES (?, ?, ?) RETURNING id',
      )
      const defaultWorld = insertWorld.get(
        'Mevagissey 1897',
        LEGACY_PREMISE,
        JSON.stringify(LEGACY_INITIAL_STATE),
      ) as { id: number }
      const defaultWorldId = defaultWorld.id

      db.exec(`
        CREATE TABLE turns_new (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id   INTEGER NOT NULL REFERENCES worlds(id),
          role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
          content    TEXT    NOT NULL,
          metadata   TEXT,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `)
      db.prepare(
        `INSERT INTO turns_new (id, world_id, role, content, metadata, created_at)
         SELECT id, ?, role, content, metadata, created_at FROM turns`,
      ).run(defaultWorldId)
      db.exec('DROP TABLE turns; ALTER TABLE turns_new RENAME TO turns;')

      db.exec(`
        CREATE TABLE turn_states_new (
          turn_id    INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
          world_id   INTEGER NOT NULL REFERENCES worlds(id),
          state_json TEXT    NOT NULL,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `)
      db.prepare(
        `INSERT INTO turn_states_new (turn_id, world_id, state_json, created_at)
         SELECT turn_id, ?, state_json, created_at FROM turn_states`,
      ).run(defaultWorldId)
      db.exec('DROP TABLE turn_states; ALTER TABLE turn_states_new RENAME TO turn_states;')

      // ALTER TABLE ... RENAME leaves a stale entry in sqlite_sequence for the
      // pre-rename name. Reset turns' autoincrement counter to the actual MAX(id)
      // so the next inserted turn lands at the right place.
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('turns', 'turns_new');")
      db.exec(
        `INSERT INTO sqlite_sequence (name, seq)
         SELECT 'turns', COALESCE(MAX(id), 0) FROM turns`,
      )

      db.exec('CREATE INDEX turns_world_id_id ON turns(world_id, id);')
      db.exec('CREATE INDEX turn_states_world_id_turn_id ON turn_states(world_id, turn_id);')
    },
  },
  {
    // v0.5 — replace the turn_states JSON blob with typed entity rows.
    // Creates characters / places / scenes; adds turns.scene_id and
    // worlds.current_time / current_scene_id. Backfill seeds one player
    // character, one place, and scene 1 per existing world by parsing
    // the latest turn_states.state_json (or initial_state_json as fallback).
    // Existing turns are reassigned to scene 1. Then drops turn_states.
    // runMigrations() disables foreign_keys around the run, so we can DROP
    // turn_states without violating its references to turns / worlds.
    version: 5,
    name: 'typed_world_state',
    up: (db) => {
      // IF NOT EXISTS is belt-and-braces: runMigrations() already wraps
      // each m.up() in a transaction (see line ~315), so a kill mid-DDL
      // rolls back via WAL and a retry starts fresh. Guarding anyway in
      // case a future driver change reorders that.
      db.exec(`
        CREATE TABLE IF NOT EXISTS characters (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id          INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          name              TEXT    NOT NULL,
          description       TEXT,
          is_player         INTEGER NOT NULL DEFAULT 0,
          current_place_id  INTEGER REFERENCES places(id) ON DELETE SET NULL,
          memorable_facts   TEXT,
          voice_id          TEXT,
          status            TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','dead')),
          traits_json       TEXT,
          created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS characters_world_id ON characters(world_id);
        CREATE UNIQUE INDEX IF NOT EXISTS characters_world_name ON characters(world_id, lower(name));

        CREATE TABLE IF NOT EXISTS places (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id    INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          name        TEXT    NOT NULL,
          description TEXT,
          kind        TEXT,
          created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS places_world_id ON places(world_id);
        CREATE UNIQUE INDEX IF NOT EXISTS places_world_name ON places(world_id, lower(name));

        CREATE TABLE IF NOT EXISTS scenes (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id        INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          place_id        INTEGER REFERENCES places(id) ON DELETE SET NULL,
          title           TEXT    NOT NULL,
          summary         TEXT,
          scene_number    INTEGER NOT NULL,
          status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
          opened_at_turn  INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          closed_at_turn  INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS scenes_world_id ON scenes(world_id);
        CREATE UNIQUE INDEX IF NOT EXISTS scenes_world_number ON scenes(world_id, scene_number);
      `)

      // SQLite permits ALTER TABLE ADD COLUMN with a REFERENCES clause only
      // when the column's default is NULL. All three of these qualify.
      db.exec('ALTER TABLE turns ADD COLUMN scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL')
      db.exec('CREATE INDEX turns_scene_id ON turns(scene_id)')
      // Note: not `current_time` — that bare identifier is interpreted as the
      // SQLite reserved keyword `CURRENT_TIME` in queries, returning the system
      // clock instead of the column value. `world_time` sidesteps the trap.
      db.exec('ALTER TABLE worlds ADD COLUMN world_time TEXT')
      db.exec(
        'ALTER TABLE worlds ADD COLUMN current_scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL',
      )

      // Backfill: one player + one place + scene 1 per world, seeded from
      // the world's most recent turn_states.state_json (or initial_state_json
      // when the world has no turn_states yet).
      const worlds = db
        .prepare('SELECT id, initial_state_json FROM worlds')
        .all() as Array<{ id: number; initial_state_json: string }>

      const latestStateStmt = db.prepare<[number]>(
        `SELECT state_json FROM turn_states
         WHERE world_id = ?
         ORDER BY turn_id DESC
         LIMIT 1`,
      )
      const firstTurnStmt = db.prepare<[number]>(
        'SELECT MIN(id) as id FROM turns WHERE world_id = ?',
      )
      const insertPlace = db.prepare<[number, string, string]>(
        `INSERT INTO places (world_id, name, description) VALUES (?, ?, ?) RETURNING id`,
      )
      const insertCharacter = db.prepare<[number, string, string, number]>(
        `INSERT INTO characters (world_id, name, description, is_player, current_place_id)
         VALUES (?, ?, ?, 1, ?) RETURNING id`,
      )
      const insertScene = db.prepare<[number, number, number | null]>(
        `INSERT INTO scenes (world_id, place_id, title, scene_number, status, opened_at_turn)
         VALUES (?, ?, 'Scene 1', 1, 'active', ?) RETURNING id`,
      )
      const assignTurns = db.prepare<[number, number]>(
        'UPDATE turns SET scene_id = ? WHERE world_id = ?',
      )
      const setWorldCursor = db.prepare<[string, number, number]>(
        'UPDATE worlds SET world_time = ?, current_scene_id = ? WHERE id = ?',
      )

      for (const w of worlds) {
        const latest = latestStateStmt.get(w.id) as { state_json: string } | undefined
        const sourceJson = latest?.state_json ?? w.initial_state_json
        const parsed = parseLegacyState(sourceJson)

        const placeName = derivePlaceName(parsed.location)
        const place = insertPlace.get(w.id, placeName, parsed.location) as { id: number }
        insertCharacter.run(w.id, 'Player', parsed.identity, place.id)

        const firstTurn = firstTurnStmt.get(w.id) as { id: number | null }
        const scene = insertScene.get(w.id, place.id, firstTurn.id ?? null) as { id: number }

        assignTurns.run(scene.id, w.id)
        setWorldCursor.run(parsed.time, scene.id, w.id)
      }

      db.exec('DROP TABLE turn_states')
    },
  },
  {
    // v0.6.1 — give NPCs lightweight dynamic state. `active_goal` is what an
    // NPC wants right now (e.g. "sell the player a room"); `current_attitude`
    // shapes *how* they pursue it (e.g. "polite but increasingly afraid").
    // Both are nullable — existing rows get NULL meaning "unknown / not yet
    // tracked", and the narrator/archivist treat NULL as no constraint.
    // Two ALTER TABLE ADDs are reversible in principle (SQLite 3.35+ supports
    // DROP COLUMN); no backfill needed.
    version: 6,
    name: 'npc_goal_attitude',
    up: (db) => {
      db.exec('ALTER TABLE characters ADD COLUMN active_goal TEXT')
      db.exec('ALTER TABLE characters ADD COLUMN current_attitude TEXT')
    },
  },
  {
    // v0.6.2 — per-character observations of the protagonist. Append-only
    // newline-separated string with `[t:N]` provenance suffixes, identical
    // storage shape to memorable_facts. Used by the narrator to let present
    // NPCs notice and react to unusual protagonist behavior (repeated lines,
    // agitation, dissociation) instead of replaying first-time deliveries.
    // Existing rows get NULL meaning "nothing observed yet".
    version: 7,
    name: 'character_observations',
    up: (db) => {
      db.exec('ALTER TABLE characters ADD COLUMN observations TEXT')
    },
  },
  {
    // v0.6.2 — agentic NPCs. Two-tier system: most NPCs stay 'npc' (narrator
    // handles entirely), promoted NPCs become 'agent' and get a per-turn Haiku
    // call that updates their own goals, focus, activity log, and location —
    // so the world keeps moving while the protagonist is elsewhere. Auto-
    // promotion is deterministic: appearance_count is bumped each turn the NPC
    // is present, and at threshold the apply layer flips agency_level. All
    // new columns are nullable except agency_level + appearance_count which
    // default to safe values; no backfill needed.
    version: 8,
    name: 'agentic_npcs',
    up: (db) => {
      db.exec("ALTER TABLE characters ADD COLUMN agency_level TEXT NOT NULL DEFAULT 'npc'")
      db.exec('ALTER TABLE characters ADD COLUMN personal_goals TEXT')
      db.exec('ALTER TABLE characters ADD COLUMN current_focus TEXT')
      db.exec('ALTER TABLE characters ADD COLUMN recent_activity TEXT')
      db.exec('ALTER TABLE characters ADD COLUMN appearance_count INTEGER NOT NULL DEFAULT 0')
    },
  },
  {
    // v0.6.4 — tiered NPC attention. Replace the binary npc/agent idea with
    // proximity-based tiers stored in agency_level:
    // local (same scene, every turn), nearby (recently present, slower),
    // distant (offscreen but still relevant), dormant (remembered, no ticks),
    // npc (passive). Existing agent rows become nearby and will be promoted to
    // local the next time they are present. The turn-id fields let scheduling
    // happen deterministically without extra model calls.
    version: 9,
    name: 'tiered_npc_attention',
    up: (db) => {
      db.exec('ALTER TABLE characters ADD COLUMN last_seen_turn_id INTEGER')
      db.exec('ALTER TABLE characters ADD COLUMN last_agent_tick_turn_id INTEGER')
      db.exec("UPDATE characters SET agency_level = 'nearby' WHERE agency_level = 'agent'")
    },
  },
  {
    // v0.6.5 — expose scene update times to the UI. Characters and places
    // already had updated_at from v5; scenes only had created_at, which made
    // completed-scene state look timeless in the inspector.
    version: 10,
    name: 'scene_updated_at',
    up: (db) => {
      db.exec('ALTER TABLE scenes ADD COLUMN updated_at TEXT')
      db.exec('UPDATE scenes SET updated_at = created_at WHERE updated_at IS NULL')
    },
  },
  {
    // v0.6.4 — story dossier memory. Entity rows tell the narrator who and
    // where; these tables tell it what is currently playable: active threads,
    // objectives, clues, resources, and concise timeline beats.
    version: 11,
    name: 'story_dossier',
    up: (db) => {
      db.exec(`
        CREATE TABLE story_threads (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id         INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          title            TEXT    NOT NULL,
          status           TEXT    NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','resolved','failed','dormant')),
          summary          TEXT,
          stakes           TEXT,
          hidden           TEXT,
          source_turn_id   INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          resolved_turn_id INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX story_threads_world_id ON story_threads(world_id);
        CREATE UNIQUE INDEX story_threads_world_title ON story_threads(world_id, lower(title));

        CREATE TABLE story_clues (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id       INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          thread_id      INTEGER REFERENCES story_threads(id) ON DELETE SET NULL,
          title          TEXT    NOT NULL,
          detail         TEXT,
          implication    TEXT,
          status         TEXT    NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','interpreted','spent','false_lead')),
          source_turn_id INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX story_clues_world_id ON story_clues(world_id);
        CREATE UNIQUE INDEX story_clues_world_title ON story_clues(world_id, lower(title));

        CREATE TABLE story_objectives (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id          INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          thread_id         INTEGER REFERENCES story_threads(id) ON DELETE SET NULL,
          title             TEXT    NOT NULL,
          status            TEXT    NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','blocked','completed','failed')),
          detail            TEXT,
          blocker           TEXT,
          source_turn_id    INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          completed_turn_id INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX story_objectives_world_id ON story_objectives(world_id);
        CREATE UNIQUE INDEX story_objectives_world_title ON story_objectives(world_id, lower(title));

        CREATE TABLE story_resources (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id           INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          owner_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
          name               TEXT    NOT NULL,
          kind               TEXT,
          status             TEXT,
          detail             TEXT,
          source_turn_id     INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX story_resources_world_id ON story_resources(world_id);
        CREATE UNIQUE INDEX story_resources_world_name ON story_resources(world_id, lower(name));

        CREATE TABLE timeline_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id    INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          turn_id     INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          world_time  TEXT,
          title       TEXT    NOT NULL,
          summary     TEXT    NOT NULL,
          importance  INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
          created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX timeline_events_world_id ON timeline_events(world_id);
        CREATE INDEX timeline_events_world_importance ON timeline_events(world_id, importance, id);
      `)
    },
  },
  {
    // v0.6.4 — quest/timeline refinement for the story dossier. Threads can
    // now identify their story function (quest, mystery, threat, relationship,
    // background), carry explicit rewards/consequences, and timeline events
    // can point back to the relevant thread.
    version: 12,
    name: 'story_dossier_quests_timeline',
    up: (db) => {
      db.exec(`
        ALTER TABLE story_threads ADD COLUMN kind TEXT NOT NULL DEFAULT 'mystery'
          CHECK (kind IN ('quest','mystery','threat','relationship','background'));
        ALTER TABLE story_threads ADD COLUMN rewards TEXT;
        ALTER TABLE story_threads ADD COLUMN consequences TEXT;
        ALTER TABLE timeline_events ADD COLUMN thread_id INTEGER REFERENCES story_threads(id) ON DELETE SET NULL;
        CREATE INDEX timeline_events_thread_id ON timeline_events(thread_id);
      `)
    },
  },
  {
    // v0.6.6 — player-asserted canon and correction scrollback. `player_notes`
    // on characters and places is the home for things the player tells the
    // archivist directly ("I drive a Subaru", "Maeve is my sister"). The
    // normal narrator-extraction archivist path is forbidden from writing it
    // — only the correction path may. `world_corrections` is the audit log /
    // scrollback the inspector's Archivist tab reads from.
    version: 13,
    name: 'player_canon_and_corrections',
    up: (db) => {
      db.exec('ALTER TABLE characters ADD COLUMN player_notes TEXT')
      db.exec('ALTER TABLE places ADD COLUMN player_notes TEXT')
      db.exec(`
        CREATE TABLE world_corrections (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id        INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          turn_id         INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          player_text     TEXT    NOT NULL,
          archivist_reply TEXT    NOT NULL,
          applied_patch   TEXT    NOT NULL,
          created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX world_corrections_world_created
          ON world_corrections (world_id, created_at DESC);
      `)
    },
  },
  {
    // v0.6.6 — tiny per-world TTS replay cache. Keeps the most recent few
    // generated narration audio files so Replay can reuse them without another
    // TTS call. The cache key includes model_key + voice_id + text_hash so a
    // future voice/model picker naturally regenerates when the selection
    // changes.
    version: 14,
    name: 'tts_audio_cache',
    up: (db) => {
      db.exec(`
        CREATE TABLE tts_audio_cache (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id     INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          turn_id      INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          model_key    TEXT    NOT NULL,
          voice_id     TEXT    NOT NULL,
          text_hash    TEXT    NOT NULL,
          content_type TEXT    NOT NULL,
          audio        BLOB    NOT NULL,
          byte_length  INTEGER NOT NULL,
          created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
          accessed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE (world_id, turn_id, model_key, voice_id, text_hash)
        );
        CREATE INDEX tts_audio_cache_world_accessed
          ON tts_audio_cache (world_id, accessed_at DESC, id DESC);
      `)
    },
  },
  {
    // v0.6.7 — richer NPC cognition. These fields are narrator-visible but
    // not automatically player-visible: they let agent-tier NPCs carry private
    // beliefs, a relationship anchor to the protagonist, a durable agenda, and
    // explicit diegetic tools without bloating ordinary memorable facts.
    version: 15,
    name: 'npc_cognition',
    up: (db) => {
      db.exec('ALTER TABLE characters ADD COLUMN private_beliefs TEXT')
      db.exec('ALTER TABLE characters ADD COLUMN relationship_to_player TEXT')
      db.exec('ALTER TABLE characters ADD COLUMN long_term_agenda TEXT')
      db.exec('ALTER TABLE characters ADD COLUMN tool_access TEXT')
    },
  },
  {
    // v0.6.7 — NPC reveries. A reverie is a charged memory or association
    // that can flare when the current scene rhymes with it, shaping behavior
    // without exposing hidden motives as narrator explanation.
    version: 16,
    name: 'npc_reveries',
    up: (db) => {
      db.exec('ALTER TABLE characters ADD COLUMN reveries TEXT')
    },
  },
  {
    // v0.6.8 — real-world geography anchors. `worlds.setting_region` is a
    // free-text "City, State/Country" string (e.g. "Hayden, Idaho, USA")
    // used as a Nominatim viewbox bias when geocoding places, so "Super 1"
    // resolves to the right town. The places.osm_* columns cache the
    // resolved anchor so both the narrator and the (tool-less) NPC agent
    // see the same authoritative street/neighborhood facts. geo_status
    // tracks resolution outcome so we don't retry on every read.
    version: 17,
    name: 'place_geo_anchors',
    up: (db) => {
      db.exec('ALTER TABLE worlds ADD COLUMN setting_region TEXT')
      db.exec('ALTER TABLE places ADD COLUMN osm_display_name TEXT')
      db.exec('ALTER TABLE places ADD COLUMN osm_street TEXT')
      db.exec('ALTER TABLE places ADD COLUMN osm_neighborhood TEXT')
      db.exec('ALTER TABLE places ADD COLUMN osm_lat REAL')
      db.exec('ALTER TABLE places ADD COLUMN osm_lng REAL')
      db.exec(
        `ALTER TABLE places ADD COLUMN geo_status TEXT NOT NULL DEFAULT 'unresolved'`,
      )
      db.exec('ALTER TABLE places ADD COLUMN geo_resolved_at TEXT')
    },
  },
  {
    // v0.6.8 — NPC journey state. Lets off-scene NPCs move in the background
    // across multiple turns without teleporting. `in_transit_to_place_id` is
    // the destination they are heading to (null when stationary).
    // `arrival_world_time` is when they're expected to arrive (free-text
    // world-clock string, e.g. "11:36 AM"). `last_known_situation` is a
    // short present-tense snapshot of their physical state — distinct from
    // `current_focus` (mental) — that the narrator reads when staging
    // off-scene dialogue (phone calls, messages, references).
    version: 18,
    name: 'npc_journey_state',
    up: (db) => {
      db.exec(
        'ALTER TABLE characters ADD COLUMN in_transit_to_place_id INTEGER REFERENCES places(id) ON DELETE SET NULL',
      )
      db.exec('ALTER TABLE characters ADD COLUMN arrival_world_time TEXT')
      db.exec('ALTER TABLE characters ADD COLUMN last_known_situation TEXT')
    },
  },
  {
    // v0.6.8 — character aliases. Newline-separated alternate descriptors
    // that resolve to the same canonical character row. Lets the archivist
    // record "the man at the gyro van" + "the man in the canvas vest" as
    // aliases on a single entity rather than minting a new row for each
    // descriptor variant. The player-correction channel already used the
    // word "aliases" for an in-memory merge directive — this column is the
    // first persistent home for them.
    version: 19,
    name: 'character_aliases',
    up: (db) => {
      db.exec('ALTER TABLE characters ADD COLUMN aliases TEXT')
    },
  },
  {
    // v0.6.9 — npc intent ledger. The NPC agent already plans actions before
    // the narrator runs, but until now those plans only existed as prompt text
    // and per-turn metadata. This table makes each plan a durable row that the
    // post-narrator reconciliation step can label as staged/modified/ignored/
    // contradicted. The next NPC agent tick reads recent outcomes so an agent
    // whose plans the narrator keeps ignoring can react to that friction.
    //
    // The schema also installs `expected_visibility` as cheap groundwork for a
    // future narrator-blind memory model. v0.6.9 itself does not enforce full
    // visibility semantics — every intent defaults to `narrator`-visible.
    version: 20,
    name: 'npc_intents',
    up: (db) => {
      db.exec(`
        CREATE TABLE npc_intents (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id              INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          character_id          INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          player_turn_id        INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          narrator_turn_id      INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          agency_level          TEXT NOT NULL,
          intent_text           TEXT NOT NULL,
          planned_action        TEXT NOT NULL,
          intent_type           TEXT,
          target_character_id   INTEGER REFERENCES characters(id) ON DELETE SET NULL,
          target_place_id       INTEGER REFERENCES places(id) ON DELETE SET NULL,
          private_rationale     TEXT,
          expected_visibility   TEXT NOT NULL DEFAULT 'narrator'
                                CHECK (expected_visibility IN ('public','narrator','npc_private','narrator_blind')),
          narrator_disposition  TEXT
                                CHECK (narrator_disposition IN ('staged','modified','ignored','contradicted')),
          narrator_interpretation TEXT,
          outcome_summary       TEXT,
          resolved_outcome      TEXT,
          reconciliation_confidence REAL
                                CHECK (reconciliation_confidence IS NULL OR
                                       (reconciliation_confidence >= 0 AND reconciliation_confidence <= 1)),
          archived_patch        TEXT,
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX npc_intents_world_turn ON npc_intents(world_id, player_turn_id);
        CREATE INDEX npc_intents_character ON npc_intents(character_id, id);
        CREATE INDEX npc_intents_pending ON npc_intents(world_id, narrator_turn_id)
          WHERE narrator_turn_id IS NULL;
      `)
    },
  },
  {
    // v0.6.10 — scene prose pacing. The Archivist records a compact
    // scene-level read on mood, pace, and focus after each narrator turn.
    // The Narrator sees these as a dial for prose length/rhythm: slower and
    // atmospheric scenes can breathe, while violent/dialogue beats contract.
    version: 21,
    name: 'scene_pacing_context',
    up: (db) => {
      db.exec(`
        ALTER TABLE scenes ADD COLUMN scene_mood TEXT
          CHECK (scene_mood IN ('atmospheric','tense','violent','intimate','wondrous'));
        ALTER TABLE scenes ADD COLUMN pace TEXT
          CHECK (pace IN ('slow','medium','fast'));
        ALTER TABLE scenes ADD COLUMN focus TEXT
          CHECK (focus IN ('environment','characters','action','internal'));
      `)
    },
  },
  {
    // v0.6.13 — Living Place Simulation v1. Places generate a bounded,
    // deterministic occupancy snapshot (crowds, staff, traffic) plus latent
    // encounter hooks that bridge the ambient world to the story dossier.
    // story_threads gain relevance_tags_json so the deterministic matcher can
    // connect an active thread to a place/occupant by tag overlap.
    version: 22,
    name: 'living_place_simulation',
    up: (db) => {
      db.exec(`
        CREATE TABLE place_profiles (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id              INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          place_id              INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
          profile_kind          TEXT NOT NULL,
          capacity_min          INTEGER NOT NULL DEFAULT 0,
          capacity_max          INTEGER NOT NULL DEFAULT 6,
          typical_roles_json    TEXT NOT NULL DEFAULT '[]',
          open_hours_json       TEXT,
          traffic_level         TEXT NOT NULL DEFAULT 'medium'
                                CHECK (traffic_level IN ('none','low','medium','high','surge')),
          ambience_tags_json    TEXT NOT NULL DEFAULT '[]',
          match_tags_json       TEXT NOT NULL DEFAULT '[]',
          encounter_rules_json  TEXT NOT NULL DEFAULT '[]',
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(world_id, place_id)
        );

        CREATE TABLE population_templates (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id              INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          place_profile_kind    TEXT,
          role                  TEXT NOT NULL,
          label                 TEXT NOT NULL,
          description           TEXT,
          behavior_tags_json    TEXT NOT NULL DEFAULT '[]',
          match_tags_json       TEXT NOT NULL DEFAULT '[]',
          seed_premise          TEXT,
          promotable            INTEGER NOT NULL DEFAULT 0,
          weight                INTEGER NOT NULL DEFAULT 1,
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE place_occupancy_snapshots (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id              INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
          place_id              INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
          scene_id              INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
          source_turn_id        INTEGER REFERENCES turns(id) ON DELETE SET NULL,
          world_time            TEXT,
          occupancy_json        TEXT NOT NULL,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX place_profiles_world_place ON place_profiles(world_id, place_id);
        CREATE INDEX population_templates_world_role ON population_templates(world_id, role);
        CREATE INDEX occupancy_world_place_scene ON place_occupancy_snapshots(world_id, place_id, scene_id, id);
      `)
      // SQLite permits ALTER TABLE ADD COLUMN with a non-NULL default only when
      // the default is a literal constant. '[]' qualifies. No REFERENCES here.
      db.exec("ALTER TABLE story_threads ADD COLUMN relevance_tags_json TEXT NOT NULL DEFAULT '[]'")
    },
  },
]

// Backfill helpers (v5). Kept local to migrations.ts because they only run
// inside the v5 up() and have no callers elsewhere.

type LegacyState = { time: string; location: string; identity: string }

const LEGACY_STATE_FALLBACK: LegacyState = {
  time: 'Day 1, morning',
  location: 'Opening scene',
  identity: 'Newcomer — name not yet established.',
}

function parseLegacyState(json: string | null): LegacyState {
  if (!json) return LEGACY_STATE_FALLBACK
  try {
    const obj = JSON.parse(json) as Partial<LegacyState>
    return {
      time: obj.time ?? LEGACY_STATE_FALLBACK.time,
      location: obj.location ?? LEGACY_STATE_FALLBACK.location,
      identity: obj.identity ?? LEGACY_STATE_FALLBACK.identity,
    }
  } catch {
    return LEGACY_STATE_FALLBACK
  }
}

// The legacy `location` field is paragraph-long prose. As a place *name* we
// want a short anchor (the leading clause), keeping the full prose in the
// place's description column. Split on the first em-dash, en-dash, period,
// or comma and cap at 80 chars.
function derivePlaceName(location: string): string {
  const head = location.split(/[—–.,]/)[0]?.trim() ?? location
  const cleaned = head.length > 0 ? head : location.trim()
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned
}

export function runMigrations(db: Database.Database): void {
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
  if (pending.length === 0) return

  // SQLite refuses to change `foreign_keys` inside a transaction. We disable
  // them around the whole run so rebuild-style migrations (v4) can drop and
  // recreate tables that participate in FK relationships, then verify and
  // re-enable. Pragmas outside a transaction take effect immediately.
  db.pragma('foreign_keys = OFF')
  try {
    for (const m of pending) {
      const tx = db.transaction(() => {
        m.up(db)
        db.pragma(`user_version = ${m.version}`)
      })
      tx()
    }
    const violations = db.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      throw new Error(`Foreign key violations after migration: ${JSON.stringify(violations)}`)
    }
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

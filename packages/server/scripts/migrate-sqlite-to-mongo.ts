// scripts/migrate-sqlite-to-mongo.ts  (P3 — spec §4.9, §5.1-P3)
//
// One-off, IDEMPOTENT backfill of the live better-sqlite3 file into MongoDB,
// reusing the P2 Mongoose models (the only schema; this script hand-rolls
// nothing). Run via tsx with the `react-server` condition so the `server-only`
// marker on the adapter resolves to its no-op:
//
//   DATABASE_PATH=./backups/chronicles.copy.sqlite \
//   DATABASE_URL='mongodb://localhost:27017/chronicles?replicaSet=rs0' \
//   npx tsx --conditions=react-server packages/server/scripts/migrate-sqlite-to-mongo.ts
//
// DO NOT run against prod without a fresh backup (CLAUDE.md data-repair rule);
// run against a COPY. createIndexes runs AFTER bulk insert so any latent
// duplicate that SQLite's UNIQUE(world_id, lower(name)) was silently preventing
// surfaces as E11000 instead of producing dual rows.
//
// As-built P2 invariant this script honors: the shipped Mongo schema keeps a
// denormalized integer `worldId` plus a monotone integer `id` on every
// collection (turns use `seq`) — the ports speak `number` ids byte-compatibly
// with the SQLite autoincrement, so FK columns are copied VERBATIM as integers
// (no ObjectId rewrite). `turns.id` is preserved as `seq` because `[t:N]`
// provenance tags reference it.

import Database from 'better-sqlite3'

import { connectMongo } from '@/infrastructure/persistence/mongo/connection'
import { buildModels } from '@/infrastructure/persistence/mongo/models'

type Row = Record<string, unknown>

function str(v: unknown): string | null {
  return v == null ? null : String(v)
}
function num(v: unknown): number | null {
  return v == null ? null : Number(v)
}
function reqNum(v: unknown): number {
  return Number(v)
}
function reqStr(v: unknown): string {
  return v == null ? '' : String(v)
}
function flag(v: unknown): boolean {
  return Number(v) === 1
}
function date(v: unknown): Date {
  // SQLite datetime('now') renders 'YYYY-MM-DD HH:MM:SS' (UTC). Treat a bare
  // space-separated stamp as UTC so the round-trip is stable.
  if (v == null) return new Date(0)
  const s = String(v)
  const iso = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)
    ? s.replace(' ', 'T') + 'Z'
    : s
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? new Date(0) : d
}
function nullableDate(v: unknown): Date | null {
  return v == null ? null : date(v)
}

/** Parse a TEXT-JSON column into a native subdoc; null/blank → fallback. */
function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  const s = String(v).trim()
  if (s === '') return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function lower(v: unknown): string {
  return String(v ?? '').toLowerCase()
}

/** True if the table exists in the SQLite snapshot (older copies may lack some). */
function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name)
  return Boolean(row)
}

function selectAll(sqlite: Database.Database, table: string): Row[] {
  if (!tableExists(sqlite, table)) return []
  return sqlite.prepare(`SELECT * FROM ${table}`).all() as Row[]
}

// Minimal model surface the upsert helpers need. The concrete Mongoose models
// satisfy this; we keep deciding logic out — these are dumb writes of already-
// translated docs. The enum-typed Doc fields (role/status/kind/…) are produced
// from untyped SQLite rows, so the helper accepts loose `Row` replacements and
// casts at the single boundary below (migration code; the rows were validated
// by SQLite's own CHECK constraints before export).
type UpsertModel = {
  bulkWrite(ops: unknown[], opts: { ordered: boolean }): Promise<unknown>
  replaceOne(filter: unknown, doc: unknown, opts: { upsert: boolean }): Promise<unknown>
}

/** Bulk replaceOne(upsert) keyed on a stable integer id field (idempotent). */
async function bulkUpsert(
  model: UpsertModel,
  key: string,
  docs: Row[],
): Promise<void> {
  if (docs.length === 0) return
  await model.bulkWrite(
    docs.map((d) => ({
      replaceOne: { filter: { [key]: d[key] }, replacement: d, upsert: true },
    })),
    { ordered: false },
  )
}

/** Single replaceOne(upsert) keyed on `id` (for the lower-volume tables). */
async function upsertById(model: UpsertModel, doc: Row): Promise<void> {
  await model.replaceOne({ id: doc.id }, doc, { upsert: true })
}

async function main(): Promise<void> {
  const databasePath = process.env.DATABASE_PATH
  const databaseUrl = process.env.DATABASE_URL
  if (!databasePath) throw new Error('DATABASE_PATH (path to the SQLite COPY) is required')
  if (!databaseUrl) throw new Error('DATABASE_URL (Mongo connection string) is required')

  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true })
  const connection = await connectMongo(databaseUrl)
  const models = buildModels(connection)

  // Idempotency: a stable integer `id`/`seq` is the natural upsert key on every
  // collection, so re-running replaces the same doc rather than duplicating.
  // We use bulkWrite replaceOne(upsert) keyed on { id } (or { seq } for turns).

  // Cast each concrete model to the dumb-write surface at the single boundary
  // where untyped SQLite rows meet the strict Doc enums (migration code).
  const m = models as unknown as Record<keyof typeof models, UpsertModel>

  // -- worlds -------------------------------------------------------------
  const worlds = selectAll(sqlite, 'worlds')
  await bulkUpsert(
    m.World,
    'id',
    worlds.map((w) => ({
      id: reqNum(w.id),
      name: reqStr(w.name),
      premise: reqStr(w.premise),
      initialState: parseJson<Record<string, unknown> | null>(w.initial_state_json, null),
      settingRegion: str(w.setting_region),
      worldTime: str(w.world_time),
      currentSceneId: num(w.current_scene_id),
      archivedAt: nullableDate(w.archived_at),
      createdAt: date(w.created_at),
    })),
  )

  // -- places (+ fold place_profiles into `profile`) ----------------------
  const places = selectAll(sqlite, 'places')
  const profileByPlaceId = new Map<number, Row>()
  for (const p of selectAll(sqlite, 'place_profiles')) {
    profileByPlaceId.set(reqNum(p.place_id), p)
  }
  await bulkUpsert(
    m.Place,
    'id',
    places.map((p) => {
      const prof = profileByPlaceId.get(reqNum(p.id))
      return {
        id: reqNum(p.id),
        worldId: reqNum(p.world_id),
        name: reqStr(p.name),
        nameKey: lower(p.name),
        description: str(p.description),
        kind: str(p.kind),
        playerNotes: str(p.player_notes),
        geo: {
          displayName: str(p.osm_display_name),
          street: str(p.osm_street),
          neighborhood: str(p.osm_neighborhood),
          lat: num(p.osm_lat),
          lng: num(p.osm_lng),
          status: str(p.geo_status) ?? 'unresolved',
          resolvedAt: nullableDate(p.geo_resolved_at),
        },
        profile: prof
          ? {
              profileKind: reqStr(prof.profile_kind),
              capacityMin: reqNum(prof.capacity_min),
              capacityMax: reqNum(prof.capacity_max),
              typicalRolesJson: reqStr(prof.typical_roles_json),
              openHoursJson: str(prof.open_hours_json),
              ambienceTagsJson: reqStr(prof.ambience_tags_json),
              matchTagsJson: reqStr(prof.match_tags_json),
              encounterRulesJson: reqStr(prof.encounter_rules_json),
              trafficLevel: str(prof.traffic_level) ?? 'low',
            }
          : null,
        createdAt: date(p.created_at),
        updatedAt: date(p.updated_at),
      }
    }),
  )

  // -- scenes -------------------------------------------------------------
  const scenes = selectAll(sqlite, 'scenes')
  await bulkUpsert(
    m.Scene,
    'id',
    scenes.map((s) => ({
      id: reqNum(s.id),
      worldId: reqNum(s.world_id),
      placeId: num(s.place_id),
      title: reqStr(s.title),
      summary: str(s.summary),
      sceneNumber: reqNum(s.scene_number),
      status: str(s.status) ?? 'active',
      sceneMood: str(s.scene_mood),
      pace: str(s.pace),
      focus: str(s.focus),
      openedAtTurn: num(s.opened_at_turn),
      closedAtTurn: num(s.closed_at_turn),
      createdAt: date(s.created_at),
      updatedAt: date(s.updated_at ?? s.created_at),
    })),
  )

  // -- characters (traits/daily_loop JSON-text → native subdocs) ----------
  const characters = selectAll(sqlite, 'characters')
  await bulkUpsert(
    m.Character,
    'id',
    characters.map((c) => ({
      id: reqNum(c.id),
      worldId: reqNum(c.world_id),
      name: reqStr(c.name),
      nameKey: lower(c.name),
      description: str(c.description),
      isPlayer: flag(c.is_player),
      currentPlaceId: num(c.current_place_id),
      inTransitToPlaceId: num(c.in_transit_to_place_id),
      arrivalWorldTime: str(c.arrival_world_time),
      status: str(c.status) ?? 'active',
      agencyLevel: str(c.agency_level) ?? 'npc',
      // Append-only [t:N]-tagged free text stays a string (provenance is
      // inside the string).
      memorableFacts: str(c.memorable_facts),
      observations: str(c.observations),
      aliases: str(c.aliases),
      activeGoal: str(c.active_goal),
      currentAttitude: str(c.current_attitude),
      personalGoals: str(c.personal_goals),
      currentFocus: str(c.current_focus),
      recentActivity: str(c.recent_activity),
      privateBeliefs: str(c.private_beliefs),
      reveries: str(c.reveries),
      relationshipToPlayer: str(c.relationship_to_player),
      longTermAgenda: str(c.long_term_agenda),
      toolAccess: str(c.tool_access),
      playerNotes: str(c.player_notes),
      lastKnownSituation: str(c.last_known_situation),
      traits: parseJson<Record<string, unknown> | null>(c.traits_json, null),
      dailyLoop: parseJson<Record<string, unknown> | null>(c.daily_loop, null),
      appearanceCount: reqNum(c.appearance_count ?? 0),
      lastSeenTurnId: num(c.last_seen_turn_id),
      lastAgentTickTurnId: num(c.last_agent_tick_turn_id),
      createdAt: date(c.created_at),
      updatedAt: date(c.updated_at),
    })),
  )

  // -- story_threads ------------------------------------------------------
  await bulkUpsert(
    m.StoryThread,
    'id',
    selectAll(sqlite, 'story_threads').map((t) => ({
      id: reqNum(t.id),
      worldId: reqNum(t.world_id),
      title: reqStr(t.title),
      titleKey: lower(t.title),
      kind: str(t.kind) ?? 'mystery',
      status: str(t.status) ?? 'active',
      summary: str(t.summary),
      stakes: str(t.stakes),
      rewards: str(t.rewards),
      consequences: str(t.consequences),
      hidden: str(t.hidden),
      relevanceTagsJson: reqStr(t.relevance_tags_json ?? '[]'),
      sourceTurnId: num(t.source_turn_id),
      resolvedTurnId: num(t.resolved_turn_id),
      createdAt: date(t.created_at),
      updatedAt: date(t.updated_at),
    })),
  )

  // -- story_clues --------------------------------------------------------
  await bulkUpsert(
    m.StoryClue,
    'id',
    selectAll(sqlite, 'story_clues').map((c) => ({
      id: reqNum(c.id),
      worldId: reqNum(c.world_id),
      threadId: num(c.thread_id),
      title: reqStr(c.title),
      titleKey: lower(c.title),
      detail: str(c.detail),
      implication: str(c.implication),
      status: str(c.status) ?? 'open',
      sourceTurnId: num(c.source_turn_id),
      createdAt: date(c.created_at),
      updatedAt: date(c.updated_at),
    })),
  )

  // -- story_objectives ---------------------------------------------------
  await bulkUpsert(
    m.StoryObjective,
    'id',
    selectAll(sqlite, 'story_objectives').map((o) => ({
      id: reqNum(o.id),
      worldId: reqNum(o.world_id),
      threadId: num(o.thread_id),
      title: reqStr(o.title),
      titleKey: lower(o.title),
      status: str(o.status) ?? 'active',
      detail: str(o.detail),
      blocker: str(o.blocker),
      sourceTurnId: num(o.source_turn_id),
      completedTurnId: num(o.completed_turn_id),
      createdAt: date(o.created_at),
      updatedAt: date(o.updated_at),
    })),
  )

  // -- story_resources ----------------------------------------------------
  await bulkUpsert(
    m.StoryResource,
    'id',
    selectAll(sqlite, 'story_resources').map((r) => ({
      id: reqNum(r.id),
      worldId: reqNum(r.world_id),
      ownerCharacterId: num(r.owner_character_id),
      name: reqStr(r.name),
      nameKey: lower(r.name),
      kind: str(r.kind),
      status: str(r.status),
      detail: str(r.detail),
      sourceTurnId: num(r.source_turn_id),
      createdAt: date(r.created_at),
      updatedAt: date(r.updated_at),
    })),
  )

  // -- turns: PRESERVE the integer id as `seq` (do NOT renumber) -----------
  const turns = sqlite.prepare('SELECT * FROM turns ORDER BY id').all() as Row[]
  await bulkUpsert(
    m.Turn,
    'seq',
    turns.map((t) => ({
      seq: reqNum(t.id),
      worldId: reqNum(t.world_id),
      role: reqStr(t.role),
      content: reqStr(t.content),
      sceneId: num(t.scene_id),
      metadata: parseJson<Record<string, unknown>>(t.metadata, {}),
      createdAt: date(t.created_at),
    })),
  )

  // -- npc_reveries (match_tags TEXT → matchTagsJson string) ---------------
  for (const r of selectAll(sqlite, 'npc_reveries')) {
    await upsertById(m.Reverie, {
      id: reqNum(r.id),
      worldId: reqNum(r.world_id),
      characterId: reqNum(r.character_id),
      text: reqStr(r.text),
      // SQLite stores match_tags as a comma/newline TEXT blob; the Mongo schema
      // + mapper expect a JSON array string. Normalize to a JSON array.
      matchTagsJson: JSON.stringify(
        reqStr(r.match_tags)
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
      intensity: num(r.intensity) ?? 0.5,
      isCornerstone: flag(r.is_cornerstone),
      createdTurnId: num(r.created_turn_id),
      lastFlaredTurnId: num(r.last_flared_turn_id),
      createdAt: date(r.created_at),
    })
  }

  // -- npc_intents --------------------------------------------------------
  for (const i of selectAll(sqlite, 'npc_intents')) {
    await upsertById(m.NpcIntent, {
      id: reqNum(i.id),
      worldId: reqNum(i.world_id),
      characterId: reqNum(i.character_id),
      playerTurnId: reqNum(i.player_turn_id),
      narratorTurnId: num(i.narrator_turn_id),
      agencyLevel: reqStr(i.agency_level),
      intentText: reqStr(i.intent_text),
      plannedAction: reqStr(i.planned_action),
      intentType: str(i.intent_type),
      targetCharacterId: num(i.target_character_id),
      targetPlaceId: num(i.target_place_id),
      privateRationale: str(i.private_rationale),
      expectedVisibility: str(i.expected_visibility) ?? 'narrator',
      narratorDisposition: str(i.narrator_disposition),
      narratorInterpretation: str(i.narrator_interpretation),
      outcomeSummary: str(i.outcome_summary),
      resolvedOutcome: str(i.resolved_outcome),
      reconciliationConfidence: num(i.reconciliation_confidence),
      archivedPatch: str(i.archived_patch),
      createdAt: date(i.created_at),
      updatedAt: date(i.updated_at),
    })
  }

  // -- timeline_events ----------------------------------------------------
  for (const e of selectAll(sqlite, 'timeline_events')) {
    await upsertById(m.TimelineEvent, {
      id: reqNum(e.id),
      worldId: reqNum(e.world_id),
      turnId: num(e.turn_id),
      threadId: num(e.thread_id),
      worldTime: str(e.world_time),
      title: reqStr(e.title),
      summary: reqStr(e.summary),
      importance: num(e.importance) ?? 3,
      createdAt: date(e.created_at),
    })
  }

  // -- population_templates -----------------------------------------------
  for (const p of selectAll(sqlite, 'population_templates')) {
    await upsertById(m.PopulationTemplate, {
      id: reqNum(p.id),
      worldId: reqNum(p.world_id),
      placeProfileKind: str(p.place_profile_kind),
      role: reqStr(p.role),
      label: reqStr(p.label),
      description: str(p.description),
      behaviorTagsJson: reqStr(p.behavior_tags_json ?? '[]'),
      matchTagsJson: reqStr(p.match_tags_json ?? '[]'),
      seedPremise: str(p.seed_premise),
      promotable: flag(p.promotable),
      weight: num(p.weight) ?? 1,
      createdAt: date(p.created_at),
      updatedAt: date(p.updated_at),
    })
  }

  // -- place_occupancy_snapshots (append-only; occupancy_json stays a string) -
  for (const o of selectAll(sqlite, 'place_occupancy_snapshots')) {
    await upsertById(m.OccupancySnapshot, {
      id: reqNum(o.id),
      worldId: reqNum(o.world_id),
      placeId: reqNum(o.place_id),
      sceneId: num(o.scene_id),
      sourceTurnId: num(o.source_turn_id),
      worldTime: str(o.world_time),
      occupancyJson: reqStr(o.occupancy_json),
      createdAt: date(o.created_at),
    })
  }

  // -- tts_audio_cache (BLOB → BSON Binary / Buffer) ----------------------
  for (const t of selectAll(sqlite, 'tts_audio_cache')) {
    const audio = t.audio
    const buffer = Buffer.isBuffer(audio)
      ? audio
      : audio instanceof Uint8Array
        ? Buffer.from(audio)
        : Buffer.alloc(0)
    await upsertById(m.TtsAudioCache, {
      id: reqNum(t.id),
      worldId: reqNum(t.world_id),
      turnId: reqNum(t.turn_id),
      modelKey: reqStr(t.model_key),
      voiceId: reqStr(t.voice_id),
      textHash: reqStr(t.text_hash),
      contentType: reqStr(t.content_type),
      audio: buffer,
      byteLength: reqNum(t.byte_length),
      createdAt: date(t.created_at),
    })
  }

  // -- world_corrections (applied_patch TEXT-JSON stays a string for audit) -
  for (const c of selectAll(sqlite, 'world_corrections')) {
    await upsertById(m.WorldCorrection, {
      id: reqNum(c.id),
      worldId: reqNum(c.world_id),
      turnId: num(c.turn_id),
      playerText: reqStr(c.player_text),
      archivistReply: reqStr(c.archivist_reply),
      appliedPatch: reqStr(c.applied_patch),
      createdAt: date(c.created_at),
    })
  }

  // -- counters: seed every monotone allocator to MAX(id) so new inserts -----
  //    continue past the existing range. turnSeq is load-bearing for [t:N].
  const maxOf = (table: string, col: string): number => {
    if (!tableExists(sqlite, table)) return 0
    const row = sqlite.prepare(`SELECT MAX(${col}) AS m FROM ${table}`).get() as {
      m: number | null
    }
    return row?.m ?? 0
  }
  const counterSeeds: Array<[string, number]> = [
    ['turnSeq', maxOf('turns', 'id')],
    ['worldId', maxOf('worlds', 'id')],
    ['placeId', maxOf('places', 'id')],
    ['sceneId', maxOf('scenes', 'id')],
    ['characterId', maxOf('characters', 'id')],
    ['storyThreadId', maxOf('story_threads', 'id')],
    ['storyClueId', maxOf('story_clues', 'id')],
    ['storyObjectiveId', maxOf('story_objectives', 'id')],
    ['storyResourceId', maxOf('story_resources', 'id')],
    ['timelineEventId', maxOf('timeline_events', 'id')],
    ['npcIntentId', maxOf('npc_intents', 'id')],
    ['reverieId', maxOf('npc_reveries', 'id')],
    ['populationTemplateId', maxOf('population_templates', 'id')],
    ['occupancySnapshotId', maxOf('place_occupancy_snapshots', 'id')],
    ['ttsAudioCacheId', maxOf('tts_audio_cache', 'id')],
    ['worldCorrectionId', maxOf('world_corrections', 'id')],
  ]
  // Seed at MAX(id): never lower an already-seeded counter (idempotent re-run
  // after live inserts must not regress the allocator).
  for (const [name, max] of counterSeeds) {
    await models.Counter.updateOne(
      { _id: name },
      [
        {
          $set: {
            value: { $max: [{ $ifNull: ['$value', 0] }, max] },
          },
        },
      ],
      { upsert: true },
    )
  }

  // -- createIndexes AFTER bulk insert (E11000 surfaces latent duplicates) --
  const indexed = models as unknown as Record<
    string,
    { createIndexes(): Promise<unknown> }
  >
  await Promise.all(Object.values(indexed).map((m) => m.createIndexes()))

  sqlite.close()
  await connection.close()

  console.log('Backfill complete:')
  console.log(`  worlds=${worlds.length} places=${places.length} scenes=${scenes.length}`)
  console.log(`  characters=${characters.length} turns=${turns.length}`)
  console.log(`  counters seeded (turnSeq=${maxOf('turns', 'id')})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

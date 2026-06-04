import 'server-only'

import { Schema, type Connection, type Model, Types } from 'mongoose'

// Mongoose schemas for the full Mongo target (spec §4.2–§4.5). THE ONLY place
// in the codebase where 'mongoose' may be imported (the boundary rule that, for
// SQLite, forbids `better-sqlite3` outside its adapter — spec §4, §3.7).
//
// Design notes that are load-bearing:
//   - Every collection carries a denormalized `worldId` (the shard/scope key)
//     plus a monotone integer `id` allocated from the `counters` collection,
//     so the repository ports — which speak in `number` ids exactly like the
//     SQLite autoincrement — stay byte-compatible. The native `_id: ObjectId`
//     remains the primary key; the integer `id`/`seq` is the ordering + `[t:N]`
//     provenance key (spec §4.5). NEVER use ObjectId for ordering.
//   - SQLite CHECK constraints → Mongoose `enum` / `min` / `max`.
//   - Functional `lower(name)` UNIQUE indexes → normalized `nameKey`/`titleKey`
//     fields with `{ worldId, nameKey }` unique compound indexes (Mongo has no
//     functional indexes).
//   - `*_json` / `metadata` / `occupancy_json` TEXT columns become native BSON
//     subdocs (`Schema.Types.Mixed`), dropping the JSON.parse/stringify edge.

// ---------------------------------------------------------------------------
// counters — monotone integer allocator (turn seq + per-collection ids)
// ---------------------------------------------------------------------------
export type CounterDoc = { _id: string; value: number }

const CounterSchema = new Schema<CounterDoc>(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, default: 0 },
  },
  { collection: 'counters', versionKey: false },
)

// ---------------------------------------------------------------------------
// worlds — aggregate root; initialState embedded
// ---------------------------------------------------------------------------
const InitialStateSchema = new Schema(
  { time: String, location: String, identity: String, playerName: String },
  { _id: false },
)

export type WorldDoc = {
  _id: Types.ObjectId
  id: number
  name: string
  premise: string
  initialState: Record<string, unknown> | null
  settingRegion: string | null
  worldTime: string | null
  currentSceneId: number | null
  archivedAt: Date | null
  createdAt: Date
}

const WorldSchema = new Schema<WorldDoc>(
  {
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    premise: { type: String, default: '' },
    initialState: { type: InitialStateSchema, default: null },
    settingRegion: { type: String, default: null },
    worldTime: { type: String, default: null },
    currentSceneId: { type: Number, default: null },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  { collection: 'worlds', minimize: false, versionKey: false },
)

// ---------------------------------------------------------------------------
// turns — the append-only spine. `seq` is the load-bearing monotone integer.
// ---------------------------------------------------------------------------
export type TurnDoc = {
  _id: Types.ObjectId
  seq: number
  worldId: number
  role: 'user' | 'assistant'
  content: string
  sceneId: number | null
  metadata: Record<string, unknown>
  createdAt: Date
}

const TurnSchema = new Schema<TurnDoc>(
  {
    seq: { type: Number, required: true },
    worldId: { type: Number, required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    sceneId: { type: Number, default: null },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
    createdAt: { type: Date, required: true },
  },
  { collection: 'turns', minimize: false, versionKey: false },
)
// recent/latest/before-seq pagination relies on (worldId, seq) ordering
TurnSchema.index({ worldId: 1, seq: 1 })
TurnSchema.index({ seq: 1 }, { unique: true })

// ---------------------------------------------------------------------------
// characters — heavily-mutated entity; daily_loop / traits embedded; lists arrays
// ---------------------------------------------------------------------------
export type CharacterDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  name: string
  nameKey: string
  description: string | null
  isPlayer: boolean
  currentPlaceId: number | null
  inTransitToPlaceId: number | null
  arrivalWorldTime: string | null
  status: 'active' | 'inactive' | 'dead'
  agencyLevel: 'npc' | 'local' | 'nearby' | 'distant' | 'dormant'
  memorableFacts: string | null
  observations: string | null
  aliases: string | null
  activeGoal: string | null
  currentAttitude: string | null
  personalGoals: string | null
  currentFocus: string | null
  recentActivity: string | null
  privateBeliefs: string | null
  reveries: string | null
  relationshipToPlayer: string | null
  longTermAgenda: string | null
  toolAccess: string | null
  playerNotes: string | null
  lastKnownSituation: string | null
  traits: Record<string, unknown> | null
  dailyLoop: Record<string, unknown> | null
  appearanceCount: number
  lastSeenTurnId: number | null
  lastAgentTickTurnId: number | null
  createdAt: Date
  updatedAt: Date
}

const CharacterSchema = new Schema<CharacterDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    description: { type: String, default: null },
    isPlayer: { type: Boolean, default: false },
    currentPlaceId: { type: Number, default: null },
    inTransitToPlaceId: { type: Number, default: null },
    arrivalWorldTime: { type: String, default: null },
    status: { type: String, enum: ['active', 'inactive', 'dead'], default: 'active' },
    agencyLevel: {
      type: String,
      enum: ['npc', 'local', 'nearby', 'distant', 'dormant'],
      default: 'npc',
    },
    memorableFacts: { type: String, default: null },
    observations: { type: String, default: null },
    aliases: { type: String, default: null },
    activeGoal: { type: String, default: null },
    currentAttitude: { type: String, default: null },
    personalGoals: { type: String, default: null },
    currentFocus: { type: String, default: null },
    recentActivity: { type: String, default: null },
    privateBeliefs: { type: String, default: null },
    reveries: { type: String, default: null },
    relationshipToPlayer: { type: String, default: null },
    longTermAgenda: { type: String, default: null },
    toolAccess: { type: String, default: null },
    playerNotes: { type: String, default: null },
    lastKnownSituation: { type: String, default: null },
    traits: { type: Schema.Types.Mixed, default: null },
    dailyLoop: { type: Schema.Types.Mixed, default: null },
    appearanceCount: { type: Number, default: 0 },
    lastSeenTurnId: { type: Number, default: null },
    lastAgentTickTurnId: { type: Number, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'characters', minimize: false, versionKey: false },
)
// recreate UNIQUE characters_world_name (world_id, lower(name))
CharacterSchema.index({ worldId: 1, nameKey: 1 }, { unique: true })

// ---------------------------------------------------------------------------
// places — entity with embedded geo + profile (the absorbed place_profiles 1:1)
// ---------------------------------------------------------------------------
const GeoSchema = new Schema(
  {
    displayName: { type: String, default: null },
    street: { type: String, default: null },
    neighborhood: { type: String, default: null },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    status: {
      type: String,
      enum: ['unresolved', 'ok', 'not_found', 'unavailable'],
      default: 'unresolved',
    },
    resolvedAt: { type: Date, default: null },
  },
  { _id: false },
)

const PlaceProfileSchema = new Schema(
  {
    profileKind: { type: String, required: true },
    capacityMin: { type: Number, default: 0 },
    capacityMax: { type: Number, default: 0 },
    typicalRolesJson: { type: String, default: '[]' },
    openHoursJson: { type: String, default: null },
    ambienceTagsJson: { type: String, default: '[]' },
    matchTagsJson: { type: String, default: '[]' },
    encounterRulesJson: { type: String, default: '[]' },
    trafficLevel: {
      type: String,
      enum: ['none', 'low', 'medium', 'high', 'surge'],
      default: 'low',
    },
  },
  { _id: false },
)

export type PlaceDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  name: string
  nameKey: string
  description: string | null
  kind: string | null
  playerNotes: string | null
  geo: Record<string, unknown>
  profile: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

const PlaceSchema = new Schema<PlaceDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    description: { type: String, default: null },
    kind: { type: String, default: null },
    playerNotes: { type: String, default: null },
    geo: { type: GeoSchema, default: () => ({}) },
    profile: { type: PlaceProfileSchema, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'places', minimize: false, versionKey: false },
)
PlaceSchema.index({ worldId: 1, nameKey: 1 }, { unique: true })

// ---------------------------------------------------------------------------
// scenes — referenced by turns.sceneId and worlds.currentSceneId
// ---------------------------------------------------------------------------
export type SceneDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  placeId: number | null
  title: string
  summary: string | null
  sceneNumber: number
  status: 'active' | 'completed'
  sceneMood: 'atmospheric' | 'tense' | 'violent' | 'intimate' | 'wondrous' | null
  pace: 'slow' | 'medium' | 'fast' | null
  focus: 'environment' | 'characters' | 'action' | 'internal' | null
  openedAtTurn: number | null
  closedAtTurn: number | null
  createdAt: Date
  updatedAt: Date
}

const SceneSchema = new Schema<SceneDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    placeId: { type: Number, default: null },
    title: { type: String, required: true },
    summary: { type: String, default: null },
    sceneNumber: { type: Number, required: true },
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    sceneMood: {
      type: String,
      enum: ['atmospheric', 'tense', 'violent', 'intimate', 'wondrous', null],
      default: null,
    },
    pace: { type: String, enum: ['slow', 'medium', 'fast', null], default: null },
    focus: {
      type: String,
      enum: ['environment', 'characters', 'action', 'internal', null],
      default: null,
    },
    openedAtTurn: { type: Number, default: null },
    closedAtTurn: { type: Number, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'scenes', minimize: false, versionKey: false },
)
// UNIQUE(world_id, scene_number) — blocks parallel scenes
SceneSchema.index({ worldId: 1, sceneNumber: 1 }, { unique: true })

// ---------------------------------------------------------------------------
// npc_reveries — append-only, app-pruned (cap 3/NPC)
// ---------------------------------------------------------------------------
export type ReverieDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  characterId: number
  text: string
  matchTagsJson: string
  intensity: number
  isCornerstone: boolean
  createdTurnId: number | null
  lastFlaredTurnId: number | null
  createdAt: Date
}

const ReverieSchema = new Schema<ReverieDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    characterId: { type: Number, required: true },
    text: { type: String, required: true },
    matchTagsJson: { type: String, default: '[]' },
    intensity: { type: Number, default: 0.5, min: 0, max: 1 },
    isCornerstone: { type: Boolean, default: false },
    createdTurnId: { type: Number, default: null },
    lastFlaredTurnId: { type: Number, default: null },
    createdAt: { type: Date, required: true },
  },
  { collection: 'npc_reveries', minimize: false, versionKey: false },
)
ReverieSchema.index({ characterId: 1, id: 1 })
ReverieSchema.index({ worldId: 1 })

// ---------------------------------------------------------------------------
// npc_intents — durable plan ledger; partial index where narratorTurnId is null
// ---------------------------------------------------------------------------
export type NpcIntentDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  characterId: number
  playerTurnId: number
  narratorTurnId: number | null
  agencyLevel: string
  intentText: string
  plannedAction: string
  intentType: string | null
  targetCharacterId: number | null
  targetPlaceId: number | null
  privateRationale: string | null
  expectedVisibility: 'public' | 'narrator' | 'npc_private' | 'narrator_blind'
  narratorDisposition: 'staged' | 'modified' | 'ignored' | 'contradicted' | null
  narratorInterpretation: string | null
  outcomeSummary: string | null
  resolvedOutcome: string | null
  reconciliationConfidence: number | null
  archivedPatch: string | null
  createdAt: Date
  updatedAt: Date
}

const NpcIntentSchema = new Schema<NpcIntentDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    characterId: { type: Number, required: true },
    playerTurnId: { type: Number, required: true },
    narratorTurnId: { type: Number, default: null },
    agencyLevel: { type: String, required: true },
    intentText: { type: String, required: true },
    plannedAction: { type: String, required: true },
    intentType: { type: String, default: null },
    targetCharacterId: { type: Number, default: null },
    targetPlaceId: { type: Number, default: null },
    privateRationale: { type: String, default: null },
    expectedVisibility: {
      type: String,
      enum: ['public', 'narrator', 'npc_private', 'narrator_blind'],
      default: 'narrator',
    },
    narratorDisposition: {
      type: String,
      enum: ['staged', 'modified', 'ignored', 'contradicted', null],
      default: null,
    },
    narratorInterpretation: { type: String, default: null },
    outcomeSummary: { type: String, default: null },
    resolvedOutcome: { type: String, default: null },
    reconciliationConfidence: { type: Number, default: null, min: 0, max: 1 },
    archivedPatch: { type: String, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'npc_intents', minimize: false, versionKey: false },
)
NpcIntentSchema.index({ playerTurnId: 1, id: 1 })
NpcIntentSchema.index({ characterId: 1, id: -1 })
// partial index mirroring `WHERE narrator_turn_id IS NULL`
NpcIntentSchema.index(
  { worldId: 1, id: 1 },
  { partialFilterExpression: { narratorTurnId: null } },
)

// ---------------------------------------------------------------------------
// story_* — dossier, titleKey/nameKey normalized uniques
// ---------------------------------------------------------------------------
export type StoryThreadDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  title: string
  titleKey: string
  kind: 'quest' | 'mystery' | 'threat' | 'relationship' | 'background'
  status: 'active' | 'resolved' | 'failed' | 'dormant'
  summary: string | null
  stakes: string | null
  rewards: string | null
  consequences: string | null
  hidden: string | null
  relevanceTagsJson: string
  sourceTurnId: number | null
  resolvedTurnId: number | null
  createdAt: Date
  updatedAt: Date
}

const StoryThreadSchema = new Schema<StoryThreadDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    title: { type: String, required: true },
    titleKey: { type: String, required: true },
    kind: {
      type: String,
      enum: ['quest', 'mystery', 'threat', 'relationship', 'background'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'resolved', 'failed', 'dormant'],
      default: 'active',
    },
    summary: { type: String, default: null },
    stakes: { type: String, default: null },
    rewards: { type: String, default: null },
    consequences: { type: String, default: null },
    hidden: { type: String, default: null },
    relevanceTagsJson: { type: String, default: '[]' },
    sourceTurnId: { type: Number, default: null },
    resolvedTurnId: { type: Number, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'story_threads', minimize: false, versionKey: false },
)
StoryThreadSchema.index({ worldId: 1, titleKey: 1 }, { unique: true })

export type StoryClueDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  threadId: number | null
  title: string
  titleKey: string
  detail: string | null
  implication: string | null
  status: 'open' | 'interpreted' | 'spent' | 'false_lead'
  sourceTurnId: number | null
  createdAt: Date
  updatedAt: Date
}

const StoryClueSchema = new Schema<StoryClueDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    threadId: { type: Number, default: null },
    title: { type: String, required: true },
    titleKey: { type: String, required: true },
    detail: { type: String, default: null },
    implication: { type: String, default: null },
    status: {
      type: String,
      enum: ['open', 'interpreted', 'spent', 'false_lead'],
      default: 'open',
    },
    sourceTurnId: { type: Number, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'story_clues', minimize: false, versionKey: false },
)
StoryClueSchema.index({ worldId: 1, titleKey: 1 }, { unique: true })

export type StoryObjectiveDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  threadId: number | null
  title: string
  titleKey: string
  status: 'active' | 'blocked' | 'completed' | 'failed'
  detail: string | null
  blocker: string | null
  sourceTurnId: number | null
  completedTurnId: number | null
  createdAt: Date
  updatedAt: Date
}

const StoryObjectiveSchema = new Schema<StoryObjectiveDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    threadId: { type: Number, default: null },
    title: { type: String, required: true },
    titleKey: { type: String, required: true },
    status: {
      type: String,
      enum: ['active', 'blocked', 'completed', 'failed'],
      default: 'active',
    },
    detail: { type: String, default: null },
    blocker: { type: String, default: null },
    sourceTurnId: { type: Number, default: null },
    completedTurnId: { type: Number, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'story_objectives', minimize: false, versionKey: false },
)
StoryObjectiveSchema.index({ worldId: 1, titleKey: 1 }, { unique: true })

export type StoryResourceDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  ownerCharacterId: number | null
  name: string
  nameKey: string
  kind: string | null
  status: string | null
  detail: string | null
  sourceTurnId: number | null
  createdAt: Date
  updatedAt: Date
}

const StoryResourceSchema = new Schema<StoryResourceDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    ownerCharacterId: { type: Number, default: null },
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    kind: { type: String, default: null },
    status: { type: String, default: null },
    detail: { type: String, default: null },
    sourceTurnId: { type: Number, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'story_resources', minimize: false, versionKey: false },
)
StoryResourceSchema.index({ worldId: 1, nameKey: 1 }, { unique: true })

export type TimelineEventDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  turnId: number | null
  threadId: number | null
  worldTime: string | null
  title: string
  summary: string
  importance: number
  createdAt: Date
}

const TimelineEventSchema = new Schema<TimelineEventDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    turnId: { type: Number, default: null },
    threadId: { type: Number, default: null },
    worldTime: { type: String, default: null },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    importance: { type: Number, default: 3, min: 1, max: 5 },
    createdAt: { type: Date, required: true },
  },
  { collection: 'timeline_events', minimize: false, versionKey: false },
)
TimelineEventSchema.index({ worldId: 1, id: 1 })

// ---------------------------------------------------------------------------
// population_templates — mostly static seed data, keyed by profile kind
// ---------------------------------------------------------------------------
export type PopulationTemplateDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  placeProfileKind: string | null
  role: string
  label: string
  description: string | null
  behaviorTagsJson: string
  matchTagsJson: string
  seedPremise: string | null
  promotable: boolean
  weight: number
  createdAt: Date
  updatedAt: Date
}

const PopulationTemplateSchema = new Schema<PopulationTemplateDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    placeProfileKind: { type: String, default: null },
    role: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: null },
    behaviorTagsJson: { type: String, default: '[]' },
    matchTagsJson: { type: String, default: '[]' },
    seedPremise: { type: String, default: null },
    promotable: { type: Boolean, default: false },
    weight: { type: Number, default: 1 },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'population_templates', minimize: false, versionKey: false },
)
PopulationTemplateSchema.index({ worldId: 1, placeProfileKind: 1 })

// ---------------------------------------------------------------------------
// place_occupancy_snapshots — append-only, app-pruned by turn count
// ---------------------------------------------------------------------------
export type OccupancySnapshotDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  placeId: number
  sceneId: number | null
  sourceTurnId: number | null
  worldTime: string | null
  occupancyJson: string
  createdAt: Date
}

const OccupancySnapshotSchema = new Schema<OccupancySnapshotDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    placeId: { type: Number, required: true },
    sceneId: { type: Number, default: null },
    sourceTurnId: { type: Number, default: null },
    worldTime: { type: String, default: null },
    occupancyJson: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: 'place_occupancy_snapshots', minimize: false, versionKey: false },
)
OccupancySnapshotSchema.index({ worldId: 1, placeId: 1, id: -1 })

// ---------------------------------------------------------------------------
// tts_audio_cache — only binary column; Binary inline (clips < 16MB BSON cap)
// ---------------------------------------------------------------------------
export type TtsAudioCacheDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  turnId: number
  modelKey: string
  voiceId: string
  textHash: string
  contentType: string
  audio: Buffer
  byteLength: number
  createdAt: Date
}

const TtsAudioCacheSchema = new Schema<TtsAudioCacheDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    turnId: { type: Number, required: true },
    modelKey: { type: String, required: true },
    voiceId: { type: String, required: true },
    textHash: { type: String, required: true },
    contentType: { type: String, required: true },
    audio: { type: Buffer, required: true },
    byteLength: { type: Number, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: 'tts_audio_cache', minimize: false, versionKey: false },
)
TtsAudioCacheSchema.index(
  { worldId: 1, turnId: 1, modelKey: 1, voiceId: 1, textHash: 1 },
  { unique: true },
)

// ---------------------------------------------------------------------------
// world_corrections — append-only audit
// ---------------------------------------------------------------------------
export type WorldCorrectionDoc = {
  _id: Types.ObjectId
  id: number
  worldId: number
  turnId: number | null
  playerText: string
  archivistReply: string
  appliedPatch: string
  createdAt: Date
}

const WorldCorrectionSchema = new Schema<WorldCorrectionDoc>(
  {
    id: { type: Number, required: true, unique: true },
    worldId: { type: Number, required: true },
    turnId: { type: Number, default: null },
    playerText: { type: String, required: true },
    archivistReply: { type: String, required: true },
    appliedPatch: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: 'world_corrections', minimize: false, versionKey: false },
)
WorldCorrectionSchema.index({ worldId: 1, id: -1 })

// ---------------------------------------------------------------------------
// Model registry — bound to a specific connection (test isolation + the
// createConnection pattern from connection.ts, NOT the mongoose global).
// ---------------------------------------------------------------------------
export type MongoModels = {
  Counter: Model<CounterDoc>
  World: Model<WorldDoc>
  Turn: Model<TurnDoc>
  Character: Model<CharacterDoc>
  Place: Model<PlaceDoc>
  Scene: Model<SceneDoc>
  Reverie: Model<ReverieDoc>
  NpcIntent: Model<NpcIntentDoc>
  StoryThread: Model<StoryThreadDoc>
  StoryClue: Model<StoryClueDoc>
  StoryObjective: Model<StoryObjectiveDoc>
  StoryResource: Model<StoryResourceDoc>
  TimelineEvent: Model<TimelineEventDoc>
  PopulationTemplate: Model<PopulationTemplateDoc>
  OccupancySnapshot: Model<OccupancySnapshotDoc>
  TtsAudioCache: Model<TtsAudioCacheDoc>
  WorldCorrection: Model<WorldCorrectionDoc>
}

// Bind one schema to a connection, reusing an already-compiled model so
// repeated calls (and the build-phase stub) never throw OverwriteModelError.
function bind<T>(
  connection: Connection,
  name: string,
  schema: Schema<T>,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema)
  )
}

/**
 * Bind all schemas to a connection and return the model registry. Idempotent
 * per connection.
 */
export function buildModels(connection: Connection): MongoModels {
  return {
    Counter: bind(connection, 'Counter', CounterSchema),
    World: bind(connection, 'World', WorldSchema),
    Turn: bind(connection, 'Turn', TurnSchema),
    Character: bind(connection, 'Character', CharacterSchema),
    Place: bind(connection, 'Place', PlaceSchema),
    Scene: bind(connection, 'Scene', SceneSchema),
    Reverie: bind(connection, 'Reverie', ReverieSchema),
    NpcIntent: bind(connection, 'NpcIntent', NpcIntentSchema),
    StoryThread: bind(connection, 'StoryThread', StoryThreadSchema),
    StoryClue: bind(connection, 'StoryClue', StoryClueSchema),
    StoryObjective: bind(connection, 'StoryObjective', StoryObjectiveSchema),
    StoryResource: bind(connection, 'StoryResource', StoryResourceSchema),
    TimelineEvent: bind(connection, 'TimelineEvent', TimelineEventSchema),
    PopulationTemplate: bind(connection, 'PopulationTemplate', PopulationTemplateSchema),
    OccupancySnapshot: bind(connection, 'OccupancySnapshot', OccupancySnapshotSchema),
    TtsAudioCache: bind(connection, 'TtsAudioCache', TtsAudioCacheSchema),
    WorldCorrection: bind(connection, 'WorldCorrection', WorldCorrectionSchema),
  }
}

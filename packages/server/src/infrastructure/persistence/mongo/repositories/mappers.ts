import 'server-only'

import type {
  Character,
  NpcIntentRow,
  OccupancySnapshotRow,
  Place,
  PlaceProfileRow,
  PopulationTemplateRow,
  Scene,
  StoryClue,
  StoryObjective,
  StoryResource,
  StoryThread,
  TimelineEvent,
  Turn,
  WorldCorrectionRow,
} from '@/domain/entities'
import type { World, WorldSummary } from '@/lib/worlds'
import type { ReverieRow } from '@/lib/reveries'

import type {
  CharacterDoc,
  NpcIntentDoc,
  OccupancySnapshotDoc,
  PlaceDoc,
  ReverieDoc,
  SceneDoc,
  StoryClueDoc,
  StoryObjectiveDoc,
  StoryResourceDoc,
  StoryThreadDoc,
  TimelineEventDoc,
  TurnDoc,
  WorldCorrectionDoc,
  WorldDoc,
} from '../models'

// Document → domain-entity mappers (spec §3.3). The ports speak in the same
// flat SQLite row shapes (`snake_case`, ISO-string dates, numeric booleans), so
// every read maps a BSON doc back to that shape. This keeps everything
// downstream store-agnostic: a use case can't tell SQLite from Mongo.

// SQLite's `datetime('now')` renders `YYYY-MM-DD HH:MM:SS` (UTC, space-sep). To
// stay byte-compatible with stored `[t:N]`-adjacent timestamps and the inspector
// formatters, render Dates the same way rather than ISO `T`/`Z`.
export function toSqliteDatetime(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
}

function bool(n: boolean): number {
  return n ? 1 : 0
}

export function mapWorld(d: WorldDoc): World {
  return {
    id: d.id,
    name: d.name,
    premise: d.premise,
    initial_state_json: JSON.stringify(d.initialState ?? {}),
    setting_region: d.settingRegion,
    created_at: toSqliteDatetime(d.createdAt),
  }
}

export function mapWorldSummary(
  d: WorldDoc,
  turnCount: number,
): WorldSummary {
  return {
    id: d.id,
    name: d.name,
    premise: d.premise,
    created_at: toSqliteDatetime(d.createdAt),
    archived_at: d.archivedAt ? toSqliteDatetime(d.archivedAt) : null,
    turn_count: turnCount,
  }
}

export function mapTurn(d: TurnDoc): Turn {
  return {
    id: d.seq,
    world_id: d.worldId,
    role: d.role,
    content: d.content,
    scene_id: d.sceneId,
    created_at: toSqliteDatetime(d.createdAt),
  }
}

export function mapCharacter(d: CharacterDoc): Character {
  return {
    id: d.id,
    world_id: d.worldId,
    name: d.name,
    description: d.description,
    is_player: bool(d.isPlayer),
    current_place_id: d.currentPlaceId,
    memorable_facts: d.memorableFacts,
    status: d.status,
    active_goal: d.activeGoal,
    current_attitude: d.currentAttitude,
    observations: d.observations,
    agency_level: d.agencyLevel,
    personal_goals: d.personalGoals,
    current_focus: d.currentFocus,
    recent_activity: d.recentActivity,
    private_beliefs: d.privateBeliefs,
    reveries: d.reveries,
    relationship_to_player: d.relationshipToPlayer,
    long_term_agenda: d.longTermAgenda,
    tool_access: d.toolAccess,
    appearance_count: d.appearanceCount,
    last_seen_turn_id: d.lastSeenTurnId,
    last_agent_tick_turn_id: d.lastAgentTickTurnId,
    player_notes: d.playerNotes,
    in_transit_to_place_id: d.inTransitToPlaceId,
    arrival_world_time: d.arrivalWorldTime,
    last_known_situation: d.lastKnownSituation,
    aliases: d.aliases,
    daily_loop: d.dailyLoop ? JSON.stringify(d.dailyLoop) : null,
    created_at: toSqliteDatetime(d.createdAt),
    updated_at: toSqliteDatetime(d.updatedAt),
  }
}

export function mapPlace(d: PlaceDoc): Place {
  const geo = (d.geo ?? {}) as {
    displayName?: string | null
    street?: string | null
    neighborhood?: string | null
    lat?: number | null
    lng?: number | null
    status?: Place['geo_status']
    resolvedAt?: Date | null
  }
  return {
    id: d.id,
    world_id: d.worldId,
    name: d.name,
    description: d.description,
    kind: d.kind,
    player_notes: d.playerNotes,
    osm_display_name: geo.displayName ?? null,
    osm_street: geo.street ?? null,
    osm_neighborhood: geo.neighborhood ?? null,
    osm_lat: geo.lat ?? null,
    osm_lng: geo.lng ?? null,
    geo_status: geo.status ?? 'unresolved',
    geo_resolved_at: geo.resolvedAt ? toSqliteDatetime(geo.resolvedAt) : null,
    created_at: toSqliteDatetime(d.createdAt),
    updated_at: toSqliteDatetime(d.updatedAt),
  }
}

export function mapScene(d: SceneDoc): Scene {
  return {
    id: d.id,
    world_id: d.worldId,
    place_id: d.placeId,
    title: d.title,
    summary: d.summary,
    scene_number: d.sceneNumber,
    status: d.status,
    scene_mood: d.sceneMood,
    pace: d.pace,
    focus: d.focus,
    opened_at_turn: d.openedAtTurn,
    closed_at_turn: d.closedAtTurn,
    created_at: toSqliteDatetime(d.createdAt),
    updated_at: toSqliteDatetime(d.updatedAt),
  }
}

export function mapReverie(d: ReverieDoc): ReverieRow {
  let matchTags: string[] = []
  try {
    const parsed = JSON.parse(d.matchTagsJson ?? '[]')
    if (Array.isArray(parsed)) matchTags = parsed.filter((t) => typeof t === 'string')
  } catch {
    matchTags = []
  }
  return {
    id: d.id,
    world_id: d.worldId,
    character_id: d.characterId,
    text: d.text,
    match_tags: matchTags,
    intensity: d.intensity,
    is_cornerstone: bool(d.isCornerstone),
    created_turn_id: d.createdTurnId,
    last_flared_turn_id: d.lastFlaredTurnId,
    created_at: toSqliteDatetime(d.createdAt),
  }
}

export function mapNpcIntent(d: NpcIntentDoc): NpcIntentRow {
  return {
    id: d.id,
    world_id: d.worldId,
    character_id: d.characterId,
    player_turn_id: d.playerTurnId,
    narrator_turn_id: d.narratorTurnId,
    agency_level: d.agencyLevel,
    intent_text: d.intentText,
    planned_action: d.plannedAction,
    intent_type: d.intentType,
    target_character_id: d.targetCharacterId,
    target_place_id: d.targetPlaceId,
    private_rationale: d.privateRationale,
    expected_visibility: d.expectedVisibility,
    narrator_disposition: d.narratorDisposition,
    narrator_interpretation: d.narratorInterpretation,
    outcome_summary: d.outcomeSummary,
    resolved_outcome: d.resolvedOutcome,
    reconciliation_confidence: d.reconciliationConfidence,
    archived_patch: d.archivedPatch,
    created_at: toSqliteDatetime(d.createdAt),
    updated_at: toSqliteDatetime(d.updatedAt),
  }
}

export function mapStoryThread(d: StoryThreadDoc): StoryThread {
  return {
    id: d.id,
    world_id: d.worldId,
    title: d.title,
    kind: d.kind,
    status: d.status,
    summary: d.summary,
    stakes: d.stakes,
    rewards: d.rewards,
    consequences: d.consequences,
    hidden: d.hidden,
    relevance_tags_json: d.relevanceTagsJson,
    source_turn_id: d.sourceTurnId,
    resolved_turn_id: d.resolvedTurnId,
    created_at: toSqliteDatetime(d.createdAt),
    updated_at: toSqliteDatetime(d.updatedAt),
  }
}

export function mapStoryClue(
  d: StoryClueDoc,
  threadTitle: string | null,
): StoryClue {
  return {
    id: d.id,
    world_id: d.worldId,
    thread_id: d.threadId,
    thread_title: threadTitle,
    title: d.title,
    detail: d.detail,
    implication: d.implication,
    status: d.status,
    source_turn_id: d.sourceTurnId,
    created_at: toSqliteDatetime(d.createdAt),
    updated_at: toSqliteDatetime(d.updatedAt),
  }
}

export function mapStoryObjective(
  d: StoryObjectiveDoc,
  threadTitle: string | null,
): StoryObjective {
  return {
    id: d.id,
    world_id: d.worldId,
    thread_id: d.threadId,
    thread_title: threadTitle,
    title: d.title,
    status: d.status,
    detail: d.detail,
    blocker: d.blocker,
    source_turn_id: d.sourceTurnId,
    completed_turn_id: d.completedTurnId,
    created_at: toSqliteDatetime(d.createdAt),
    updated_at: toSqliteDatetime(d.updatedAt),
  }
}

export function mapStoryResource(
  d: StoryResourceDoc,
  ownerName: string | null,
): StoryResource {
  return {
    id: d.id,
    world_id: d.worldId,
    owner_character_id: d.ownerCharacterId,
    owner_name: ownerName,
    name: d.name,
    kind: d.kind,
    status: d.status,
    detail: d.detail,
    source_turn_id: d.sourceTurnId,
    created_at: toSqliteDatetime(d.createdAt),
    updated_at: toSqliteDatetime(d.updatedAt),
  }
}

export function mapTimelineEvent(
  d: TimelineEventDoc,
  threadTitle: string | null,
): TimelineEvent {
  return {
    id: d.id,
    world_id: d.worldId,
    turn_id: d.turnId,
    thread_id: d.threadId,
    thread_title: threadTitle,
    world_time: d.worldTime,
    title: d.title,
    summary: d.summary,
    importance: d.importance,
    created_at: toSqliteDatetime(d.createdAt),
  }
}

export function mapPlaceProfile(d: {
  id: number
  worldId: number
  placeId: number
  profile: {
    profileKind: string
    capacityMin: number
    capacityMax: number
    typicalRolesJson: string
    openHoursJson: string | null
    trafficLevel: PlaceProfileRow['traffic_level']
    ambienceTagsJson: string
    matchTagsJson: string
    encounterRulesJson: string
  }
  createdAt: Date
  updatedAt: Date
}): PlaceProfileRow {
  return {
    id: d.id,
    world_id: d.worldId,
    place_id: d.placeId,
    profile_kind: d.profile.profileKind,
    capacity_min: d.profile.capacityMin,
    capacity_max: d.profile.capacityMax,
    typical_roles_json: d.profile.typicalRolesJson,
    open_hours_json: d.profile.openHoursJson,
    traffic_level: d.profile.trafficLevel,
    ambience_tags_json: d.profile.ambienceTagsJson,
    match_tags_json: d.profile.matchTagsJson,
    encounter_rules_json: d.profile.encounterRulesJson,
    created_at: toSqliteDatetime(d.createdAt),
    updated_at: toSqliteDatetime(d.updatedAt),
  }
}

export function mapPopulationTemplate(
  d: import('../models').PopulationTemplateDoc,
): PopulationTemplateRow {
  return {
    id: d.id,
    world_id: d.worldId,
    place_profile_kind: d.placeProfileKind,
    role: d.role,
    label: d.label,
    description: d.description,
    behavior_tags_json: d.behaviorTagsJson,
    match_tags_json: d.matchTagsJson,
    seed_premise: d.seedPremise,
    promotable: bool(d.promotable),
    weight: d.weight,
    created_at: toSqliteDatetime(d.createdAt),
    updated_at: toSqliteDatetime(d.updatedAt),
  }
}

export function mapOccupancySnapshot(d: OccupancySnapshotDoc): OccupancySnapshotRow {
  return {
    id: d.id,
    world_id: d.worldId,
    place_id: d.placeId,
    scene_id: d.sceneId,
    source_turn_id: d.sourceTurnId,
    world_time: d.worldTime,
    occupancy_json: d.occupancyJson,
    created_at: toSqliteDatetime(d.createdAt),
  }
}

export function mapWorldCorrection(d: WorldCorrectionDoc): WorldCorrectionRow {
  return {
    id: d.id,
    world_id: d.worldId,
    turn_id: d.turnId,
    player_text: d.playerText,
    archivist_reply: d.archivistReply,
    applied_patch: d.appliedPatch,
    created_at: toSqliteDatetime(d.createdAt),
  }
}

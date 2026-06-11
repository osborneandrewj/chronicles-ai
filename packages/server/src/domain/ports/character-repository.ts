import type { Character } from '@/lib/world-state'

// Result of the appearance-bump / auto-promotion pass (spec §3.4-P3). `promoted`
// is the names of NPCs that crossed the auto-promote threshold on this call;
// `tiers` records every other tier transition (for turn metadata / logging).
export type AppearancePromotionResult = {
  promoted: string[]
  counted: number
  tiers: Record<'local' | 'nearby' | 'distant' | 'dormant' | 'demoted', string[]>
}

// A character to insert (starship P1). The bounded-world seeder writes crew with
// a `role` (stored in the existing current_focus field — there is no dedicated
// role column), an active_goal, and a daily_loop (JSON text, characters.daily_loop
// v24). Ids are assigned by the store.
export type CharacterInput = {
  world_id: number
  name: string
  description: string | null
  is_player: number
  current_place_id: number | null
  role: string | null
  active_goal: string | null
  daily_loop: string | null
}

// The archivist's character INSERT (insertCharacterStmt): the columns the patch
// applier writes on first sight of a character. memorable_facts / observations
// arrive already provenance-tagged by the use case; status defaults are resolved
// by the caller. Ids are assigned by the store.
export type ArchivistCharacterInsert = {
  world_id: number
  name: string
  description: string | null
  is_player: number
  current_place_id: number | null
  memorable_facts: string | null
  status: string
  active_goal: string | null
  current_attitude: string | null
  observations: string | null
}

// The archivist's character UPDATE (updateCharacterStmt). Each nullable field is
// COALESCE'd server-side: null leaves the column unchanged, a value overwrites.
export type ArchivistCharacterUpdate = {
  description: string | null
  current_place_id: number | null
  is_player: number | null
  memorable_facts: string | null
  status: string | null
}

// The archivist's character MERGE (mergeCharacterStmt): a full overwrite of the
// surviving row with the JS-computed merged values (every column is a plain
// assignment, not COALESCE — the use case owns the freshest()/line-merge).
export type ArchivistCharacterMerge = {
  name: string
  description: string | null
  current_place_id: number | null
  memorable_facts: string | null
  status: string
  active_goal: string | null
  current_attitude: string | null
  observations: string | null
  agency_level: string
  personal_goals: string | null
  current_focus: string | null
  recent_activity: string | null
  private_beliefs: string | null
  relationship_to_player: string | null
  long_term_agenda: string | null
  tool_access: string | null
  appearance_count: number
  last_seen_turn_id: number | null
  last_agent_tick_turn_id: number | null
  player_notes: string | null
  aliases: string | null
}

// A row read by the NPC agent's tick query (agentNpcsForTick). The flat
// `characters` columns the agent reflects on, PLUS the two joined place names
// (current_place_name / in_transit_to_name) the SQLite query resolves via a
// correlated subquery. Distinct from the `Character` entity because of those
// two adapter-resolved joins.
export type AgentNpcRow = {
  id: number
  name: string
  description: string | null
  personal_goals: string | null
  current_focus: string | null
  recent_activity: string | null
  private_beliefs: string | null
  reveries: string | null
  relationship_to_player: string | null
  long_term_agenda: string | null
  tool_access: string | null
  active_goal: string | null
  current_attitude: string | null
  current_place_id: number | null
  current_place_name: string | null
  agency_level: string
  last_agent_tick_turn_id: number | null
  in_transit_to_place_id: number | null
  in_transit_to_name: string | null
  arrival_world_time: string | null
  last_known_situation: string | null
  daily_loop: string | null
}

// The NPC agent's per-character WRITE surface (applyAgentNpcFields). The use case
// resolves WHICH fields the patch touches (and resolves place names → ids); the
// adapter persists only the keys present (a partial UPDATE / $set), mirroring the
// agent's per-field UPDATE statements. daily_loop has its own conditional setter
// (setDailyLoopIfEmpty) and is NOT part of this patch.
export type AgentNpcFields = {
  current_focus?: string
  recent_activity?: string
  current_place_id?: number
  personal_goals?: string
  private_beliefs?: string
  relationship_to_player?: string
  long_term_agenda?: string
  tool_access?: string
  in_transit_to_place_id?: number | null
  arrival_world_time?: string | null
  last_known_situation?: string
}

// CharacterRepository (spec §3.4) — dumb CRUD over the `characters` aggregate.
// Reads plus `add` (the bounded-world crew insert) and `setPlace` (the P2 sim
// moving an NPC to a room). Name resolution / alias merge / promotion are
// deciding logic that stays out of the adapter (P4). Async by mandate (spec §5.3).
export interface CharacterRepository {
  forWorld(worldId: number): Promise<Character[]>
  inPlace(worldId: number, placeId: number): Promise<Character[]>
  add(character: CharacterInput): Promise<{ id: number }>
  /** Move a character to a room (or clear its room when null). */
  setPlace(characterId: number, placeId: number | null): Promise<void>
  /**
   * Exact case-insensitive name lookup (findCharacterByExactLowerNameStmt).
   * Distinct from resolveCharacter()'s soft-match path — used by the correction
   * channel's `aliases` field where the player has explicitly told us two
   * existing rows are the same person. Returns null when no row matches.
   */
  findByExactLowerName(worldId: number, name: string): Promise<Character | null>
  /** Archivist INSERT (insertCharacterStmt): first sight of a character. */
  insert(character: ArchivistCharacterInsert): Promise<{ id: number }>
  /** Archivist UPDATE (updateCharacterStmt): COALESCE'd partial overwrite. */
  update(characterId: number, patch: ArchivistCharacterUpdate): Promise<void>
  /**
   * Set active_goal (setActiveGoalStmt). Three-state: the caller only invokes
   * this when the field is present in the patch; null clears, a string sets.
   */
  setActiveGoal(characterId: number, activeGoal: string | null): Promise<void>
  /** Set current_attitude (setCurrentAttitudeStmt). Three-state like setActiveGoal. */
  setCurrentAttitude(characterId: number, currentAttitude: string | null): Promise<void>
  /**
   * Overwrite observations (setObservationsStmt). COALESCE'd: null leaves it
   * unchanged; the caller passes the fully-built next value (existing + new line).
   */
  setObservations(characterId: number, observations: string | null): Promise<void>
  /**
   * Full-overwrite merge of the surviving row (mergeCharacterStmt). The use case
   * computes every merged column; the adapter only persists.
   */
  merge(characterId: number, merged: ArchivistCharacterMerge): Promise<void>
  /** Delete a character row (deleteCharacterStmt) — the merge source. */
  delete(characterId: number): Promise<void>
  /**
   * Overwrite the aliases column (setCharacterAliasesStmt). The use case builds
   * the merged/filtered alias block; null clears it.
   */
  setAliases(characterId: number, aliases: string | null): Promise<void>
  /** Rename a character (renameCharacterStmt) — the alias-merge canonicalisation. */
  rename(name: string, characterId: number): Promise<void>
  /**
   * Move the player row to a place (setPlayersPlaceStmt) — scoped to the world's
   * is_player=1 row.
   */
  setPlayersPlace(placeId: number, worldId: number): Promise<void>
  /**
   * Append a player_notes line (appendCharacterPlayerNotesStmt). Append-only,
   * newline-separated; pass the same trimmed line as both the first-line and the
   * appended-line value (mirrors the SQLite CASE).
   */
  appendPlayerNotes(characterId: number, line: string): Promise<void>
  /**
   * Bump appearance_count for each present NPC and auto-promote/demote agency
   * tiers in one atomic pass (spec §3.4-P3). The promotion DECISION (threshold,
   * transient-service detection, next-tier) is the pure `npc-promotion` domain
   * service; this port only persists the resulting writes. `presentCharacters`
   * are the rows read before the bump (their counts are pre-increment).
   */
  recordAppearancesAndAutoPromote(
    worldId: number,
    presentCharacters: Character[],
    turnId: number,
  ): Promise<AppearancePromotionResult>
  /**
   * The NPC agent's tick-candidate read (agentNpcsStmt): non-player, non-dead
   * NPCs the agent may plan for this turn — agent-tier rows whose tier-based
   * cadence is due (`tickTurnId` is the player-turn id the cadence arithmetic is
   * measured against), PLUS plain `npc`-tier rows physically co-located with the
   * player (`playerPlaceId`, or null when the player has no place). The query
   * only widens the candidate set; the plan-ELIGIBILITY decision (drop transient
   * walk-ons) is the pure `isPlanEligible` domain service the use case runs on
   * these rows. Returns the joined `AgentNpcRow` shape (flat columns + the two
   * resolved place names).
   */
  agentNpcsForTick(
    worldId: number,
    tickTurnId: number,
    playerPlaceId: number | null,
  ): Promise<AgentNpcRow[]>
  /**
   * Stamp last_agent_tick_turn_id (setLastAgentTickStmt) after an NPC is ticked —
   * the cadence bookkeeping the next `agentNpcsForTick` reads.
   */
  setLastAgentTick(turnId: number, characterId: number): Promise<void>
  /**
   * Resolve a plan-eligible NPC by exact (case-insensitive) name within a world
   * (findAgentNpcByNameStmt) for the patch applier. Matches agent-tier rows AND
   * plain `npc`-tier rows (so a newly-eligible co-located NPC's own updates write
   * back). Returns `{ id, recent_activity }` (the only columns the applier needs),
   * or null for a missing/dead/player row.
   */
  findAgentNpcByName(
    worldId: number,
    name: string,
  ): Promise<{ id: number; recent_activity: string | null } | null>
  /**
   * Apply the NPC agent's per-field character updates (the agent's per-column
   * UPDATE statements). Only the keys present in `fields` are written; each bumps
   * updated_at. The use case owns which fields change and the place-name → id
   * resolution. daily_loop is excluded (see setDailyLoopIfEmpty).
   */
  applyAgentNpcFields(characterId: number, fields: AgentNpcFields): Promise<void>
  /**
   * Author a daily_loop ONCE (setDailyLoopIfEmptyStmt): writes only when the row's
   * daily_loop is currently null/blank, mirroring the SQL WHERE guard.
   */
  setDailyLoopIfEmpty(characterId: number, dailyLoopJson: string): Promise<void>
}

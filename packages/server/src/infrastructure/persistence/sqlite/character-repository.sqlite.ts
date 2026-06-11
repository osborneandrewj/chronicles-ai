import 'server-only'

import {
  db,
  getCharactersForWorld,
  getCharactersInPlace,
  insertBoundedCharacter,
  setCharacterPlace,
} from '@/lib/db'
import { recordAppearancesAndAutoPromote } from '@/lib/npc-promotion'
import type { Character } from '@/lib/world-state'
import type {
  AgentNpcFields,
  AgentNpcRow,
  AppearancePromotionResult,
  ArchivistCharacterInsert,
  ArchivistCharacterMerge,
  ArchivistCharacterUpdate,
  CharacterInput,
  CharacterRepository,
} from '@/domain/ports/character-repository'

// Verbatim copies of lib/archivist.ts character statements (P4a write surface —
// temporary duplication; P4b deletes the originals). Byte-identical SQL/columns/
// COALESCE/WHERE so the oracle characterization tests stay green when the
// archivist is rewired onto this port.
const findCharacterByExactLowerNameStmt = db.prepare<[number, string]>(
  `SELECT id, name, description, is_player, current_place_id, memorable_facts,
          status, active_goal, current_attitude, observations, agency_level,
          personal_goals, current_focus, recent_activity,
          private_beliefs, reveries, relationship_to_player, long_term_agenda, tool_access, appearance_count,
          last_seen_turn_id, last_agent_tick_turn_id, player_notes, aliases, updated_at
   FROM characters
   WHERE world_id = ? AND lower(name) = lower(?)`,
)
const appendCharacterPlayerNotesStmt = db.prepare<[string, string, number]>(
  `UPDATE characters
   SET player_notes = CASE
       WHEN player_notes IS NULL OR length(trim(player_notes)) = 0 THEN ?
       ELSE player_notes || char(10) || ?
     END,
     updated_at = datetime('now')
   WHERE id = ?`,
)
const insertCharacterStmt = db.prepare<
  [
    number,
    string,
    string | null,
    number,
    number | null,
    string | null,
    string,
    string | null,
    string | null,
    string | null,
  ]
>(
  `INSERT INTO characters (world_id, name, description, is_player, current_place_id,
                           memorable_facts, status, active_goal, current_attitude, observations)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
)
const updateCharacterStmt = db.prepare<
  [string | null, number | null, number | null, string | null, string | null, number]
>(
  `UPDATE characters SET
     description       = COALESCE(?, description),
     current_place_id  = COALESCE(?, current_place_id),
     is_player         = COALESCE(?, is_player),
     memorable_facts   = COALESCE(?, memorable_facts),
     status            = COALESCE(?, status),
     updated_at        = datetime('now')
   WHERE id = ?`,
)
const setActiveGoalStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET active_goal = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setCurrentAttitudeStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET current_attitude = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setObservationsStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET observations = COALESCE(?, observations), updated_at = datetime('now')
   WHERE id = ?`,
)
const mergeCharacterStmt = db.prepare<
  [
    string,
    string | null,
    number | null,
    string | null,
    string,
    string | null,
    string | null,
    string | null,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    number,
    number | null,
    number | null,
    string | null,
    string | null,
    number,
  ]
>(
  `UPDATE characters SET
     name                    = ?,
     description             = ?,
     current_place_id        = ?,
     memorable_facts         = ?,
     status                  = ?,
     active_goal             = ?,
     current_attitude        = ?,
     observations            = ?,
     agency_level            = ?,
     personal_goals          = ?,
     current_focus           = ?,
     recent_activity         = ?,
     private_beliefs         = ?,
     relationship_to_player  = ?,
     long_term_agenda        = ?,
     tool_access             = ?,
     appearance_count        = ?,
     last_seen_turn_id       = ?,
     last_agent_tick_turn_id = ?,
     player_notes            = ?,
     aliases                 = ?,
     updated_at              = datetime('now')
   WHERE id = ?`,
)
const deleteCharacterStmt = db.prepare<[number]>('DELETE FROM characters WHERE id = ?')
const setCharacterAliasesStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET aliases = ?, updated_at = datetime('now') WHERE id = ?`,
)
const renameCharacterStmt = db.prepare<[string, number]>(
  `UPDATE characters SET name = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setPlayersPlaceStmt = db.prepare<[number, number]>(
  `UPDATE characters SET current_place_id = ?, updated_at = datetime('now')
   WHERE world_id = ? AND is_player = 1`,
)

// Verbatim copies of the NPC agent's statements (lib/npc-agent.ts, P5b strangle).
// Byte-identical SQL/columns/WHERE/cadence-arithmetic so the SQLite path stays
// unchanged when the agent is rewired onto this port.
const agentNpcsStmt = db.prepare<[number, number, number, number, number]>(`
  SELECT c.id, c.name, c.description, c.personal_goals, c.current_focus, c.recent_activity,
         c.private_beliefs, c.relationship_to_player, c.long_term_agenda, c.tool_access,
         c.reveries, c.daily_loop,
         c.active_goal, c.current_attitude, c.current_place_id, c.agency_level,
         c.last_agent_tick_turn_id,
         c.in_transit_to_place_id, c.arrival_world_time, c.last_known_situation,
         (SELECT name FROM places WHERE id = c.current_place_id) AS current_place_name,
         (SELECT name FROM places WHERE id = c.in_transit_to_place_id) AS in_transit_to_name
    FROM characters c
   WHERE c.world_id = ?
     AND c.is_player = 0
     AND c.status != 'dead'
     AND (
       ( c.agency_level IN ('local', 'nearby', 'distant', 'agent') AND (
           c.agency_level IN ('local', 'agent')
           OR c.last_agent_tick_turn_id IS NULL
           OR (c.agency_level = 'nearby' AND ? - c.last_agent_tick_turn_id >= 2)
           OR (c.agency_level = 'distant' AND ? - c.last_agent_tick_turn_id >= 5)
           OR (? - c.last_agent_tick_turn_id >= 5)
         ) )
       -- Co-located plain-npc-tier candidates (cold-open fix): plan-eligibility
       -- (drop transient walk-ons) is decided by isPlanEligible in the use case.
       OR ( c.agency_level = 'npc' AND c.current_place_id = ? )
     )
`)
const setLastAgentTickStmt = db.prepare<[number, number]>(
  `UPDATE characters SET last_agent_tick_turn_id = ?, updated_at = datetime('now') WHERE id = ?`,
)
const findAgentNpcByNameStmt = db.prepare<[number, string]>(
  `SELECT id, recent_activity FROM characters
    WHERE world_id = ?
      AND lower(name) = lower(?)
      AND agency_level IN ('npc', 'local', 'nearby', 'distant', 'agent')
      AND is_player = 0
      AND status != 'dead'`,
)
const setFocusStmt = db.prepare<[string, number]>(
  `UPDATE characters SET current_focus = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setActivityStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET recent_activity = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setPlaceStmt = db.prepare<[number, number]>(
  `UPDATE characters SET current_place_id = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setPersonalGoalsStmt = db.prepare<[string, number]>(
  `UPDATE characters SET personal_goals = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setPrivateBeliefsStmt = db.prepare<[string, number]>(
  `UPDATE characters SET private_beliefs = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setDailyLoopIfEmptyStmt = db.prepare<[string, number]>(
  `UPDATE characters SET daily_loop = ?, updated_at = datetime('now')
     WHERE id = ? AND (daily_loop IS NULL OR trim(daily_loop) = '')`,
)
const setRelationshipToPlayerStmt = db.prepare<[string, number]>(
  `UPDATE characters SET relationship_to_player = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setLongTermAgendaStmt = db.prepare<[string, number]>(
  `UPDATE characters SET long_term_agenda = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setToolAccessStmt = db.prepare<[string, number]>(
  `UPDATE characters SET tool_access = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setInTransitToStmt = db.prepare<[number | null, number]>(
  `UPDATE characters SET in_transit_to_place_id = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setArrivalWorldTimeStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET arrival_world_time = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setLastKnownSituationStmt = db.prepare<[string, number]>(
  `UPDATE characters SET last_known_situation = ?, updated_at = datetime('now') WHERE id = ?`,
)

// SQLite adapter for CharacterRepository (spec §5.1-P1). Dumb CRUD.
export class SqliteCharacterRepository implements CharacterRepository {
  forWorld(worldId: number): Promise<Character[]> {
    return Promise.resolve(getCharactersForWorld(worldId))
  }

  inPlace(worldId: number, placeId: number): Promise<Character[]> {
    return Promise.resolve(getCharactersInPlace(worldId, placeId))
  }

  add(character: CharacterInput): Promise<{ id: number }> {
    return Promise.resolve(insertBoundedCharacter(character))
  }

  setPlace(characterId: number, placeId: number | null): Promise<void> {
    setCharacterPlace(characterId, placeId)
    return Promise.resolve()
  }

  findByExactLowerName(worldId: number, name: string): Promise<Character | null> {
    const row = findCharacterByExactLowerNameStmt.get(worldId, name) as
      | Character
      | undefined
    return Promise.resolve(row ?? null)
  }

  insert(character: ArchivistCharacterInsert): Promise<{ id: number }> {
    const row = insertCharacterStmt.get(
      character.world_id,
      character.name,
      character.description,
      character.is_player,
      character.current_place_id,
      character.memorable_facts,
      character.status,
      character.active_goal,
      character.current_attitude,
      character.observations,
    ) as { id: number }
    return Promise.resolve({ id: row.id })
  }

  update(characterId: number, patch: ArchivistCharacterUpdate): Promise<void> {
    updateCharacterStmt.run(
      patch.description,
      patch.current_place_id,
      patch.is_player,
      patch.memorable_facts,
      patch.status,
      characterId,
    )
    return Promise.resolve()
  }

  setActiveGoal(characterId: number, activeGoal: string | null): Promise<void> {
    setActiveGoalStmt.run(activeGoal, characterId)
    return Promise.resolve()
  }

  setCurrentAttitude(characterId: number, currentAttitude: string | null): Promise<void> {
    setCurrentAttitudeStmt.run(currentAttitude, characterId)
    return Promise.resolve()
  }

  setObservations(characterId: number, observations: string | null): Promise<void> {
    setObservationsStmt.run(observations, characterId)
    return Promise.resolve()
  }

  merge(characterId: number, merged: ArchivistCharacterMerge): Promise<void> {
    mergeCharacterStmt.run(
      merged.name,
      merged.description,
      merged.current_place_id,
      merged.memorable_facts,
      merged.status,
      merged.active_goal,
      merged.current_attitude,
      merged.observations,
      merged.agency_level,
      merged.personal_goals,
      merged.current_focus,
      merged.recent_activity,
      merged.private_beliefs,
      merged.relationship_to_player,
      merged.long_term_agenda,
      merged.tool_access,
      merged.appearance_count,
      merged.last_seen_turn_id,
      merged.last_agent_tick_turn_id,
      merged.player_notes,
      merged.aliases,
      characterId,
    )
    return Promise.resolve()
  }

  delete(characterId: number): Promise<void> {
    deleteCharacterStmt.run(characterId)
    return Promise.resolve()
  }

  setAliases(characterId: number, aliases: string | null): Promise<void> {
    setCharacterAliasesStmt.run(aliases, characterId)
    return Promise.resolve()
  }

  rename(name: string, characterId: number): Promise<void> {
    renameCharacterStmt.run(name, characterId)
    return Promise.resolve()
  }

  setPlayersPlace(placeId: number, worldId: number): Promise<void> {
    setPlayersPlaceStmt.run(placeId, worldId)
    return Promise.resolve()
  }

  appendPlayerNotes(characterId: number, line: string): Promise<void> {
    appendCharacterPlayerNotesStmt.run(line, line, characterId)
    return Promise.resolve()
  }

  // Delegates to the byte-identical `lib/npc-promotion` transaction; the
  // promotion decision stays in the pure `domain/services/npc-promotion` it uses.
  recordAppearancesAndAutoPromote(
    worldId: number,
    presentCharacters: Character[],
    turnId: number,
  ): Promise<AppearancePromotionResult> {
    return Promise.resolve(
      recordAppearancesAndAutoPromote(worldId, presentCharacters, turnId),
    )
  }

  agentNpcsForTick(
    worldId: number,
    tickTurnId: number,
    playerPlaceId: number | null,
  ): Promise<AgentNpcRow[]> {
    // -1 is a non-matching sentinel when the player has no place, so the
    // co-located npc-tier OR branch adds nothing (no row has current_place_id = -1).
    const rows = agentNpcsStmt.all(
      worldId,
      tickTurnId,
      tickTurnId,
      tickTurnId,
      playerPlaceId ?? -1,
    ) as AgentNpcRow[]
    return Promise.resolve(rows)
  }

  setLastAgentTick(turnId: number, characterId: number): Promise<void> {
    setLastAgentTickStmt.run(turnId, characterId)
    return Promise.resolve()
  }

  findAgentNpcByName(
    worldId: number,
    name: string,
  ): Promise<{ id: number; recent_activity: string | null } | null> {
    const row = findAgentNpcByNameStmt.get(worldId, name) as
      | { id: number; recent_activity: string | null }
      | undefined
    return Promise.resolve(row ?? null)
  }

  // Runs each present field's UPDATE separately (byte-identical to the agent's
  // per-column statements). Three-state semantics live in the use case: a key is
  // present only when the patch named that field.
  applyAgentNpcFields(characterId: number, fields: AgentNpcFields): Promise<void> {
    if (fields.current_focus !== undefined) {
      setFocusStmt.run(fields.current_focus, characterId)
    }
    if (fields.recent_activity !== undefined) {
      setActivityStmt.run(fields.recent_activity, characterId)
    }
    if (fields.current_place_id !== undefined) {
      setPlaceStmt.run(fields.current_place_id, characterId)
    }
    if (fields.personal_goals !== undefined) {
      setPersonalGoalsStmt.run(fields.personal_goals, characterId)
    }
    if (fields.private_beliefs !== undefined) {
      setPrivateBeliefsStmt.run(fields.private_beliefs, characterId)
    }
    if (fields.relationship_to_player !== undefined) {
      setRelationshipToPlayerStmt.run(fields.relationship_to_player, characterId)
    }
    if (fields.long_term_agenda !== undefined) {
      setLongTermAgendaStmt.run(fields.long_term_agenda, characterId)
    }
    if (fields.tool_access !== undefined) {
      setToolAccessStmt.run(fields.tool_access, characterId)
    }
    if (fields.in_transit_to_place_id !== undefined) {
      setInTransitToStmt.run(fields.in_transit_to_place_id, characterId)
    }
    if (fields.arrival_world_time !== undefined) {
      setArrivalWorldTimeStmt.run(fields.arrival_world_time, characterId)
    }
    if (fields.last_known_situation !== undefined) {
      setLastKnownSituationStmt.run(fields.last_known_situation, characterId)
    }
    return Promise.resolve()
  }

  setDailyLoopIfEmpty(characterId: number, dailyLoopJson: string): Promise<void> {
    setDailyLoopIfEmptyStmt.run(dailyLoopJson, characterId)
    return Promise.resolve()
  }
}

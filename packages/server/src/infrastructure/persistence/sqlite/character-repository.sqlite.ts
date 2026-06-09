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
}

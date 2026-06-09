import 'server-only'

import { db, getPlace, getPlacesForWorld, insertBoundedPlace } from '@/lib/db'
import type { Place } from '@/lib/world-state'
import type {
  ArchivistPlaceInsert,
  PlaceInput,
  PlaceMerge,
  PlaceRepository,
  PlaceUpdate,
} from '@/domain/ports/place-repository'

// Verbatim copies of the lib/archivist.ts place statements (P4a write surface —
// temporary duplication; P4b deletes the originals). Byte-identical SQL/columns/
// COALESCE/datetime('now')/WHERE so the oracle characterization tests stay green
// when the archivist is rewired onto this port.
const currentPlaceForWorldStmt = db.prepare<[number]>(
  `SELECT p.id, p.name, p.description, p.kind, p.player_notes
   FROM worlds w
   JOIN scenes s ON s.id = w.current_scene_id
   JOIN places p ON p.id = s.place_id
   WHERE w.id = ?`,
)
const insertPlaceStmt = db.prepare<[number, string, string | null, string | null]>(
  `INSERT INTO places (world_id, name, description, kind)
   VALUES (?, ?, ?, ?) RETURNING id`,
)
const updatePlaceStmt = db.prepare<[string | null, string | null, number]>(
  `UPDATE places SET
     description = COALESCE(?, description),
     kind        = COALESCE(?, kind),
     updated_at  = datetime('now')
   WHERE id = ?`,
)
const mergePlaceStmt = db.prepare<[string | null, string | null, number]>(
  `UPDATE places SET
     description = ?,
     kind        = ?,
     updated_at  = datetime('now')
   WHERE id = ?`,
)
const moveCharactersToPlaceStmt = db.prepare<[number, number]>(
  'UPDATE characters SET current_place_id = ? WHERE current_place_id = ?',
)
const moveScenesToPlaceStmt = db.prepare<[number, number]>(
  `UPDATE scenes SET place_id = ?, updated_at = datetime('now') WHERE place_id = ?`,
)
const deletePlaceStmt = db.prepare<[number]>('DELETE FROM places WHERE id = ?')
const appendPlacePlayerNotesStmt = db.prepare<[string, string, number]>(
  `UPDATE places
   SET player_notes = CASE
       WHEN player_notes IS NULL OR length(trim(player_notes)) = 0 THEN ?
       ELSE player_notes || char(10) || ?
     END,
     updated_at = datetime('now')
   WHERE id = ?`,
)
const placeNameByIdStmt = db.prepare<[number]>('SELECT name FROM places WHERE id = ?')

// SQLite adapter for PlaceRepository (spec §5.1-P1). Dumb CRUD.
export class SqlitePlaceRepository implements PlaceRepository {
  forWorld(worldId: number): Promise<Place[]> {
    return Promise.resolve(getPlacesForWorld(worldId))
  }

  byId(id: number): Promise<Place | null> {
    return Promise.resolve(getPlace(id))
  }

  add(place: PlaceInput): Promise<{ id: number }> {
    return Promise.resolve(insertBoundedPlace(place))
  }

  // currentPlaceForWorldStmt resolves the place under the world's active scene;
  // the verbatim join returns only the partial row, so hydrate the full entity
  // via getPlace to keep the port's Place shape (mirrors byId).
  currentPlaceForWorld(worldId: number): Promise<Place | null> {
    const row = currentPlaceForWorldStmt.get(worldId) as { id: number } | undefined
    return Promise.resolve(row ? getPlace(row.id) : null)
  }

  nameById(id: number): Promise<string | null> {
    const row = placeNameByIdStmt.get(id) as { name: string } | undefined
    return Promise.resolve(row?.name ?? null)
  }

  insert(place: ArchivistPlaceInsert): Promise<{ id: number }> {
    const row = insertPlaceStmt.get(
      place.world_id,
      place.name,
      place.description,
      place.kind,
    ) as { id: number }
    return Promise.resolve({ id: row.id })
  }

  update(patch: PlaceUpdate): Promise<void> {
    updatePlaceStmt.run(patch.description, patch.kind, patch.id)
    return Promise.resolve()
  }

  merge(patch: PlaceMerge): Promise<void> {
    mergePlaceStmt.run(patch.description, patch.kind, patch.id)
    return Promise.resolve()
  }

  moveCharactersToPlace(toId: number, fromId: number): Promise<void> {
    moveCharactersToPlaceStmt.run(toId, fromId)
    return Promise.resolve()
  }

  moveScenesToPlace(toId: number, fromId: number): Promise<void> {
    moveScenesToPlaceStmt.run(toId, fromId)
    return Promise.resolve()
  }

  delete(id: number): Promise<void> {
    deletePlaceStmt.run(id)
    return Promise.resolve()
  }

  appendPlayerNotes(id: number, note: string): Promise<void> {
    appendPlacePlayerNotesStmt.run(note, note, id)
    return Promise.resolve()
  }
}

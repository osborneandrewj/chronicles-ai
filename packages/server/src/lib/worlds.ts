import type { InitialState, World, WorldSummary } from '@/domain/entities'
import { db } from '@/lib/db'
import { classifyPlaceKind } from '@/lib/place-population'
import { extractSettingRegion } from '@/lib/region-extractor'

// World / WorldSummary / InitialState row TYPE defs now live in
// `domain/entities/world.ts` (spec §3.3); re-exported here for back-compat.
export type { InitialState, World, WorldSummary }

const insertWorldStmt = db.prepare<[string, string, string, string | null]>(
  `INSERT INTO worlds (name, premise, initial_state_json, setting_region)
   VALUES (?, ?, ?, ?)
   RETURNING id, name, premise, initial_state_json, setting_region, spatial_mode, template_id, ship_clock_minutes, world_layer, parent_world_id, meta_story_json, genre_tags, created_at`,
)

// Bare bounded-world insert (starship P1). Unlike createWorld, this seeds NO
// place/character/scene — the SeedBoundedWorld use case writes its own rooms and
// crew. spatial_mode is fixed to 'bounded'; template_id records the deck plan.
const insertBoundedWorldStmt = db.prepare<[string, string, string, string]>(
  `INSERT INTO worlds (name, premise, initial_state_json, spatial_mode, template_id)
   VALUES (?, ?, ?, 'bounded', ?)
   RETURNING id`,
)

const getWorldStmt = db.prepare<[number]>(
  `SELECT id, name, premise, initial_state_json, setting_region, spatial_mode, template_id, ship_clock_minutes, world_layer, parent_world_id, meta_story_json, genre_tags, created_at
   FROM worlds WHERE id = ?`,
)

const listWorldsStmt = db.prepare(`
  SELECT
    w.id, w.name, w.premise, w.created_at, w.archived_at, w.world_layer,
    COALESCE((SELECT COUNT(*) FROM turns t WHERE t.world_id = w.id AND t.role = 'assistant'), 0) AS turn_count
  FROM worlds w
  WHERE w.archived_at IS NULL
  ORDER BY w.created_at DESC, w.id DESC
`)

const listArchivedWorldsStmt = db.prepare(`
  SELECT
    w.id, w.name, w.premise, w.created_at, w.archived_at, w.world_layer,
    COALESCE((SELECT COUNT(*) FROM turns t WHERE t.world_id = w.id AND t.role = 'assistant'), 0) AS turn_count
  FROM worlds w
  WHERE w.archived_at IS NOT NULL
  ORDER BY w.archived_at DESC, w.id DESC
`)

// Simulations launched from a given hub (Phase v0.2.1, Item 2). Newest-first;
// fuels the hub's read-only "Past Simulations" archive.
const simulationsForHubStmt = db.prepare<[number]>(`
  SELECT
    w.id, w.name, w.premise, w.created_at, w.archived_at, w.world_layer,
    COALESCE((SELECT COUNT(*) FROM turns t WHERE t.world_id = w.id AND t.role = 'assistant'), 0) AS turn_count
  FROM worlds w
  WHERE w.parent_world_id = ? AND w.world_layer = 'subworld'
  ORDER BY w.created_at DESC, w.id DESC
`)

const archiveWorldStmt = db.prepare<[number]>(
  "UPDATE worlds SET archived_at = datetime('now') WHERE id = ?",
)
const unarchiveWorldStmt = db.prepare<[number]>(
  'UPDATE worlds SET archived_at = NULL WHERE id = ?',
)

const insertPlaceStmt = db.prepare<[number, string, string, string | null]>(
  `INSERT INTO places (world_id, name, description, kind) VALUES (?, ?, ?, ?) RETURNING id`,
)
const insertCharacterStmt = db.prepare<[number, string, string, number]>(
  `INSERT INTO characters (world_id, name, description, is_player, current_place_id)
   VALUES (?, ?, ?, 1, ?) RETURNING id`,
)
const insertSceneStmt = db.prepare<[number, number]>(
  `INSERT INTO scenes (world_id, place_id, title, scene_number, status, updated_at)
   VALUES (?, ?, 'Scene 1', 1, 'active', datetime('now')) RETURNING id`,
)
const setWorldCursorStmt = db.prepare<[string, number, number]>(
  'UPDATE worlds SET world_time = ?, current_scene_id = ? WHERE id = ?',
)
const setWorldTimeStmt = db.prepare<[string, number]>(
  'UPDATE worlds SET world_time = ? WHERE id = ?',
)
const setWorldSceneCursorStmt = db.prepare<[number, number]>(
  'UPDATE worlds SET current_scene_id = ? WHERE id = ?',
)
const setShipClockMinutesStmt = db.prepare<[number, number]>(
  'UPDATE worlds SET ship_clock_minutes = ? WHERE id = ?',
)
const setGenreTagsStmt = db.prepare<[string | null, number]>(
  'UPDATE worlds SET genre_tags = ? WHERE id = ?',
)

// Persist a world's genre signal (genre-coupling audit): a JSON string array of
// era/tone tags, or null to clear. Written once at creation from the chosen
// preset / quick-start genre.
export function setGenreTags(worldId: number, genreTagsJson: string | null): void {
  setGenreTagsStmt.run(genreTagsJson, worldId)
}

// Bounded-world sim write (starship P2): advance only world_time, leaving the
// scene cursor untouched (the player-less pre-sim has no active scene yet).
export function setWorldTime(worldId: number, worldTime: string): void {
  setWorldTimeStmt.run(worldTime, worldId)
}

// Bounded-world join hand-off (starship P4a): point the cursor at the initial
// scene, leaving world_time (already set by the pre-sim) untouched.
export function setWorldSceneCursor(worldId: number, sceneId: number): void {
  setWorldSceneCursorStmt.run(sceneId, worldId)
}

// Bounded-world prose-driven ship-clock write (starship P6): set the minutes-
// since-Day-1 counter. narrate-turn advances it post-stream from estimated
// elapsed in-world time; CreateStarshipWorld inits it from the boarding clock.
export function setShipClockMinutes(worldId: number, minutes: number): void {
  setShipClockMinutesStmt.run(minutes, worldId)
}

export type CreateWorldInput = {
  name: string
  premise: string
  initialState: InitialState
}

// Mirrors the place-name extraction in the v5 migration so a backfilled world
// and a freshly-created world have visually identical seed rows.
function derivePlaceName(location: string): string {
  const head = location.split(/[—–.,]/)[0]?.trim() ?? location
  const cleaned = head.length > 0 ? head : location.trim()
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned
}

export function createWorld(input: CreateWorldInput): World {
  const { name, premise, initialState } = input
  return db.transaction(() => {
    const world = insertWorldStmt.get(
      name,
      premise,
      JSON.stringify({
        time: initialState.time,
        location: initialState.location,
        identity: initialState.identity,
      }),
      null,
    ) as World

    // C1: type the seed place from the full location string so the living-place
    // sim has a profile to populate from turn one. Leaves kind null for coarse
    // locations (e.g. a bare city); the opening archivist (C2) refines it.
    const place = insertPlaceStmt.get(
      world.id,
      derivePlaceName(initialState.location),
      initialState.location,
      classifyPlaceKind(initialState.location),
    ) as { id: number }
    insertCharacterStmt.run(
      world.id,
      // Diegetic default: 'You', not the meta word 'Player'. The archivist
      // renames this row in place when the protagonist is named (A9 single-
      // player invariant), so it never spawns a second protagonist row.
      initialState.playerName?.trim() || 'You',
      initialState.identity,
      place.id,
    )
    const scene = insertSceneStmt.get(world.id, place.id) as { id: number }
    setWorldCursorStmt.run(initialState.time, scene.id, world.id)

    return world
  })()
}

export type CreateBoundedWorldInput = {
  name: string
  premise: string
  initialStateJson: string
  templateId: string
}

// Insert a bare bounded world (no seeded place/character/scene). Returns the new
// world id; the SeedBoundedWorld use case then writes rooms + crew + topology.
export function createBoundedWorld(input: CreateBoundedWorldInput): { id: number } {
  const row = insertBoundedWorldStmt.get(
    input.name,
    input.premise,
    input.initialStateJson,
    input.templateId,
  ) as { id: number }
  return { id: row.id }
}

const setSettingRegionStmt = db.prepare<[string | null, number]>(
  'UPDATE worlds SET setting_region = ? WHERE id = ?',
)

// Sync write half of the setting-region update (no LLM call). The region is now
// extracted by the CreateWorld use case; the SQLite WorldRepository adapter
// delegates here to persist it. setSettingRegionForWorld keeps the combined
// extract-then-write path for any remaining direct lib caller.
export function setSettingRegion(worldId: number, region: string | null): void {
  setSettingRegionStmt.run(region, worldId)
}

// One-shot Haiku extraction of a Nominatim-friendly region string from the
// premise. Called from the new-world server action right after createWorld,
// before the opening turn — so by the time the first player turn fires, the
// region is in place to bias real-world geocoding for that world's places.
// Kept separate from createWorld() so the rest of the codebase (tests, the
// archivist's auto-place inserts) can use the sync path.
export async function setSettingRegionForWorld(
  worldId: number,
  premise: string,
  initialLocation: string | null,
): Promise<void> {
  const region = await extractSettingRegion(premise, initialLocation)
  if (region) setSettingRegionStmt.run(region, worldId)
}

export function getWorld(id: number): World | null {
  return (getWorldStmt.get(id) as World | undefined) ?? null
}

export function listWorlds(): WorldSummary[] {
  return listWorldsStmt.all() as WorldSummary[]
}

export function listArchivedWorlds(): WorldSummary[] {
  return listArchivedWorldsStmt.all() as WorldSummary[]
}

export function simulationsForHub(hubWorldId: number): WorldSummary[] {
  return simulationsForHubStmt.all(hubWorldId) as WorldSummary[]
}

export function archiveWorld(id: number): void {
  archiveWorldStmt.run(id)
}

export function unarchiveWorld(id: number): void {
  unarchiveWorldStmt.run(id)
}

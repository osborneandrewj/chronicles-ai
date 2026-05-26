import { db } from '@/lib/db'

export type World = {
  id: number
  name: string
  premise: string
  initial_state_json: string
  created_at: string
}

export type WorldSummary = {
  id: number
  name: string
  premise: string
  created_at: string
  turn_count: number
}

// Initial-state shape supplied by the new-world form. After v0.5 this still
// seeds the first character/place/scene rows; the legacy initial_state_json
// column is also written for audit and as a fallback for any future migration.
export type InitialState = {
  time: string
  location: string
  identity: string
  playerName?: string
}

const insertWorldStmt = db.prepare<[string, string, string]>(
  `INSERT INTO worlds (name, premise, initial_state_json)
   VALUES (?, ?, ?)
   RETURNING id, name, premise, initial_state_json, created_at`,
)

const getWorldStmt = db.prepare<[number]>(
  'SELECT id, name, premise, initial_state_json, created_at FROM worlds WHERE id = ?',
)

const listWorldsStmt = db.prepare(`
  SELECT
    w.id, w.name, w.premise, w.created_at,
    COALESCE((SELECT COUNT(*) FROM turns t WHERE t.world_id = w.id AND t.role = 'assistant'), 0) AS turn_count
  FROM worlds w
  ORDER BY w.created_at DESC, w.id DESC
`)

const insertPlaceStmt = db.prepare<[number, string, string]>(
  `INSERT INTO places (world_id, name, description) VALUES (?, ?, ?) RETURNING id`,
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
    ) as World

    const place = insertPlaceStmt.get(
      world.id,
      derivePlaceName(initialState.location),
      initialState.location,
    ) as { id: number }
    insertCharacterStmt.run(
      world.id,
      initialState.playerName?.trim() || 'Player',
      initialState.identity,
      place.id,
    )
    const scene = insertSceneStmt.get(world.id, place.id) as { id: number }
    setWorldCursorStmt.run(initialState.time, scene.id, world.id)

    return world
  })()
}

export function getWorld(id: number): World | null {
  return (getWorldStmt.get(id) as World | undefined) ?? null
}

export function listWorlds(): WorldSummary[] {
  return listWorldsStmt.all() as WorldSummary[]
}

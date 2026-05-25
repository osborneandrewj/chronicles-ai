import { db } from '@/lib/db'
import { INITIAL_STATE_FALLBACK, type WorldState } from '@/lib/state'

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

export type CreateWorldInput = {
  name: string
  premise: string
  initialState: WorldState
}

export function createWorld(input: CreateWorldInput): World {
  return insertWorldStmt.get(
    input.name,
    input.premise,
    JSON.stringify(input.initialState),
  ) as World
}

export function getWorld(id: number): World | null {
  return (getWorldStmt.get(id) as World | undefined) ?? null
}

export function listWorlds(): WorldSummary[] {
  return listWorldsStmt.all() as WorldSummary[]
}

export function getWorldInitialState(world: World): WorldState {
  try {
    const parsed = JSON.parse(world.initial_state_json) as Partial<WorldState>
    return {
      time: parsed.time ?? INITIAL_STATE_FALLBACK.time,
      location: parsed.location ?? INITIAL_STATE_FALLBACK.location,
      identity: parsed.identity ?? INITIAL_STATE_FALLBACK.identity,
    }
  } catch {
    return INITIAL_STATE_FALLBACK
  }
}

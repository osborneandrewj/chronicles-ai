import 'server-only'

import type { SimulationSession, SimulationStatus } from '@/domain/entities'
import type { CreateSessionInput, SessionRepository } from '@/domain/ports/session-repository'
import { db } from '@/lib/db'

// SQLite adapter for SessionRepository (Phase C, C2). Dumb CRUD over the
// simulation_session pointer table; the row columns mirror the SimulationSession
// entity 1:1, so reads cast directly.

const insertStmt = db.prepare<[number, string, number | null, string]>(
  `INSERT INTO simulation_session (hub_world_id, player_identity, subworld_world_id, status)
   VALUES (?, ?, ?, ?)
   RETURNING id, hub_world_id, subworld_world_id, player_identity, status, has_awoken, lucidity, created_at, updated_at`,
)
const byIdStmt = db.prepare<[number]>('SELECT * FROM simulation_session WHERE id = ?')
const byWorldStmt = db.prepare<[number, number]>(
  `SELECT * FROM simulation_session
   WHERE hub_world_id = ? OR subworld_world_id = ?
   ORDER BY id DESC LIMIT 1`,
)
const setSubworldStmt = db.prepare<[number | null, number]>(
  "UPDATE simulation_session SET subworld_world_id = ?, updated_at = datetime('now') WHERE id = ?",
)
const flipStmt = db.prepare<[string, number]>(
  "UPDATE simulation_session SET status = ?, updated_at = datetime('now') WHERE id = ?",
)
const setAwokenStmt = db.prepare<[number, number]>(
  "UPDATE simulation_session SET has_awoken = ?, updated_at = datetime('now') WHERE id = ?",
)
const setLucidityStmt = db.prepare<[number, number]>(
  "UPDATE simulation_session SET lucidity = ?, updated_at = datetime('now') WHERE id = ?",
)

export class SqliteSessionRepository implements SessionRepository {
  create(input: CreateSessionInput): Promise<SimulationSession> {
    const row = insertStmt.get(
      input.hub_world_id,
      input.player_identity,
      input.subworld_world_id ?? null,
      input.status ?? 'in_subworld',
    ) as SimulationSession
    return Promise.resolve(row)
  }

  byId(id: number): Promise<SimulationSession | null> {
    return Promise.resolve((byIdStmt.get(id) as SimulationSession | undefined) ?? null)
  }

  byWorld(worldId: number): Promise<SimulationSession | null> {
    return Promise.resolve((byWorldStmt.get(worldId, worldId) as SimulationSession | undefined) ?? null)
  }

  setSubworld(id: number, subworldWorldId: number | null): Promise<void> {
    setSubworldStmt.run(subworldWorldId, id)
    return Promise.resolve()
  }

  flip(id: number, status: SimulationStatus): Promise<void> {
    flipStmt.run(status, id)
    return Promise.resolve()
  }

  setAwoken(id: number, awoken: boolean): Promise<void> {
    setAwokenStmt.run(awoken ? 1 : 0, id)
    return Promise.resolve()
  }

  setLucidity(id: number, lucidity: number): Promise<void> {
    setLucidityStmt.run(lucidity, id)
    return Promise.resolve()
  }
}

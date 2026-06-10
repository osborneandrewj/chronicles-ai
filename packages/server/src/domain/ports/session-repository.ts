import type { SimulationSession, SimulationStatus } from '@/domain/entities'

// SessionRepository (Phase C, C2) — dumb CRUD over the simulation_session
// pointer. Deciding logic (which world is active, what is concealed) lives in
// the use cases and pure services; this is the persistence seam only. Async by
// mandate (spec §5.3).

export type CreateSessionInput = {
  hub_world_id: number
  player_identity: string
  subworld_world_id?: number | null
  status?: SimulationStatus
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SimulationSession>
  byId(id: number): Promise<SimulationSession | null>
  // The session a world participates in (as either its hub or its subworld).
  // This is how the route resolves the active session from a URL world id.
  byWorld(worldId: number): Promise<SimulationSession | null>
  // Point the session at the subworld currently being played.
  setSubworld(id: number, subworldWorldId: number | null): Promise<void>
  // Flip in_hub <-> in_subworld.
  flip(id: number, status: SimulationStatus): Promise<void>
  // The concealment gate — set true on the first awakening.
  setAwoken(id: number, awoken: boolean): Promise<void>
  // Reality-bending track (D1).
  setLucidity(id: number, lucidity: number): Promise<void>
}

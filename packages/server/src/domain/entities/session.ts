// SimulationSession entity (Phase C, C2). The durable pointer that says where
// the player currently is: which hub they belong to and, while playing, which
// subworld (historical simulation) is live. The route resolves the active
// world_id through this; `has_awoken` is the concealment gate (false until the
// first awakening reveals the hub); `lucidity` is the reality-bending track (D1).
// Pure type declaration — no I/O.

export type SimulationStatus = 'in_hub' | 'in_subworld'

export type SimulationSession = {
  id: number
  hub_world_id: number
  subworld_world_id: number | null
  player_identity: string
  status: SimulationStatus
  // 0|1 — once true, the hub becomes a legitimate, inspectable world.
  has_awoken: number
  lucidity: number
  created_at: string
  updated_at: string
}

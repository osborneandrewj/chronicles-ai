import type { World, WorldSummary } from '@/lib/worlds'

// WorldRepository (spec §3.4) — dumb CRUD over the `worlds` aggregate. World
// *creation* (seeding place/character/scene, region extraction) is deciding
// logic that stays in `worlds.ts` until P4; this port exposes only the flat
// read/archive operations. Async by mandate (spec §5.3).
export interface WorldRepository {
  getWorld(id: number): Promise<World | null>
  listWorlds(): Promise<WorldSummary[]>
  listArchivedWorlds(): Promise<WorldSummary[]>
  archiveWorld(id: number): Promise<void>
  unarchiveWorld(id: number): Promise<void>
  /** (world_time, current_scene_id) cursor for a world. */
  cursor(worldId: number): Promise<{ world_time: string | null; current_scene_id: number | null }>
}

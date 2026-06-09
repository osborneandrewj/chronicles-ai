import type { World, WorldSummary } from '@/lib/worlds'

// Input for createBounded (starship P1). A bounded world is created *bare* — no
// auto-seeded place/character/scene (unlike open-world creation, which seeds a
// starting place + player + Scene 1). The SeedBoundedWorld use case writes its
// own rooms/crew after this returns. `initialStateJson` is the already-stringified
// initial_state_json payload; `templateId` records which deck plan seeded it.
export type CreateBoundedWorldInput = {
  name: string
  premise: string
  initialStateJson: string
  templateId: string
}

// WorldRepository (spec §3.4) — dumb CRUD over the `worlds` aggregate. Open-world
// *creation* (seeding place/character/scene, region extraction) is deciding logic
// that stays in `worlds.ts` until P4; this port exposes the flat read/archive
// operations plus `createBounded`, the bare insert the bounded-world seeder needs.
// Async by mandate (spec §5.3).
export interface WorldRepository {
  /**
   * Insert ONLY a `worlds` row with spatial_mode='bounded' + the template id.
   * Does NOT auto-seed a place/character/scene; the seeder writes those itself.
   */
  createBounded(input: CreateBoundedWorldInput): Promise<{ id: number }>
  getWorld(id: number): Promise<World | null>
  listWorlds(): Promise<WorldSummary[]>
  listArchivedWorlds(): Promise<WorldSummary[]>
  archiveWorld(id: number): Promise<void>
  unarchiveWorld(id: number): Promise<void>
  /** (world_time, current_scene_id) cursor for a world. */
  cursor(worldId: number): Promise<{ world_time: string | null; current_scene_id: number | null }>
}

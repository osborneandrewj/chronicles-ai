import type { WorldLayer } from '@/domain/entities'
import type { InitialState, World, WorldSummary } from '@/lib/worlds'

// Input for createOpen (P3 cutover). An open world is seeded eagerly: the
// `worlds` row plus a starting place (derived from `initialState.location`), a
// player character standing there, an active Scene 1, and the world cursor —
// exactly the rows `lib/worlds.createWorld` writes today. `initialState` carries
// the player's chosen identity/location/time (and optional name); the setting
// region is computed by the use case and written via `setSettingRegion`.
export type CreateOpenWorldInput = {
  name: string
  premise: string
  initialState: InitialState
}

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
  /**
   * Seed an OPEN world: the `worlds` row + a starting place (derived from
   * `initialState.location`), a player character there, an active Scene 1, and
   * the world cursor (world_time + current_scene_id). Mirrors the open-world
   * seed `lib/worlds.createWorld` writes today.
   */
  createOpen(input: CreateOpenWorldInput): Promise<{ id: number }>
  getWorld(id: number): Promise<World | null>
  listWorlds(): Promise<WorldSummary[]>
  listArchivedWorlds(): Promise<WorldSummary[]>
  /** Simulations launched from a hub (parent_world_id = hubId), newest-first. */
  simulationsForHub(hubWorldId: number): Promise<WorldSummary[]>
  archiveWorld(id: number): Promise<void>
  unarchiveWorld(id: number): Promise<void>
  /** (world_time, current_scene_id) cursor for a world. */
  cursor(worldId: number): Promise<{ world_time: string | null; current_scene_id: number | null }>
  /** Advance only world_time (the P2 pre-sim clock), leaving the scene cursor. */
  setWorldTime(worldId: number, worldTime: string): Promise<void>
  /**
   * Set the prose-driven ship-clock counter (minutes since the Day-1 00:00
   * baseline) for a bounded world (starship P6). `getWorld` returns it as
   * `ship_clock_minutes`; the narrate-turn pipeline advances it post-stream.
   */
  setShipClockMinutes(worldId: number, minutes: number): Promise<void>
  /**
   * Point the world cursor at a scene — the archivist's `setCurrentSceneStmt`
   * mirror (P4a write surface). Sets ONLY current_scene_id; world_time is left
   * untouched. (Distinct port entry from `setCursor` while the archivist's own
   * statement is strangled behind this port; the two converge at P4b.)
   */
  setCurrentScene(sceneId: number, worldId: number): Promise<void>
  /**
   * Point the world cursor at a scene (the P4a join hand-off). Sets ONLY
   * current_scene_id; world_time is already set by the pre-sim.
   */
  setCursor(worldId: number, sceneId: number): Promise<void>
  /** Set (or clear) the world's geocoding setting-region anchor. */
  setSettingRegion(worldId: number, region: string | null): Promise<void>
  /**
   * Mark a world's simulation-hub layer + parent (Phase C). 'hub' for the
   * concealed home base, 'subworld' for a simulation linked to its hub via
   * `parentWorldId`. Leaves all other fields untouched.
   */
  setLayer(worldId: number, layer: WorldLayer, parentWorldId: number | null): Promise<void>
  /** Store the hub-only Meta-Story Bible JSON (Phase C, C8). */
  setMetaStory(worldId: number, metaStoryJson: string): Promise<void>
  /**
   * Store the world's genre signal (genre-coupling audit): a JSON string array
   * of era/tone tags, or null to clear. Written once at creation. Leaves all
   * other fields untouched.
   */
  setGenreTags(worldId: number, genreTagsJson: string | null): Promise<void>
}

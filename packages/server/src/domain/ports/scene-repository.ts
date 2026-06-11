import type { Scene } from '@/lib/world-state'

// Input for SceneRepository.add (starship P4a). A bare scene insert — the
// CreateStarshipWorld use case writes the initial active Scene 1 after the
// pre-sim, then points the world cursor at it. `status` is a scene status
// string ('active').
export type SceneInput = {
  world_id: number
  place_id: number
  title: string
  scene_number: number
  status: string
}

// Input for SceneRepository.close (archivist P4b). Mirrors closeSceneStmt: set
// status='completed', record the player-supplied summary, stamp the closing
// turn id.
export type SceneCloseInput = {
  summary: string
  closedAtTurn: number
  id: number
}

// Input for SceneRepository.insert (archivist P4b). Mirrors insertSceneStmt: a
// new active scene opened at a turn. Distinct from `add` (the bounded-world
// seed insert) — this is the archivist's scene-open path and stamps
// opened_at_turn rather than a literal status string.
export type SceneInsertInput = {
  world_id: number
  place_id: number
  title: string
  scene_number: number
  opened_at_turn: number
}

// Input for SceneRepository.updateContext (archivist P4b). Mirrors
// updateSceneContextStmt's COALESCE semantics: null leaves the field unchanged,
// a value overwrites it.
export type SceneContextInput = {
  scene_mood: string | null
  pace: string | null
  focus: string | null
  id: number
}

// SceneRepository (spec §3.4) — dumb CRUD over the `scenes` aggregate. Scene
// open/close transition logic is deciding logic that stays out of the adapter
// (P4); `add` is the bare insert the bounded-world join needs. Async by mandate
// (spec §5.3).
export interface SceneRepository {
  forWorld(worldId: number): Promise<Scene[]>
  activeForWorld(worldId: number): Promise<Scene | null>
  add(scene: SceneInput): Promise<{ id: number }>
  // Archivist write surface (P4a, called in P4b). The deciding logic (which
  // scene to close/open, sequencing) stays in the use case; these are dumb
  // writes/reads byte-mirroring the archivist's prepared statements.
  close(input: SceneCloseInput): Promise<void>
  insert(input: SceneInsertInput): Promise<{ id: number }>
  updateContext(input: SceneContextInput): Promise<void>
  autoClose(closedAtTurn: number, id: number): Promise<void>
  maxSceneNumber(worldId: number): Promise<number>
  currentSceneId(worldId: number): Promise<number | null>
  currentScenePlaceId(worldId: number): Promise<number | null>
}

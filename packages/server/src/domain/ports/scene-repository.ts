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

// SceneRepository (spec §3.4) — dumb CRUD over the `scenes` aggregate. Scene
// open/close transition logic is deciding logic that stays out of the adapter
// (P4); `add` is the bare insert the bounded-world join needs. Async by mandate
// (spec §5.3).
export interface SceneRepository {
  forWorld(worldId: number): Promise<Scene[]>
  activeForWorld(worldId: number): Promise<Scene | null>
  add(scene: SceneInput): Promise<{ id: number }>
}

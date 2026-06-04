import type { Scene } from '@/lib/world-state'

// SceneRepository (spec §3.4) — dumb CRUD reads over the `scenes` aggregate.
// Scene open/close transition logic is deciding logic that stays out of the
// adapter (P4). Async by mandate (spec §5.3).
export interface SceneRepository {
  forWorld(worldId: number): Promise<Scene[]>
  activeForWorld(worldId: number): Promise<Scene | null>
}

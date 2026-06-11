import 'server-only'

import { db, getWorldCursor } from '@/lib/db'
import {
  archiveWorld,
  createBoundedWorld,
  createWorld,
  getWorld,
  listArchivedWorlds,
  listWorlds,
  simulationsForHub,
  setSettingRegion,
  setShipClockMinutes,
  setWorldSceneCursor,
  setWorldTime,
  unarchiveWorld,
  type World,
  type WorldSummary,
} from '@/lib/worlds'
import type {
  CreateBoundedWorldInput,
  CreateOpenWorldInput,
  WorldRepository,
} from '@/domain/ports/world-repository'

// Verbatim copy of lib/archivist.ts `setCurrentSceneStmt` (P4a write surface —
// temporary duplication; P4b deletes the original). Byte-identical SQL/columns/
// WHERE so the oracle characterization tests stay green when the archivist is
// rewired onto this port.
const setCurrentSceneStmt = db.prepare<[number, number]>(
  'UPDATE worlds SET current_scene_id = ? WHERE id = ?',
)
// Phase C: simulation-hub layering writes.
const setLayerStmt = db.prepare<[string, number | null, number]>(
  'UPDATE worlds SET world_layer = ?, parent_world_id = ? WHERE id = ?',
)
const setMetaStoryStmt = db.prepare<[string, number]>(
  'UPDATE worlds SET meta_story_json = ? WHERE id = ?',
)

// SQLite adapter for WorldRepository (spec §5.1-P1). Delegates to the flat
// read/archive functions in `worlds.ts` and the cursor reader in `db.ts`. World
// *creation* (seeding) stays in `worlds.ts` as deciding logic until P4.
export class SqliteWorldRepository implements WorldRepository {
  createBounded(input: CreateBoundedWorldInput): Promise<{ id: number }> {
    return Promise.resolve(createBoundedWorld(input))
  }

  createOpen(input: CreateOpenWorldInput): Promise<{ id: number }> {
    const world = createWorld(input)
    return Promise.resolve({ id: world.id })
  }

  getWorld(id: number): Promise<World | null> {
    return Promise.resolve(getWorld(id))
  }

  listWorlds(): Promise<WorldSummary[]> {
    return Promise.resolve(listWorlds())
  }

  listArchivedWorlds(): Promise<WorldSummary[]> {
    return Promise.resolve(listArchivedWorlds())
  }

  simulationsForHub(hubWorldId: number): Promise<WorldSummary[]> {
    return Promise.resolve(simulationsForHub(hubWorldId))
  }

  archiveWorld(id: number): Promise<void> {
    archiveWorld(id)
    return Promise.resolve()
  }

  unarchiveWorld(id: number): Promise<void> {
    unarchiveWorld(id)
    return Promise.resolve()
  }

  cursor(
    worldId: number,
  ): Promise<{ world_time: string | null; current_scene_id: number | null }> {
    return Promise.resolve(getWorldCursor(worldId))
  }

  setWorldTime(worldId: number, worldTime: string): Promise<void> {
    setWorldTime(worldId, worldTime)
    return Promise.resolve()
  }

  setShipClockMinutes(worldId: number, minutes: number): Promise<void> {
    setShipClockMinutes(worldId, minutes)
    return Promise.resolve()
  }

  setCurrentScene(sceneId: number, worldId: number): Promise<void> {
    setCurrentSceneStmt.run(sceneId, worldId)
    return Promise.resolve()
  }

  setCursor(worldId: number, sceneId: number): Promise<void> {
    setWorldSceneCursor(worldId, sceneId)
    return Promise.resolve()
  }

  setSettingRegion(worldId: number, region: string | null): Promise<void> {
    setSettingRegion(worldId, region)
    return Promise.resolve()
  }

  setLayer(
    worldId: number,
    layer: 'hub' | 'subworld' | 'standalone',
    parentWorldId: number | null,
  ): Promise<void> {
    setLayerStmt.run(layer, parentWorldId, worldId)
    return Promise.resolve()
  }

  setMetaStory(worldId: number, metaStoryJson: string): Promise<void> {
    setMetaStoryStmt.run(metaStoryJson, worldId)
    return Promise.resolve()
  }
}

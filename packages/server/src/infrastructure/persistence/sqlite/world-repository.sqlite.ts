import 'server-only'

import { getWorldCursor } from '@/lib/db'
import {
  archiveWorld,
  createBoundedWorld,
  getWorld,
  listArchivedWorlds,
  listWorlds,
  unarchiveWorld,
  type World,
  type WorldSummary,
} from '@/lib/worlds'
import type {
  CreateBoundedWorldInput,
  WorldRepository,
} from '@/domain/ports/world-repository'

// SQLite adapter for WorldRepository (spec §5.1-P1). Delegates to the flat
// read/archive functions in `worlds.ts` and the cursor reader in `db.ts`. World
// *creation* (seeding) stays in `worlds.ts` as deciding logic until P4.
export class SqliteWorldRepository implements WorldRepository {
  createBounded(input: CreateBoundedWorldInput): Promise<{ id: number }> {
    return Promise.resolve(createBoundedWorld(input))
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
}

import 'server-only'

import {
  getLatestOccupancySnapshotRow,
  getPlaceProfileRow,
  getPopulationTemplatesForKind,
  insertOccupancySnapshot,
  insertPlaceProfile,
  type OccupancySnapshotRow,
  type PlaceProfileRow,
  type PopulationTemplateRow,
} from '@/lib/db'
import type { OccupancyRepository } from '@/domain/ports/occupancy-repository'

// SQLite adapter for OccupancyRepository (spec §5.1-P1). Persists place
// profiles, population templates, and append-only occupancy snapshots. The
// occupancy simulation stays a pure domain service (P4).
export class SqliteOccupancyRepository implements OccupancyRepository {
  placeProfile(worldId: number, placeId: number): Promise<PlaceProfileRow | null> {
    return Promise.resolve(getPlaceProfileRow(worldId, placeId))
  }

  insertPlaceProfile(input: {
    worldId: number
    placeId: number
    profileKind: string
    capacityMin: number
    capacityMax: number
    typicalRolesJson: string
    matchTagsJson: string
    trafficLevel: 'none' | 'low' | 'medium' | 'high' | 'surge'
  }): Promise<void> {
    insertPlaceProfile(input)
    return Promise.resolve()
  }

  populationTemplatesForKind(
    worldId: number,
    profileKind: string,
  ): Promise<PopulationTemplateRow[]> {
    return Promise.resolve(getPopulationTemplatesForKind(worldId, profileKind))
  }

  insertSnapshot(input: {
    worldId: number
    placeId: number
    sceneId: number | null
    sourceTurnId: number | null
    worldTime: string | null
    occupancyJson: string
  }): Promise<void> {
    insertOccupancySnapshot(input)
    return Promise.resolve()
  }

  latestSnapshot(worldId: number, placeId: number): Promise<OccupancySnapshotRow | null> {
    return Promise.resolve(getLatestOccupancySnapshotRow(worldId, placeId))
  }
}

import type {
  OccupancySnapshotRow,
  PlaceProfileRow,
  PopulationTemplateRow,
} from '@/lib/db'

// OccupancyRepository (spec §3.4) — dumb CRUD over place profiles, population
// templates, and append-only occupancy snapshots. The occupancy *simulation* is
// a pure domain service (P4); this port persists its inputs and outputs. Async
// by mandate (spec §5.3).
export interface OccupancyRepository {
  placeProfile(worldId: number, placeId: number): Promise<PlaceProfileRow | null>
  insertPlaceProfile(input: {
    worldId: number
    placeId: number
    profileKind: string
    capacityMin: number
    capacityMax: number
    typicalRolesJson: string
    matchTagsJson: string
    trafficLevel: 'none' | 'low' | 'medium' | 'high' | 'surge'
  }): Promise<void>
  populationTemplatesForKind(
    worldId: number,
    profileKind: string,
  ): Promise<PopulationTemplateRow[]>
  insertSnapshot(input: {
    worldId: number
    placeId: number
    sceneId: number | null
    sourceTurnId: number | null
    worldTime: string | null
    occupancyJson: string
  }): Promise<void>
  latestSnapshot(worldId: number, placeId: number): Promise<OccupancySnapshotRow | null>
}

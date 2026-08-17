// Shared port-driven state-assembly helpers for SQLite-default tests (A0).
// After the SQLite-direct twins were deleted, every assembly goes through the
// container's ports (which on SQLite delegate to the same lib/db readers).
import { getContainer } from '@/composition/container'
import {
  buildPlaceOccupancySnapshot,
  type PlaceOccupancyDeps,
  type TrafficEra,
} from '@/lib/place-population'
import {
  getFullWorldState,
  getNarratorWorldState,
  type FullWorldStateDeps,
  type NarratorWorldStateDeps,
} from '@/lib/world-state'

export function narratorStateDeps(): NarratorWorldStateDeps {
  const c = getContainer()
  return {
    worlds: c.worlds,
    scenes: c.scenes,
    places: c.places,
    characters: c.characters,
    occupancy: c.occupancy,
    dossiers: c.dossiers,
  }
}

export function fullWorldStateDeps(): FullWorldStateDeps {
  const c = getContainer()
  return {
    worlds: c.worlds,
    turns: c.turns,
    characters: c.characters,
    places: c.places,
    scenes: c.scenes,
    dossiers: c.dossiers,
    reveries: c.reveries,
    worldEvents: c.worldEvents,
  }
}

export function placeOccupancyDeps(): PlaceOccupancyDeps {
  const c = getContainer()
  return {
    worlds: c.worlds,
    scenes: c.scenes,
    places: c.places,
    dossiers: c.dossiers,
    occupancy: c.occupancy,
  }
}

export function loadNarratorState(worldId: number) {
  return getNarratorWorldState(narratorStateDeps(), worldId)
}

export function loadFullWorldState(worldId: number) {
  return getFullWorldState(fullWorldStateDeps(), worldId)
}

export function loadOccupancySnapshot(
  worldId: number,
  sourceTurnId: number | null,
  era: TrafficEra = 'modern',
) {
  return buildPlaceOccupancySnapshot(placeOccupancyDeps(), worldId, sourceTurnId, era)
}

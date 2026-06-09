import 'server-only'

import { getPlace, getPlacesForWorld, insertBoundedPlace } from '@/lib/db'
import type { Place } from '@/lib/world-state'
import type { PlaceInput, PlaceRepository } from '@/domain/ports/place-repository'

// SQLite adapter for PlaceRepository (spec §5.1-P1). Dumb CRUD.
export class SqlitePlaceRepository implements PlaceRepository {
  forWorld(worldId: number): Promise<Place[]> {
    return Promise.resolve(getPlacesForWorld(worldId))
  }

  byId(id: number): Promise<Place | null> {
    return Promise.resolve(getPlace(id))
  }

  add(place: PlaceInput): Promise<{ id: number }> {
    return Promise.resolve(insertBoundedPlace(place))
  }
}

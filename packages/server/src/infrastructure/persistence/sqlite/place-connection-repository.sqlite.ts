import 'server-only'

import { getPlaceConnectionsForWorld, insertPlaceConnection } from '@/lib/db'
import type { PlaceConnection } from '@/domain/entities'
import type {
  PlaceConnectionInput,
  PlaceConnectionRepository,
} from '@/domain/ports/place-connection-repository'

// SQLite adapter for PlaceConnectionRepository (starship P1). Dumb CRUD over the
// `place_connections` topology graph. `created_at` is stamped with datetime('now')
// in the insert statement, consistent with the sibling write adapters. Graph /
// connectivity validation stays in the `deck-graph` domain service.
export class SqlitePlaceConnectionRepository implements PlaceConnectionRepository {
  forWorld(worldId: number): Promise<PlaceConnection[]> {
    return Promise.resolve(getPlaceConnectionsForWorld(worldId))
  }

  add(edges: PlaceConnectionInput[]): Promise<void> {
    for (const edge of edges) insertPlaceConnection(edge)
    return Promise.resolve()
  }
}

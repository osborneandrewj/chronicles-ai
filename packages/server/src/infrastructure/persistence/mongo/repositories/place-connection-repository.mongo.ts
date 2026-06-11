import 'server-only'

import type { PlaceConnection } from '@/domain/entities'
import type {
  PlaceConnectionInput,
  PlaceConnectionRepository,
} from '@/domain/ports/place-connection-repository'

import type { MongoContext } from '../mongo-context'
import { mapPlaceConnection } from './mappers'

// Mongo PlaceConnectionRepository (starship P1). Dumb CRUD over the
// `place_connections` topology graph. Ids come from the shared counter;
// `createdAt` is stamped here (the SQLite analog of datetime('now')). Graph /
// connectivity validation stays in the `deck-graph` domain service.
export class MongoPlaceConnectionRepository implements PlaceConnectionRepository {
  constructor(private readonly ctx: MongoContext) {}

  async forWorld(worldId: number): Promise<PlaceConnection[]> {
    const docs = await this.ctx.models.PlaceConnection.find({ worldId })
      .sort({ id: 1 })
      .lean()
    return docs.map(mapPlaceConnection)
  }

  async add(edges: PlaceConnectionInput[]): Promise<void> {
    const session = this.ctx.currentSession ?? undefined
    for (const edge of edges) {
      const id = await this.ctx.nextSeq('placeConnectionId')
      await this.ctx.models.PlaceConnection.create(
        [
          {
            id,
            worldId: edge.world_id,
            fromPlaceId: edge.from_place_id,
            toPlaceId: edge.to_place_id,
            kind: edge.kind,
            bidirectional: edge.bidirectional,
            createdAt: new Date(),
          },
        ],
        { session },
      )
    }
  }
}

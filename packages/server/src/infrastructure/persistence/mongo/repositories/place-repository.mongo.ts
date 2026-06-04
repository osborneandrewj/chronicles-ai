import 'server-only'

import type { Place } from '@/lib/world-state'
import type { PlaceRepository } from '@/domain/ports/place-repository'

import type { MongoContext } from '../mongo-context'
import { mapPlace } from './mappers'

// Mongo PlaceRepository (spec §4.2) — dumb CRUD reads over `places`. Geo
// resolution write-back is orchestration that stays in the use case (P5).
export class MongoPlaceRepository implements PlaceRepository {
  constructor(private readonly ctx: MongoContext) {}

  async forWorld(worldId: number): Promise<Place[]> {
    const docs = await this.ctx.models.Place.find({ worldId }).sort({ id: 1 }).lean()
    return docs.map(mapPlace)
  }

  async byId(id: number): Promise<Place | null> {
    const doc = await this.ctx.models.Place.findOne({ id }).lean()
    return doc ? mapPlace(doc) : null
  }
}

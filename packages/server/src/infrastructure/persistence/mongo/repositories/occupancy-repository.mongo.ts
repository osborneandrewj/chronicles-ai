import 'server-only'

import type {
  OccupancySnapshotRow,
  PlaceProfileRow,
  PopulationTemplateRow,
} from '@/domain/entities'
import type { OccupancyRepository } from '@/domain/ports/occupancy-repository'

import type { MongoContext } from '../mongo-context'
import {
  mapOccupancySnapshot,
  mapPlaceProfile,
  mapPopulationTemplate,
} from './mappers'

// Mongo OccupancyRepository (spec §4.2). Place profiles are embedded on the
// place doc as `profile` (the absorbed `place_profiles` 1:1, spec §4.2):
//   - `insertPlaceProfile` mirrors `ON CONFLICT(world_id, place_id) DO NOTHING`
//     — only set the profile if the place has none.
//   - `populationTemplatesForKind` mirrors `WHERE place_profile_kind = ? OR
//     place_profile_kind IS NULL`, ordered by id ASC.
//   - occupancy snapshots are an append-only collection (the shipped SQLite path
//     does not prune them; spec §4.6's retention prune is honored where the
//     SQLite reality enforces it — here the insert stays append-only to keep the
//     two stores byte-identical). The latest snapshot is `id DESC LIMIT 1`.
export class MongoOccupancyRepository implements OccupancyRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get session() {
    return this.ctx.currentSession ?? undefined
  }

  async placeProfile(
    worldId: number,
    placeId: number,
  ): Promise<PlaceProfileRow | null> {
    const place = await this.ctx.models.Place.findOne({ worldId, id: placeId }).lean()
    if (!place || !place.profile) return null
    return mapPlaceProfile({
      id: place.id,
      worldId: place.worldId,
      placeId: place.id,
      profile: place.profile as {
        profileKind: string
        capacityMin: number
        capacityMax: number
        typicalRolesJson: string
        openHoursJson: string | null
        trafficLevel: PlaceProfileRow['traffic_level']
        ambienceTagsJson: string
        matchTagsJson: string
        encounterRulesJson: string
      },
      createdAt: place.createdAt,
      updatedAt: place.updatedAt,
    })
  }

  async insertPlaceProfile(input: {
    worldId: number
    placeId: number
    profileKind: string
    capacityMin: number
    capacityMax: number
    typicalRolesJson: string
    matchTagsJson: string
    trafficLevel: 'none' | 'low' | 'medium' | 'high' | 'surge'
  }): Promise<void> {
    // ON CONFLICT DO NOTHING: only write profile if the place has none yet.
    await this.ctx.models.Place.updateOne(
      { worldId: input.worldId, id: input.placeId, profile: null },
      {
        $set: {
          profile: {
            profileKind: input.profileKind,
            capacityMin: input.capacityMin,
            capacityMax: input.capacityMax,
            typicalRolesJson: input.typicalRolesJson,
            openHoursJson: null,
            ambienceTagsJson: '[]',
            matchTagsJson: input.matchTagsJson,
            encounterRulesJson: '[]',
            trafficLevel: input.trafficLevel,
          },
        },
      },
      { session: this.session },
    )
  }

  async populationTemplatesForKind(
    worldId: number,
    profileKind: string,
  ): Promise<PopulationTemplateRow[]> {
    const docs = await this.ctx.models.PopulationTemplate.find({
      worldId,
      $or: [{ placeProfileKind: profileKind }, { placeProfileKind: null }],
    })
      .sort({ id: 1 })
      .lean()
    return docs.map(mapPopulationTemplate)
  }

  async insertSnapshot(input: {
    worldId: number
    placeId: number
    sceneId: number | null
    sourceTurnId: number | null
    worldTime: string | null
    occupancyJson: string
  }): Promise<void> {
    const id = await this.ctx.nextSeq('occupancySnapshotId')
    await this.ctx.models.OccupancySnapshot.create(
      [
        {
          id,
          worldId: input.worldId,
          placeId: input.placeId,
          sceneId: input.sceneId,
          sourceTurnId: input.sourceTurnId,
          worldTime: input.worldTime,
          occupancyJson: input.occupancyJson,
          createdAt: new Date(),
        },
      ],
      { session: this.session },
    )
  }

  async latestSnapshot(
    worldId: number,
    placeId: number,
  ): Promise<OccupancySnapshotRow | null> {
    const doc = await this.ctx.models.OccupancySnapshot.findOne({ worldId, placeId })
      .sort({ id: -1 })
      .lean()
    return doc ? mapOccupancySnapshot(doc) : null
  }
}

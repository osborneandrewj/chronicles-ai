import 'server-only'

import type { Place } from '@/lib/world-state'
import type {
  ArchivistPlaceInsert,
  PlaceGeoResolution,
  PlaceInput,
  PlaceMerge,
  PlaceRepository,
  PlaceUpdate,
} from '@/domain/ports/place-repository'

import type { MongoContext } from '../mongo-context'
import { mapPlace } from './mappers'

// Mongo PlaceRepository (spec §4.2) — dumb CRUD over `places`. Geo resolution
// write-back is orchestration that stays in the use case (P5). The archivist
// write surface (P4) mirrors the byte-identical SQLite statements; the merge /
// resolution decision stays in the pure domain service the use case runs.
export class MongoPlaceRepository implements PlaceRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get session() {
    return this.ctx.currentSession ?? undefined
  }

  async forWorld(worldId: number): Promise<Place[]> {
    const docs = await this.ctx.models.Place.find({ worldId })
      .sort({ id: 1 })
      .session(this.session ?? null)
      .lean()
    return docs.map(mapPlace)
  }

  async byId(id: number): Promise<Place | null> {
    const doc = await this.ctx.models.Place.findOne({ id })
      .session(this.session ?? null)
      .lean()
    return doc ? mapPlace(doc) : null
  }

  async add(place: PlaceInput): Promise<{ id: number }> {
    const id = await this.ctx.nextSeq('placeId')
    const now = new Date()
    await this.ctx.models.Place.create(
      [
        {
          id,
          worldId: place.world_id,
          name: place.name,
          nameKey: place.name.toLowerCase(),
          description: place.description,
          kind: place.kind,
          deck: place.deck,
          layoutHint: place.layout_hint,
          playerNotes: null,
          geo: {},
          profile: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session: this.session },
    )
    return { id }
  }

  // currentPlaceForWorldStmt: the place under the world's active scene. The
  // SQLite join (worlds → scenes → places) is three sequential lookups here
  // (mirrors the sibling SceneRepository.currentScenePlaceId read).
  async currentPlaceForWorld(worldId: number): Promise<Place | null> {
    const world = await this.ctx.models.World.findOne({ id: worldId })
      .select({ currentSceneId: 1 })
      .session(this.session ?? null)
      .lean()
    if (!world?.currentSceneId) return null
    const scene = await this.ctx.models.Scene.findOne({ id: world.currentSceneId })
      .select({ placeId: 1 })
      .session(this.session ?? null)
      .lean()
    if (!scene) return null
    const place = await this.ctx.models.Place.findOne({ id: scene.placeId })
      .session(this.session ?? null)
      .lean()
    return place ? mapPlace(place) : null
  }

  // placeNameByIdStmt
  async nameById(id: number): Promise<string | null> {
    const doc = await this.ctx.models.Place.findOne({ id })
      .select({ name: 1 })
      .session(this.session ?? null)
      .lean()
    return doc?.name ?? null
  }

  // insertPlaceStmt — the archivist's bare insert (no deck/layout_hint).
  async insert(place: ArchivistPlaceInsert): Promise<{ id: number }> {
    const id = await this.ctx.nextSeq('placeId')
    const now = new Date()
    await this.ctx.models.Place.create(
      [
        {
          id,
          worldId: place.world_id,
          name: place.name,
          nameKey: place.name.toLowerCase(),
          description: place.description,
          kind: place.kind,
          deck: null,
          layoutHint: null,
          playerNotes: null,
          geo: {},
          profile: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session: this.session },
    )
    return { id }
  }

  // updatePlaceStmt — COALESCE merge: a null leaves the column unchanged, so
  // only the supplied fields enter the $set.
  async update(patch: PlaceUpdate): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.description !== null) set.description = patch.description
    if (patch.kind !== null) set.kind = patch.kind
    await this.ctx.models.Place.updateOne(
      { id: patch.id },
      { $set: set },
      { session: this.session },
    )
  }

  // mergePlaceStmt — plain assignment (the JS layer pre-computes the winner),
  // so every field is written even when null.
  async merge(patch: PlaceMerge): Promise<void> {
    await this.ctx.models.Place.updateOne(
      { id: patch.id },
      { $set: { description: patch.description, kind: patch.kind, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  // moveCharactersToPlaceStmt
  async moveCharactersToPlace(toId: number, fromId: number): Promise<void> {
    await this.ctx.models.Character.updateMany(
      { currentPlaceId: fromId },
      { $set: { currentPlaceId: toId } },
      { session: this.session },
    )
  }

  // moveScenesToPlaceStmt — stamps updatedAt like the SQLite UPDATE.
  async moveScenesToPlace(toId: number, fromId: number): Promise<void> {
    await this.ctx.models.Scene.updateMany(
      { placeId: fromId },
      { $set: { placeId: toId, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  // deletePlaceStmt
  async delete(id: number): Promise<void> {
    await this.ctx.models.Place.deleteOne({ id }, { session: this.session })
  }

  // appendPlacePlayerNotesStmt — append-only: the first note replaces an
  // empty/blank value, later notes are newline-joined.
  async appendPlayerNotes(id: number, note: string): Promise<void> {
    const doc = await this.ctx.models.Place.findOne({ id })
      .select({ playerNotes: 1 })
      .session(this.session ?? null)
      .lean()
    const existing = doc?.playerNotes ?? null
    const next =
      existing === null || existing.trim().length === 0 ? note : `${existing}\n${note}`
    await this.ctx.models.Place.updateOne(
      { id },
      { $set: { playerNotes: next, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  // updateResolvedStmt — the geocode write-back. The SQLite UPDATE assigns every
  // osm_* column plus geo_resolved_at=now; the Mongo geo facts live in the nested
  // `geo` subdoc, so the whole subdoc is replaced (mapPlace reads the same shape).
  async setGeoResolution(patch: PlaceGeoResolution): Promise<void> {
    await this.ctx.models.Place.updateOne(
      { id: patch.id },
      {
        $set: {
          geo: {
            displayName: patch.displayName,
            street: patch.street,
            neighborhood: patch.neighborhood,
            lat: patch.lat,
            lng: patch.lng,
            status: patch.status,
            resolvedAt: new Date(),
          },
          updatedAt: new Date(),
        },
      },
      { session: this.session },
    )
  }
}

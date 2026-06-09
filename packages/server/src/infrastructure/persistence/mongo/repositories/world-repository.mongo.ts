import 'server-only'

import { classifyPlaceKind } from '@/domain/services/occupancy-sim'
import type { World, WorldSummary } from '@/lib/worlds'
import type {
  CreateBoundedWorldInput,
  CreateOpenWorldInput,
  WorldRepository,
} from '@/domain/ports/world-repository'

import type { MongoContext } from '../mongo-context'
import { mapWorld, mapWorldSummary } from './mappers'

// Mirror of the (private) place-name extraction in lib/worlds.createWorld so a
// Mongo-seeded open world and a SQLite-seeded one have visually identical seed
// rows. Kept byte-identical to the SQLite path's derivePlaceName.
function derivePlaceName(location: string): string {
  const head = location.split(/[—–.,]/)[0]?.trim() ?? location
  const cleaned = head.length > 0 ? head : location.trim()
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned
}

// Mongo WorldRepository (spec §4.2) — dumb CRUD over the `worlds` aggregate.
// `turn_count` for the summary list is a per-world count over the turns
// collection (the SQLite subquery analog). World creation (seeding) is deciding
// logic that stays in the use case (P4/P5).
export class MongoWorldRepository implements WorldRepository {
  constructor(private readonly ctx: MongoContext) {}

  async createBounded(input: CreateBoundedWorldInput): Promise<{ id: number }> {
    const id = await this.ctx.nextSeq('worldId')
    let initialState: Record<string, unknown> | null = null
    try {
      initialState = input.initialStateJson
        ? (JSON.parse(input.initialStateJson) as Record<string, unknown>)
        : null
    } catch {
      initialState = null
    }
    await this.ctx.models.World.create(
      [
        {
          id,
          name: input.name,
          premise: input.premise,
          initialState,
          settingRegion: null,
          spatialMode: 'bounded',
          templateId: input.templateId,
          worldTime: null,
          currentSceneId: null,
          archivedAt: null,
          createdAt: new Date(),
        },
      ],
      { session: this.ctx.currentSession ?? undefined },
    )
    return { id }
  }

  // Open-world seed (P3 cutover) — the Mongo mirror of lib/worlds.createWorld:
  // the `worlds` row (spatialMode 'open') + a starting place (kind classified
  // from the location), a player character standing there, an active Scene 1,
  // and the world cursor (worldTime + currentSceneId). Each row gets a monotone
  // integer id via nextSeq; writes thread the active session so a UnitOfWork
  // commits the seed atomically. The setting region is written separately by the
  // use case (setSettingRegion) after its async extraction.
  async createOpen(input: CreateOpenWorldInput): Promise<{ id: number }> {
    const { name, premise, initialState } = input
    const session = this.ctx.currentSession ?? undefined
    const now = new Date()

    const worldId = await this.ctx.nextSeq('worldId')
    await this.ctx.models.World.create(
      [
        {
          id: worldId,
          name,
          premise,
          initialState: {
            time: initialState.time,
            location: initialState.location,
            identity: initialState.identity,
          },
          settingRegion: null,
          spatialMode: 'open',
          templateId: null,
          worldTime: null,
          currentSceneId: null,
          archivedAt: null,
          createdAt: now,
        },
      ],
      { session },
    )

    const placeId = await this.ctx.nextSeq('placeId')
    const placeName = derivePlaceName(initialState.location)
    await this.ctx.models.Place.create(
      [
        {
          id: placeId,
          worldId,
          name: placeName,
          nameKey: placeName.toLowerCase(),
          description: initialState.location,
          kind: classifyPlaceKind(initialState.location),
          deck: null,
          layoutHint: null,
          playerNotes: null,
          geo: {},
          profile: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session },
    )

    const characterId = await this.ctx.nextSeq('characterId')
    const playerName = initialState.playerName?.trim() || 'Player'
    await this.ctx.models.Character.create(
      [
        {
          id: characterId,
          worldId,
          name: playerName,
          nameKey: playerName.toLowerCase(),
          description: initialState.identity,
          isPlayer: true,
          currentPlaceId: placeId,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session },
    )

    const sceneId = await this.ctx.nextSeq('sceneId')
    await this.ctx.models.Scene.create(
      [
        {
          id: sceneId,
          worldId,
          placeId,
          title: 'Scene 1',
          summary: null,
          sceneNumber: 1,
          status: 'active',
          sceneMood: null,
          pace: null,
          focus: null,
          openedAtTurn: null,
          closedAtTurn: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session },
    )

    await this.ctx.models.World.updateOne(
      { id: worldId },
      { $set: { worldTime: initialState.time, currentSceneId: sceneId } },
      { session },
    )

    return { id: worldId }
  }

  async getWorld(id: number): Promise<World | null> {
    const doc = await this.ctx.models.World.findOne({ id }).lean()
    return doc ? mapWorld(doc) : null
  }

  private async summaries(filter: Record<string, unknown>): Promise<WorldSummary[]> {
    const docs = await this.ctx.models.World.find(filter).sort({ id: -1 }).lean()
    const out: WorldSummary[] = []
    for (const d of docs) {
      const turnCount = await this.ctx.models.Turn.countDocuments({ worldId: d.id })
      out.push(mapWorldSummary(d, turnCount))
    }
    return out
  }

  listWorlds(): Promise<WorldSummary[]> {
    return this.summaries({ archivedAt: null })
  }

  listArchivedWorlds(): Promise<WorldSummary[]> {
    return this.summaries({ archivedAt: { $ne: null } })
  }

  async archiveWorld(id: number): Promise<void> {
    await this.ctx.models.World.updateOne(
      { id },
      { $set: { archivedAt: new Date() } },
      { session: this.ctx.currentSession ?? undefined },
    )
  }

  async unarchiveWorld(id: number): Promise<void> {
    await this.ctx.models.World.updateOne(
      { id },
      { $set: { archivedAt: null } },
      { session: this.ctx.currentSession ?? undefined },
    )
  }

  async cursor(
    worldId: number,
  ): Promise<{ world_time: string | null; current_scene_id: number | null }> {
    const doc = await this.ctx.models.World.findOne({ id: worldId })
      .select({ worldTime: 1, currentSceneId: 1 })
      .lean()
    return {
      world_time: doc?.worldTime ?? null,
      current_scene_id: doc?.currentSceneId ?? null,
    }
  }

  // Bounded-world sim write (starship P2): advance only worldTime, leaving the
  // scene cursor untouched (the player-less pre-sim has no active scene yet).
  async setWorldTime(worldId: number, worldTime: string): Promise<void> {
    await this.ctx.models.World.updateOne(
      { id: worldId },
      { $set: { worldTime } },
      { session: this.ctx.currentSession ?? undefined },
    )
  }

  // Bounded-world join hand-off (starship P4a): point the cursor at the initial
  // scene, leaving worldTime (already set by the pre-sim) untouched.
  async setCursor(worldId: number, sceneId: number): Promise<void> {
    await this.ctx.models.World.updateOne(
      { id: worldId },
      { $set: { currentSceneId: sceneId } },
      { session: this.ctx.currentSession ?? undefined },
    )
  }

  async setSettingRegion(worldId: number, region: string | null): Promise<void> {
    await this.ctx.models.World.updateOne(
      { id: worldId },
      { $set: { settingRegion: region } },
      { session: this.ctx.currentSession ?? undefined },
    )
  }
}

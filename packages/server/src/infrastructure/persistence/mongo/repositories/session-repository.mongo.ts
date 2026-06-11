import 'server-only'

import type { SimulationSession, SimulationStatus } from '@/domain/entities'
import type { CreateSessionInput, SessionRepository } from '@/domain/ports/session-repository'

import type { MongoContext } from '../mongo-context'
import { mapSimulationSession } from './mappers'

// Mongo SessionRepository (Phase C, C2). Dumb CRUD over the simulation_session
// pointer; mirrors the SQLite adapter's behaviour.
export class MongoSessionRepository implements SessionRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get session() {
    return this.ctx.currentSession ?? undefined
  }

  async create(input: CreateSessionInput): Promise<SimulationSession> {
    const id = await this.ctx.nextSeq('sessionId')
    const now = new Date()
    const [doc] = await this.ctx.models.SimulationSession.create(
      [
        {
          id,
          hubWorldId: input.hub_world_id,
          subworldWorldId: input.subworld_world_id ?? null,
          playerIdentity: input.player_identity,
          status: input.status ?? 'in_subworld',
          hasAwoken: false,
          lucidity: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session: this.session },
    )
    return mapSimulationSession(doc.toObject() as Parameters<typeof mapSimulationSession>[0])
  }

  async byId(id: number): Promise<SimulationSession | null> {
    const doc = await this.ctx.models.SimulationSession.findOne({ id })
      .session(this.session ?? null)
      .lean()
    return doc ? mapSimulationSession(doc) : null
  }

  async byWorld(worldId: number): Promise<SimulationSession | null> {
    const doc = await this.ctx.models.SimulationSession.findOne({
      $or: [{ hubWorldId: worldId }, { subworldWorldId: worldId }],
    })
      .sort({ id: -1 })
      .session(this.session ?? null)
      .lean()
    return doc ? mapSimulationSession(doc) : null
  }

  async setSubworld(id: number, subworldWorldId: number | null): Promise<void> {
    await this.ctx.models.SimulationSession.updateOne(
      { id },
      { $set: { subworldWorldId, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  async flip(id: number, status: SimulationStatus): Promise<void> {
    await this.ctx.models.SimulationSession.updateOne(
      { id },
      { $set: { status, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  async setAwoken(id: number, awoken: boolean): Promise<void> {
    await this.ctx.models.SimulationSession.updateOne(
      { id },
      { $set: { hasAwoken: awoken, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  async setLucidity(id: number, lucidity: number): Promise<void> {
    await this.ctx.models.SimulationSession.updateOne(
      { id },
      { $set: { lucidity, updatedAt: new Date() } },
      { session: this.session },
    )
  }
}

import 'server-only'

import {
  AUTO_PROMOTE_THRESHOLD,
  isTransientServiceNpc,
  nextAgencyTier,
} from '@/domain/services/npc-promotion'
import type { CharacterAgencyLevel } from '@/domain/entities'
import type { Character } from '@/lib/world-state'
import type {
  AppearancePromotionResult,
  CharacterInput,
  CharacterRepository,
} from '@/domain/ports/character-repository'

import type { MongoContext } from '../mongo-context'
import { mapCharacter } from './mappers'

// Mongo CharacterRepository (spec §4.2) — dumb CRUD reads over `characters`.
// Name resolution / alias merge / promotion are deciding logic that stays out
// of the adapter (P4/P5).
export class MongoCharacterRepository implements CharacterRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get session() {
    return this.ctx.currentSession ?? undefined
  }

  async forWorld(worldId: number): Promise<Character[]> {
    const docs = await this.ctx.models.Character.find({ worldId })
      .sort({ id: 1 })
      .lean()
    return docs.map(mapCharacter)
  }

  async inPlace(worldId: number, placeId: number): Promise<Character[]> {
    const docs = await this.ctx.models.Character.find({
      worldId,
      currentPlaceId: placeId,
    })
      .sort({ id: 1 })
      .lean()
    return docs.map(mapCharacter)
  }

  // Bounded-world crew insert (starship P1). `role` stores into the existing
  // currentFocus field (no dedicated role column, mirroring SQLite). daily_loop
  // arrives as JSON text and is stored as a native subdoc (the mapper reverses it).
  async add(character: CharacterInput): Promise<{ id: number }> {
    const id = await this.ctx.nextSeq('characterId')
    const now = new Date()
    let dailyLoop: Record<string, unknown> | null = null
    try {
      dailyLoop = character.daily_loop
        ? (JSON.parse(character.daily_loop) as Record<string, unknown>)
        : null
    } catch {
      dailyLoop = null
    }
    await this.ctx.models.Character.create(
      [
        {
          id,
          worldId: character.world_id,
          name: character.name,
          nameKey: character.name.toLowerCase(),
          description: character.description,
          isPlayer: character.is_player === 1,
          currentPlaceId: character.current_place_id,
          currentFocus: character.role,
          activeGoal: character.active_goal,
          dailyLoop,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session: this.session },
    )
    return { id }
  }

  // Bounded-world sim write (starship P2): move a character to a room (or clear
  // it). Mirrors the SQLite UPDATE; stamps updatedAt like the sibling writes.
  async setPlace(characterId: number, placeId: number | null): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: { currentPlaceId: placeId, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  // Mirrors the byte-identical `lib/npc-promotion.recordAppearancesAndAutoPromote`
  // transaction (the SQLite oracle): bump appearance_count for each present NPC,
  // auto-promote NPCs that cross the threshold, set present non-npc/non-local
  // NPCs to 'local', demote transient service NPCs, then sweep all other absent
  // NPCs to their decayed tier. The promotion DECISION (threshold / transient /
  // next-tier) is the pure domain service; only the writes live here. All writes
  // run in the active UnitOfWork session so the pass commits atomically.
  async recordAppearancesAndAutoPromote(
    worldId: number,
    presentCharacters: Character[],
    turnId: number,
  ): Promise<AppearancePromotionResult> {
    const now = new Date()
    const eligible = presentCharacters.filter(
      (c) => c.is_player === 0 && c.status !== 'dead' && !isTransientServiceNpc(c),
    )
    const transientPresent = presentCharacters.filter(
      (c) => c.is_player === 0 && c.status !== 'dead' && isTransientServiceNpc(c),
    )
    const promoted: string[] = []
    const tiers: AppearancePromotionResult['tiers'] = {
      local: [],
      nearby: [],
      distant: [],
      dormant: [],
      demoted: [],
    }
    const presentIds = new Set(eligible.map((c) => c.id))
    const transientPresentIds = new Set(transientPresent.map((c) => c.id))

    for (const c of eligible) {
      // bumpAppearanceStmt
      await this.ctx.models.Character.updateOne(
        { id: c.id },
        { $inc: { appearanceCount: 1 }, $set: { lastSeenTurnId: turnId, updatedAt: now } },
        { session: this.session },
      )
      // The in-memory row is pre-bump; the new count is appearance_count + 1.
      const newCount = c.appearance_count + 1
      if (newCount >= AUTO_PROMOTE_THRESHOLD && c.agency_level === 'npc') {
        // promoteToLocalStmt — guarded by agency_level='npc' AND is_player=0.
        const res = await this.ctx.models.Character.updateOne(
          { id: c.id, agencyLevel: 'npc', isPlayer: false },
          { $set: { agencyLevel: 'local', lastSeenTurnId: turnId, updatedAt: now } },
          { session: this.session },
        )
        if (res.modifiedCount > 0) promoted.push(c.name)
      } else if (c.agency_level !== 'npc' && c.agency_level !== 'local') {
        await this.setAgencyLevel(c.id, 'local', now)
        tiers.local.push(c.name)
      }
    }

    for (const c of transientPresent) {
      if (c.agency_level !== 'npc' || c.active_goal || c.current_focus) {
        await this.demoteTransientServiceNpc(c.id, now)
        tiers.demoted.push(c.name)
      }
    }

    const rows = await this.ctx.models.Character.find({
      worldId,
      isPlayer: false,
      status: { $ne: 'dead' },
    })
      .lean()

    for (const d of rows) {
      const c = {
        id: d.id,
        name: d.name,
        description: d.description,
        agency_level: d.agencyLevel,
        active_goal: d.activeGoal,
        personal_goals: d.personalGoals,
        current_focus: d.currentFocus,
        last_seen_turn_id: d.lastSeenTurnId,
      }
      if (isTransientServiceNpc(c)) {
        if (transientPresentIds.has(c.id)) continue
        if (c.agency_level !== 'npc' || c.active_goal || c.current_focus) {
          await this.demoteTransientServiceNpc(c.id, now)
          tiers.demoted.push(c.name)
        }
        continue
      }
      if (presentIds.has(c.id) || c.agency_level === 'npc') continue

      const lastSeen = c.last_seen_turn_id
      const turnsAway = lastSeen === null ? Number.POSITIVE_INFINITY : turnId - lastSeen
      const hasOpenThread = !!(c.active_goal || c.personal_goals || c.current_focus)
      const next: CharacterAgencyLevel = nextAgencyTier(turnsAway, hasOpenThread)

      if (c.agency_level === next) continue
      await this.setAgencyLevel(c.id, next, now)
      if (next === 'npc') tiers.demoted.push(c.name)
      else tiers[next].push(c.name)
    }

    return { promoted, counted: eligible.length, tiers }
  }

  // setAgencyLevelStmt
  private async setAgencyLevel(
    characterId: number,
    agencyLevel: CharacterAgencyLevel,
    now: Date,
  ): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: { agencyLevel, updatedAt: now } },
      { session: this.session },
    )
  }

  // demoteTransientServiceNpcStmt
  private async demoteTransientServiceNpc(characterId: number, now: Date): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: { agencyLevel: 'npc', activeGoal: null, currentFocus: null, updatedAt: now } },
      { session: this.session },
    )
  }
}

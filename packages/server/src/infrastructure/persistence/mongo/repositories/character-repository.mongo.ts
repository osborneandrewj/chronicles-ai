import 'server-only'

import {
  AUTO_PROMOTE_THRESHOLD,
  isTransientServiceNpc,
  nextAgencyTier,
} from '@/domain/services/npc-promotion'
import type { CharacterAgencyLevel } from '@/domain/entities'
import type { Character } from '@/lib/world-state'
import type {
  AgentNpcFields,
  AgentNpcRow,
  AppearancePromotionResult,
  ArchivistCharacterInsert,
  ArchivistCharacterMerge,
  ArchivistCharacterUpdate,
  CharacterInput,
  CharacterRepository,
} from '@/domain/ports/character-repository'

import type { CharacterDoc } from '../models'
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
      .session(this.session ?? null)
      .lean()
    return docs.map(mapCharacter)
  }

  async inPlace(worldId: number, placeId: number): Promise<Character[]> {
    const docs = await this.ctx.models.Character.find({
      worldId,
      currentPlaceId: placeId,
    })
      .sort({ id: 1 })
      .session(this.session ?? null)
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

  // Mirrors findCharacterByExactLowerNameStmt (`lower(name) = lower(?)`). The
  // lowercased name lives in the indexed nameKey field; map the doc back to the
  // flat Character row. Returns null when no row matches.
  async findByExactLowerName(worldId: number, name: string): Promise<Character | null> {
    const doc = await this.ctx.models.Character.findOne({
      worldId,
      nameKey: name.toLowerCase(),
    })
      .session(this.session ?? null)
      .lean()
    return doc ? mapCharacter(doc) : null
  }

  // Mirrors insertCharacterStmt: the archivist's first-sight INSERT. Assigns an
  // integer id via nextSeq; nameKey mirrors lower(name). Columns not in the SQL
  // INSERT fall to their schema defaults (agencyLevel='npc', appearanceCount=0,
  // etc.), matching the SQLite row defaults.
  async insert(character: ArchivistCharacterInsert): Promise<{ id: number }> {
    const id = await this.ctx.nextSeq('characterId')
    const now = new Date()
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
          memorableFacts: character.memorable_facts,
          status: character.status as CharacterDoc['status'],
          activeGoal: character.active_goal,
          currentAttitude: character.current_attitude,
          observations: character.observations,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session: this.session },
    )
    return { id }
  }

  // Mirrors updateCharacterStmt: each column is COALESCE(?, column) — a null
  // leaves it unchanged. Translate that to a $set of only the non-null fields
  // (plus updatedAt, which the SQL always bumps).
  async update(characterId: number, patch: ArchivistCharacterUpdate): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.description !== null) set.description = patch.description
    if (patch.current_place_id !== null) set.currentPlaceId = patch.current_place_id
    if (patch.is_player !== null) set.isPlayer = patch.is_player === 1
    if (patch.memorable_facts !== null) set.memorableFacts = patch.memorable_facts
    if (patch.status !== null) set.status = patch.status
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: set },
      { session: this.session },
    )
  }

  // Mirrors setActiveGoalStmt: plain assignment (null clears, string sets).
  async setActiveGoal(characterId: number, activeGoal: string | null): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: { activeGoal, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  // Mirrors setCurrentAttitudeStmt: plain assignment (null clears, string sets).
  async setCurrentAttitude(
    characterId: number,
    currentAttitude: string | null,
  ): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: { currentAttitude, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  // Mirrors setObservationsStmt: COALESCE(?, observations) — a null leaves it
  // unchanged, so only $set observations when a value is supplied. updatedAt is
  // bumped unconditionally to match the SQL.
  async setObservations(
    characterId: number,
    observations: string | null,
  ): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (observations !== null) set.observations = observations
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: set },
      { session: this.session },
    )
  }

  // Mirrors mergeCharacterStmt: a full overwrite of the surviving row — every
  // column is a plain assignment (the use case computed the merged values).
  // nameKey tracks the new name to keep the exact-lower-name lookup consistent.
  async merge(characterId: number, merged: ArchivistCharacterMerge): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      {
        $set: {
          name: merged.name,
          nameKey: merged.name.toLowerCase(),
          description: merged.description,
          currentPlaceId: merged.current_place_id,
          memorableFacts: merged.memorable_facts,
          status: merged.status,
          activeGoal: merged.active_goal,
          currentAttitude: merged.current_attitude,
          observations: merged.observations,
          agencyLevel: merged.agency_level,
          personalGoals: merged.personal_goals,
          currentFocus: merged.current_focus,
          recentActivity: merged.recent_activity,
          privateBeliefs: merged.private_beliefs,
          relationshipToPlayer: merged.relationship_to_player,
          longTermAgenda: merged.long_term_agenda,
          toolAccess: merged.tool_access,
          appearanceCount: merged.appearance_count,
          lastSeenTurnId: merged.last_seen_turn_id,
          lastAgentTickTurnId: merged.last_agent_tick_turn_id,
          playerNotes: merged.player_notes,
          aliases: merged.aliases,
          updatedAt: new Date(),
        },
      },
      { session: this.session },
    )
  }

  // Mirrors deleteCharacterStmt: hard-delete the merge source row.
  async delete(characterId: number): Promise<void> {
    await this.ctx.models.Character.deleteOne(
      { id: characterId },
      { session: this.session },
    )
  }

  // Mirrors setCharacterAliasesStmt: overwrite the aliases column (null clears).
  async setAliases(characterId: number, aliases: string | null): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: { aliases, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  // Mirrors renameCharacterStmt: rename a row (alias-merge canonicalisation).
  // nameKey tracks the new name to keep the exact-lower-name lookup consistent.
  async rename(name: string, characterId: number): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: { name, nameKey: name.toLowerCase(), updatedAt: new Date() } },
      { session: this.session },
    )
  }

  // Mirrors setPlayersPlaceStmt: move the world's player row (is_player=1) to a
  // place. Scoped to worldId + isPlayer like the SQL WHERE.
  async setPlayersPlace(placeId: number, worldId: number): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { worldId, isPlayer: true },
      { $set: { currentPlaceId: placeId, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  // Mirrors appendCharacterPlayerNotesStmt: append-only, newline-separated
  // player_notes. The SQL CASE writes the bare line on an empty/null column, else
  // existing || char(10) || line. Read-modify-write the same way under the
  // session.
  async appendPlayerNotes(characterId: number, line: string): Promise<void> {
    const doc = await this.ctx.models.Character.findOne({ id: characterId })
      .session(this.session ?? null)
      .lean()
    const existing = doc?.playerNotes ?? null
    const next =
      existing === null || existing.trim().length === 0
        ? line
        : `${existing}\n${line}`
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: { playerNotes: next, updatedAt: new Date() } },
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
      .session(this.session ?? null)
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

  // Mirrors agentNpcsStmt: agent-tier, non-player, non-dead NPCs whose tier-based
  // cadence is due this turn. The correlated place-name subqueries become a single
  // id→name lookup over the world's places. `'agent'` is matched literally (a
  // legacy tier the SQL still admits even though it is outside the enum).
  async agentNpcsForTick(
    worldId: number,
    tickTurnId: number,
    playerPlaceId: number | null,
  ): Promise<AgentNpcRow[]> {
    // `'agent'` is a legacy tier the SQL still admits even though it is outside
    // the schema enum; cast the tier lists so the literal is accepted in $in.
    const agentTiers = ['local', 'nearby', 'distant', 'agent'] as CharacterDoc['agencyLevel'][]
    const everyTurnTiers = ['local', 'agent'] as CharacterDoc['agencyLevel'][]
    // Mirrors the SQLite WHERE: (agent-tier AND cadence-due) OR (co-located
    // npc-tier). The npc-tier branch is only added when the player has a place,
    // matching the SQLite -1 sentinel (which never matches a real row).
    const candidates: Record<string, unknown>[] = [
      {
        agencyLevel: { $in: agentTiers },
        $or: [
          { agencyLevel: { $in: everyTurnTiers } },
          { lastAgentTickTurnId: null },
          { agencyLevel: 'nearby', lastAgentTickTurnId: { $lte: tickTurnId - 2 } },
          { agencyLevel: 'distant', lastAgentTickTurnId: { $lte: tickTurnId - 5 } },
          { lastAgentTickTurnId: { $lte: tickTurnId - 5 } },
        ],
      },
    ]
    if (playerPlaceId !== null) {
      candidates.push({ agencyLevel: 'npc', currentPlaceId: playerPlaceId })
    }
    const docs = await this.ctx.models.Character.find({
      worldId,
      isPlayer: false,
      status: { $ne: 'dead' },
      $or: candidates,
    })
      .sort({ id: 1 })
      .session(this.session ?? null)
      .lean()
    const places = await this.ctx.models.Place.find({ worldId })
      .select({ id: 1, name: 1 })
      .session(this.session ?? null)
      .lean()
    const nameById = new Map(places.map((p) => [p.id, p.name]))
    return docs.map((d) => {
      const c = mapCharacter(d)
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        personal_goals: c.personal_goals,
        current_focus: c.current_focus,
        recent_activity: c.recent_activity,
        private_beliefs: c.private_beliefs,
        reveries: c.reveries,
        relationship_to_player: c.relationship_to_player,
        long_term_agenda: c.long_term_agenda,
        tool_access: c.tool_access,
        active_goal: c.active_goal,
        current_attitude: c.current_attitude,
        current_place_id: c.current_place_id,
        current_place_name:
          c.current_place_id !== null ? nameById.get(c.current_place_id) ?? null : null,
        agency_level: c.agency_level,
        last_agent_tick_turn_id: c.last_agent_tick_turn_id,
        in_transit_to_place_id: c.in_transit_to_place_id,
        in_transit_to_name:
          c.in_transit_to_place_id !== null
            ? nameById.get(c.in_transit_to_place_id) ?? null
            : null,
        arrival_world_time: c.arrival_world_time,
        last_known_situation: c.last_known_situation,
        daily_loop: c.daily_loop,
      }
    })
  }

  // setLastAgentTickStmt
  async setLastAgentTick(turnId: number, characterId: number): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: { lastAgentTickTurnId: turnId, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  // findAgentNpcByNameStmt: exact-lower-name match scoped to plan-eligible
  // non-player, non-dead rows (agent-tier PLUS plain npc-tier, so a newly-eligible
  // co-located NPC's own updates write back). Returns only the two columns the
  // patch applier reads.
  async findAgentNpcByName(
    worldId: number,
    name: string,
  ): Promise<{ id: number; recent_activity: string | null } | null> {
    const tiers = ['npc', 'local', 'nearby', 'distant', 'agent'] as CharacterDoc['agencyLevel'][]
    const doc = await this.ctx.models.Character.findOne({
      worldId,
      nameKey: name.toLowerCase(),
      agencyLevel: { $in: tiers },
      isPlayer: false,
      status: { $ne: 'dead' },
    })
      .select({ id: 1, recentActivity: 1 })
      .session(this.session ?? null)
      .lean()
    return doc ? { id: doc.id, recent_activity: doc.recentActivity ?? null } : null
  }

  // Mirrors the agent's per-column UPDATE statements: only the keys present in
  // `fields` are written. Collapses into one $set (each statement touched a
  // distinct column, so the final row state is byte-identical) and bumps updatedAt.
  async applyAgentNpcFields(characterId: number, fields: AgentNpcFields): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (fields.current_focus !== undefined) set.currentFocus = fields.current_focus
    if (fields.recent_activity !== undefined) set.recentActivity = fields.recent_activity
    if (fields.current_place_id !== undefined) set.currentPlaceId = fields.current_place_id
    if (fields.personal_goals !== undefined) set.personalGoals = fields.personal_goals
    if (fields.private_beliefs !== undefined) set.privateBeliefs = fields.private_beliefs
    if (fields.relationship_to_player !== undefined) {
      set.relationshipToPlayer = fields.relationship_to_player
    }
    if (fields.long_term_agenda !== undefined) set.longTermAgenda = fields.long_term_agenda
    if (fields.tool_access !== undefined) set.toolAccess = fields.tool_access
    if (fields.in_transit_to_place_id !== undefined) {
      set.inTransitToPlaceId = fields.in_transit_to_place_id
    }
    if (fields.arrival_world_time !== undefined) {
      set.arrivalWorldTime = fields.arrival_world_time
    }
    if (fields.last_known_situation !== undefined) {
      set.lastKnownSituation = fields.last_known_situation
    }
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: set },
      { session: this.session },
    )
  }

  // Mirrors setDailyLoopIfEmptyStmt: author the loop only when the column is
  // currently null/blank. dailyLoop is stored as a native subdoc (the SQL stores
  // JSON text); parse the incoming JSON to match the on-disk shape.
  async setDailyLoopIfEmpty(characterId: number, dailyLoopJson: string): Promise<void> {
    let dailyLoop: Record<string, unknown> | null = null
    try {
      dailyLoop = JSON.parse(dailyLoopJson) as Record<string, unknown>
    } catch {
      dailyLoop = null
    }
    await this.ctx.models.Character.updateOne(
      { id: characterId, $or: [{ dailyLoop: null }, { dailyLoop: { $exists: false } }] },
      { $set: { dailyLoop, updatedAt: new Date() } },
      { session: this.session },
    )
  }
}

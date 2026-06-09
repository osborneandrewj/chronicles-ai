import 'server-only'

import type {
  DossierWriter,
  InsertStoryClueInput,
  InsertStoryObjectiveInput,
  InsertStoryResourceInput,
  InsertStoryThreadInput,
  StoryThreadLookupRow,
  UpdateStoryClueInput,
  UpdateStoryObjectiveInput,
  UpdateStoryResourceInput,
  UpdateStoryThreadInput,
} from '@/domain/ports/dossier-writer'

import type { MongoContext } from '../mongo-context'

// Mongo adapter for DossierWriter (Phase 4) — the write sibling of
// `MongoDossierRepository`. Equivalent collection writes for the four story
// collections: integer ids come from the shared counter (`nextSeq`, session-
// threaded like the sibling writers) so the inspector ordering stays
// autoincrement-compatible with SQLite. The SQLite `lower(...) = lower(?)` title
// lookups become exact matches on the stored `titleKey` / `nameKey` (the
// lowercased key the unique index is built on). COALESCE semantics (null =
// unchanged) are reproduced by omitting null fields from `$set`; the plain-
// assignment columns and `updatedAt` are always written. `createdAt` /
// `updatedAt` are stamped here (the analog of datetime('now')).

export class MongoDossierWriter implements DossierWriter {
  constructor(private readonly ctx: MongoContext) {}

  async threadByTitle(
    worldId: number,
    title: string,
  ): Promise<StoryThreadLookupRow | null> {
    const doc = await this.ctx.models.StoryThread.findOne({
      worldId,
      titleKey: title.toLowerCase(),
    })
      .select({
        id: 1,
        title: 1,
        kind: 1,
        status: 1,
        summary: 1,
        stakes: 1,
        rewards: 1,
        consequences: 1,
        hidden: 1,
        relevanceTagsJson: 1,
      })
      .session(this.ctx.currentSession ?? null)
      .lean()
    if (!doc) return null
    return {
      id: doc.id,
      title: doc.title,
      kind: doc.kind,
      status: doc.status,
      summary: doc.summary,
      stakes: doc.stakes,
      rewards: doc.rewards,
      consequences: doc.consequences,
      hidden: doc.hidden,
      relevance_tags_json: doc.relevanceTagsJson,
    }
  }

  async insertThread(input: InsertStoryThreadInput): Promise<{ id: number }> {
    const session = this.ctx.currentSession ?? undefined
    const id = await this.ctx.nextSeq('storyThreadId')
    const now = new Date()
    await this.ctx.models.StoryThread.create(
      [
        {
          id,
          worldId: input.world_id,
          title: input.title,
          titleKey: input.title.toLowerCase(),
          kind: input.kind as 'quest' | 'mystery' | 'threat' | 'relationship' | 'background',
          status: input.status as 'active' | 'resolved' | 'failed' | 'dormant',
          summary: input.summary,
          stakes: input.stakes,
          rewards: input.rewards,
          consequences: input.consequences,
          hidden: input.hidden,
          relevanceTagsJson: input.relevance_tags_json,
          sourceTurnId: input.source_turn_id,
          resolvedTurnId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session },
    )
    return { id }
  }

  async updateThread(input: UpdateStoryThreadInput): Promise<void> {
    const session = this.ctx.currentSession ?? undefined
    const set: Record<string, unknown> = {
      kind: input.kind,
      status: input.status,
      relevanceTagsJson: input.relevance_tags_json,
      updatedAt: new Date(),
    }
    if (input.summary != null) set.summary = input.summary
    if (input.stakes != null) set.stakes = input.stakes
    if (input.rewards != null) set.rewards = input.rewards
    if (input.consequences != null) set.consequences = input.consequences
    if (input.hidden != null) set.hidden = input.hidden
    if (input.resolved_turn_id != null) set.resolvedTurnId = input.resolved_turn_id
    await this.ctx.models.StoryThread.updateOne({ id: input.id }, { $set: set }, { session })
  }

  async clueByTitle(worldId: number, title: string): Promise<{ id: number } | null> {
    const doc = await this.ctx.models.StoryClue.findOne({
      worldId,
      titleKey: title.toLowerCase(),
    })
      .select({ id: 1 })
      .session(this.ctx.currentSession ?? null)
      .lean()
    return doc ? { id: doc.id } : null
  }

  async insertClue(input: InsertStoryClueInput): Promise<{ id: number }> {
    const session = this.ctx.currentSession ?? undefined
    const id = await this.ctx.nextSeq('storyClueId')
    const now = new Date()
    await this.ctx.models.StoryClue.create(
      [
        {
          id,
          worldId: input.world_id,
          threadId: input.thread_id,
          title: input.title,
          titleKey: input.title.toLowerCase(),
          detail: input.detail,
          implication: input.implication,
          status: input.status as 'open' | 'interpreted' | 'spent' | 'false_lead',
          sourceTurnId: input.source_turn_id,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session },
    )
    return { id }
  }

  async updateClue(input: UpdateStoryClueInput): Promise<void> {
    const session = this.ctx.currentSession ?? undefined
    const set: Record<string, unknown> = {
      status: input.status,
      updatedAt: new Date(),
    }
    if (input.thread_id != null) set.threadId = input.thread_id
    if (input.detail != null) set.detail = input.detail
    if (input.implication != null) set.implication = input.implication
    await this.ctx.models.StoryClue.updateOne({ id: input.id }, { $set: set }, { session })
  }

  async objectiveByTitle(
    worldId: number,
    title: string,
  ): Promise<{ id: number } | null> {
    const doc = await this.ctx.models.StoryObjective.findOne({
      worldId,
      titleKey: title.toLowerCase(),
    })
      .select({ id: 1 })
      .session(this.ctx.currentSession ?? null)
      .lean()
    return doc ? { id: doc.id } : null
  }

  async insertObjective(input: InsertStoryObjectiveInput): Promise<{ id: number }> {
    const session = this.ctx.currentSession ?? undefined
    const id = await this.ctx.nextSeq('storyObjectiveId')
    const now = new Date()
    await this.ctx.models.StoryObjective.create(
      [
        {
          id,
          worldId: input.world_id,
          threadId: input.thread_id,
          title: input.title,
          titleKey: input.title.toLowerCase(),
          status: input.status as 'active' | 'blocked' | 'completed' | 'failed',
          detail: input.detail,
          blocker: input.blocker,
          sourceTurnId: input.source_turn_id,
          completedTurnId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session },
    )
    return { id }
  }

  async updateObjective(input: UpdateStoryObjectiveInput): Promise<void> {
    const session = this.ctx.currentSession ?? undefined
    const set: Record<string, unknown> = {
      status: input.status,
      updatedAt: new Date(),
    }
    if (input.thread_id != null) set.threadId = input.thread_id
    if (input.detail != null) set.detail = input.detail
    if (input.blocker != null) set.blocker = input.blocker
    if (input.completed_turn_id != null) set.completedTurnId = input.completed_turn_id
    await this.ctx.models.StoryObjective.updateOne(
      { id: input.id },
      { $set: set },
      { session },
    )
  }

  async resourceByName(worldId: number, name: string): Promise<{ id: number } | null> {
    const doc = await this.ctx.models.StoryResource.findOne({
      worldId,
      nameKey: name.toLowerCase(),
    })
      .select({ id: 1 })
      .session(this.ctx.currentSession ?? null)
      .lean()
    return doc ? { id: doc.id } : null
  }

  async insertResource(input: InsertStoryResourceInput): Promise<{ id: number }> {
    const session = this.ctx.currentSession ?? undefined
    const id = await this.ctx.nextSeq('storyResourceId')
    const now = new Date()
    await this.ctx.models.StoryResource.create(
      [
        {
          id,
          worldId: input.world_id,
          ownerCharacterId: input.owner_character_id,
          name: input.name,
          nameKey: input.name.toLowerCase(),
          kind: input.kind,
          status: input.status,
          detail: input.detail,
          sourceTurnId: input.source_turn_id,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session },
    )
    return { id }
  }

  async updateResource(input: UpdateStoryResourceInput): Promise<void> {
    const session = this.ctx.currentSession ?? undefined
    const set: Record<string, unknown> = {
      updatedAt: new Date(),
    }
    if (input.owner_character_id != null) set.ownerCharacterId = input.owner_character_id
    if (input.kind != null) set.kind = input.kind
    if (input.status != null) set.status = input.status
    if (input.detail != null) set.detail = input.detail
    await this.ctx.models.StoryResource.updateOne(
      { id: input.id },
      { $set: set },
      { session },
    )
  }
}

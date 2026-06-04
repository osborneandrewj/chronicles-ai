import 'server-only'

import type { StoryDossier } from '@/domain/entities'
import type { DossierRepository } from '@/domain/ports/dossier-repository'

import type { MongoContext } from '../mongo-context'
import {
  mapStoryClue,
  mapStoryObjective,
  mapStoryResource,
  mapStoryThread,
  mapTimelineEvent,
} from './mappers'

// Mongo DossierRepository (spec §4.2) — dumb CRUD read of the per-world story
// dossier. Mongo has no JOIN, so the `thread_title` / `owner_name`
// denormalization the SQLite LEFT JOINs produce is done with in-memory lookup
// maps. Orderings mirror the SQLite ORDER BY (status rank → kind rank →
// updatedAt DESC → id DESC) so the inspector renders identically.

const THREAD_STATUS_RANK: Record<string, number> = {
  active: 0,
  dormant: 1,
}
const THREAD_KIND_RANK: Record<string, number> = {
  quest: 0,
  mystery: 1,
  threat: 2,
}
const CLUE_STATUS_RANK: Record<string, number> = {
  open: 0,
  interpreted: 1,
  spent: 2,
}
const OBJECTIVE_STATUS_RANK: Record<string, number> = {
  active: 0,
  blocked: 1,
}

function cmpUpdatedThenId(
  a: { updatedAt: Date; id: number },
  b: { updatedAt: Date; id: number },
): number {
  const t = b.updatedAt.getTime() - a.updatedAt.getTime()
  if (t !== 0) return t
  return b.id - a.id
}

export class MongoDossierRepository implements DossierRepository {
  constructor(private readonly ctx: MongoContext) {}

  async forWorld(worldId: number): Promise<StoryDossier> {
    const [threads, clues, objectives, resources, timeline] = await Promise.all([
      this.ctx.models.StoryThread.find({ worldId }).lean(),
      this.ctx.models.StoryClue.find({ worldId }).lean(),
      this.ctx.models.StoryObjective.find({ worldId }).lean(),
      this.ctx.models.StoryResource.find({ worldId }).lean(),
      this.ctx.models.TimelineEvent.find({ worldId }).sort({ id: -1 }).limit(12).lean(),
    ])

    const threadTitleById = new Map<number, string>()
    for (const t of threads) threadTitleById.set(t.id, t.title)

    const ownerCharIds = resources
      .map((r) => r.ownerCharacterId)
      .filter((x): x is number => x != null)
    const ownerNameById = new Map<number, string>()
    if (ownerCharIds.length > 0) {
      const owners = await this.ctx.models.Character.find({
        worldId,
        id: { $in: ownerCharIds },
      })
        .select({ id: 1, name: 1 })
        .lean()
      for (const c of owners) ownerNameById.set(c.id, c.name)
    }

    const sortedThreads = [...threads].sort((a, b) => {
      const sr = (THREAD_STATUS_RANK[a.status] ?? 2) - (THREAD_STATUS_RANK[b.status] ?? 2)
      if (sr !== 0) return sr
      const kr = (THREAD_KIND_RANK[a.kind] ?? 3) - (THREAD_KIND_RANK[b.kind] ?? 3)
      if (kr !== 0) return kr
      return cmpUpdatedThenId(a, b)
    })

    const sortedClues = [...clues].sort((a, b) => {
      const sr = (CLUE_STATUS_RANK[a.status] ?? 3) - (CLUE_STATUS_RANK[b.status] ?? 3)
      if (sr !== 0) return sr
      return cmpUpdatedThenId(a, b)
    })

    const sortedObjectives = [...objectives].sort((a, b) => {
      const sr =
        (OBJECTIVE_STATUS_RANK[a.status] ?? 2) - (OBJECTIVE_STATUS_RANK[b.status] ?? 2)
      if (sr !== 0) return sr
      return cmpUpdatedThenId(a, b)
    })

    const sortedResources = [...resources].sort(cmpUpdatedThenId)

    return {
      threads: sortedThreads.map(mapStoryThread),
      clues: sortedClues.map((c) =>
        mapStoryClue(c, c.threadId != null ? threadTitleById.get(c.threadId) ?? null : null),
      ),
      objectives: sortedObjectives.map((o) =>
        mapStoryObjective(
          o,
          o.threadId != null ? threadTitleById.get(o.threadId) ?? null : null,
        ),
      ),
      resources: sortedResources.map((r) =>
        mapStoryResource(
          r,
          r.ownerCharacterId != null
            ? ownerNameById.get(r.ownerCharacterId) ?? null
            : null,
        ),
      ),
      timeline: timeline.map((e) =>
        mapTimelineEvent(
          e,
          e.threadId != null ? threadTitleById.get(e.threadId) ?? null : null,
        ),
      ),
    }
  }
}

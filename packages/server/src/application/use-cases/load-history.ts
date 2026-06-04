import type { AssistantTurnMetadata, Turn } from '@/domain/entities'
import type { TurnRepository, WorldRepository } from '@/domain/ports'

// LoadHistory (spec §3.5, §5.1-P5) — orchestration for the play-page "Load
// older" affordance. Reads an older slice of turns plus the assistant-turn
// metadata scoped to that slice, and reports whether more remain. No SQL, no
// framework, no infra: loads through the repository ports only. Turning the raw
// metadata into per-turn cost summaries is a rendering concern the route adapter
// owns (structure ≠ rendering, spec §"Separation-of-concerns").

export class WorldNotFoundError extends Error {
  constructor(public readonly worldId: number) {
    super(`World ${worldId} not found`)
    this.name = 'WorldNotFoundError'
  }
}

const DEFAULT_LIMIT = 60
const MAX_LIMIT = 200

export type LoadHistoryInput = {
  worldId: number
  before: number
  limit?: number
}

export type LoadHistoryResult = {
  turns: Turn[]
  assistantMetadata: AssistantTurnMetadata[]
  hasMore: boolean
}

export type LoadHistoryDeps = {
  worlds: WorldRepository
  turns: TurnRepository
}

export async function loadHistory(
  { worldId, before, limit: rawLimit }: LoadHistoryInput,
  { worlds, turns }: LoadHistoryDeps,
): Promise<LoadHistoryResult> {
  if (!(await worlds.getWorld(worldId))) {
    throw new WorldNotFoundError(worldId)
  }

  const limit =
    typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT

  const slice = await turns.turnsBefore(worldId, before, limit)
  if (slice.length === 0) {
    return { turns: [], assistantMetadata: [], hasMore: false }
  }

  // Metadata scoped to the just-loaded slice. min = the slice's first turn id,
  // maxExclusive = the original `before` so we don't double-fetch anything the
  // client already has.
  const assistantMetadata = await turns.assistantMetadataInRange(
    worldId,
    slice[0].id,
    before,
  )

  return {
    turns: slice,
    assistantMetadata,
    hasMore: await turns.hasTurnBefore(worldId, slice[0].id),
  }
}

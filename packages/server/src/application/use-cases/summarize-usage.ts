import type { AssistantTurnMetadata } from '@/domain/entities'
import type { TurnRepository, WorldRepository } from '@/domain/ports'
import { WorldNotFoundError } from '@/application/use-cases/load-history'

// SummarizeUsage (spec §3.5, §5.1-P5) — loads every assistant turn's metadata
// for a world's cost dashboard. Orchestration only: validates the world exists
// and reads the metadata through ports. Turning each metadata blob into a
// per-agent cost breakdown (and the grand total) is rendering the route adapter
// owns via the pure `summarizeTurn` reducer (structure ≠ rendering).

export { WorldNotFoundError }

export type SummarizeUsageInput = {
  worldId: number
}

export type SummarizeUsageResult = {
  assistantMetadata: AssistantTurnMetadata[]
}

export type SummarizeUsageDeps = {
  worlds: WorldRepository
  turns: TurnRepository
}

export async function summarizeUsage(
  { worldId }: SummarizeUsageInput,
  { worlds, turns }: SummarizeUsageDeps,
): Promise<SummarizeUsageResult> {
  if (!(await worlds.getWorld(worldId))) {
    throw new WorldNotFoundError(worldId)
  }
  return { assistantMetadata: await turns.allAssistantMetadata(worldId) }
}

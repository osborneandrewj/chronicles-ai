import type { TurnRepository } from '@/domain/ports'

// RecordTtsUsage (spec §3.5, §5.1-P5) — additively records synthesized
// characters against an assistant turn's metadata (`$.tts.chars`). Orchestration
// only: hands the validated values to the append-only TurnRepository's
// `incTtsChars`. Input validation (worldId/turnId/chars shape) is the route
// adapter's boundary concern; the use case trusts its typed inputs.

export type RecordTtsUsageInput = {
  worldId: number
  turnId: number
  chars: number
}

export type RecordTtsUsageDeps = {
  turns: TurnRepository
}

export async function recordTtsUsage(
  { worldId, turnId, chars }: RecordTtsUsageInput,
  { turns }: RecordTtsUsageDeps,
): Promise<void> {
  await turns.incTtsChars(worldId, turnId, chars)
}

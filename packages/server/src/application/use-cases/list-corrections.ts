import type { CorrectionRepository, WorldRepository } from '@/domain/ports'
import { WorldNotFoundError } from '@/application/use-cases/load-history'

// ListCorrections (spec §3.5, §5.1-P5) — read projection for the player→archivist
// correction scrollback. Orchestration only: gate on world existence, read the
// rows DESC through the port, and return them in chronological order so the UI
// can append-render without a client-side sort. Mapping rows to the wire DTO is
// the route adapter's rendering concern.

export { WorldNotFoundError }

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export type ListCorrectionsInput = {
  worldId: number
  limit?: number
}

export type ListCorrectionsDeps = {
  worlds: WorldRepository
  corrections: CorrectionRepository
}

export async function listCorrections(
  { worldId, limit: rawLimit }: ListCorrectionsInput,
  { worlds, corrections }: ListCorrectionsDeps,
) {
  if (!(await worlds.getWorld(worldId))) {
    throw new WorldNotFoundError(worldId)
  }
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(MAX_LIMIT, rawLimit))
      : DEFAULT_LIMIT
  // DESC from the DB; reverse to chronological.
  return (await corrections.forWorld(worldId, limit)).slice().reverse()
}

// When to spend a post-stream Haiku director brain. Pure. Fail-open skip.

import type { DirectorBeatKind, DirectorCastSlot, DirectorPhase } from '@/domain/entities'
import type { DirectorBrainReason } from '@/domain/entities/director-state'

export const DIRECTOR_BRAIN_COOLDOWN_TURNS = 3

export type DirectorBrainGateInput = {
  pendingUnused: boolean
  lastBrainTurnId: number | null
  currentTurnId: number
  beatKind: DirectorBeatKind | null
  phase: DirectorPhase | null
  activeThreadCount: number
  activeObjectiveCount: number
  cast: DirectorCastSlot[]
  presentNpcCount: number
}

export function shouldRunDirectorBrain(input: DirectorBrainGateInput): DirectorBrainReason | null {
  if (input.pendingUnused) return null

  const reason = pickReason(input)
  if (!reason) return null

  if (reason !== 'empty_dossier' && isCoolingDown(input)) return null
  return reason
}

function pickReason(input: DirectorBrainGateInput): DirectorBrainReason | null {
  if (input.activeThreadCount === 0 && input.activeObjectiveCount === 0) {
    return 'empty_dossier'
  }
  if (input.beatKind === 'stall_escalate') return 'stall'
  if (input.phase === 'climax') return 'climax'
  const initiates = input.cast.filter((c) => c.role === 'initiate').length
  if (input.presentNpcCount >= 3 && initiates !== 1) return 'cast_collision'
  return null
}

function isCoolingDown(input: DirectorBrainGateInput): boolean {
  if (input.lastBrainTurnId == null) return false
  return input.currentTurnId - input.lastBrainTurnId < DIRECTOR_BRAIN_COOLDOWN_TURNS
}
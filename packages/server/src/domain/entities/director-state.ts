// Persisted director memory on worlds.director_state_json. Pure.

import type { DirectorBeatKind, DirectorCastSlot, DirectorPhase } from './director-beat'

export type DirectorBrainReason = 'stall' | 'climax' | 'empty_dossier' | 'cast_collision'

export type PendingDirectorBeat = {
  beatKind: DirectorBeatKind
  foregroundThreadId: number | null
  mustStage: string[]
  mustNot: string[]
  cast: DirectorCastSlot[]
  guidanceLines: string[]
  reason: DirectorBrainReason
  sourceTurnId: number
}

export type DirectorState = {
  pending: PendingDirectorBeat | null
  lastBrainTurnId: number | null
  lastBrainReason: DirectorBrainReason | null
  /** Last consumed BeatBrief kind — used to detect stall streaks and in-scene play. */
  lastBeatKind: DirectorBeatKind | null
  lastForegroundThreadId: number | null
  stallStreak: number
  /** Protagonist cannot act (unconscious, restrained, etc.) until restore. */
  agencyLocked: boolean
}

export function emptyDirectorState(): DirectorState {
  return {
    pending: null,
    lastBrainTurnId: null,
    lastBrainReason: null,
    lastBeatKind: null,
    lastForegroundThreadId: null,
    stallStreak: 0,
    agencyLocked: false,
  }
}
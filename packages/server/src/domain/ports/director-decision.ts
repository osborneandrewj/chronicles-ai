import type {
  DirectorBeatKind,
  DirectorCastSlot,
  DirectorPhase,
} from '@/domain/entities/director-beat'
import type { DirectorBrainReason } from '@/domain/entities/director-state'

export type DirectorBrainInput = {
  reason: DirectorBrainReason
  premise: string
  playerText: string
  narratorText: string
  threads: Array<{
    id: number
    title: string
    kind: string
    summary: string | null
    status: string
  }>
  present: Array<{ id: number; name: string }>
  lastDecision: {
    beatKind: DirectorBeatKind | null
    phase: DirectorPhase | null
    tension: number
    foregroundTitle: string | null
    mustStage: string[]
    cast: DirectorCastSlot[]
  }
}

export type DirectorBrainResult = {
  beatKind: DirectorBeatKind
  foregroundThreadId: number | null
  mustStage: string[]
  mustNot: string[]
  cast: DirectorCastSlot[]
  guidanceLines: string[]
}

export interface DirectorDecisionPort {
  /** Fail-open: return null on skip/error. Never throws to the turn pipeline. */
  proposeNextBeat(input: DirectorBrainInput): Promise<DirectorBrainResult | null>
}
// Director beat — pure structure for one-turn story pressure (Track A1).
// Soft guidance only; narrator may interpret. No I/O.

export type DirectorPhase =
  | 'setup'
  | 'rising'
  | 'climax'
  | 'resolution'
  | 'concluded'

export type DirectorBeat = {
  /** Highest-ranked active thread pressuring STATE this turn. */
  foregroundThreadId: number | null
  phase: DirectorPhase | null
  /** 0..1 advisory tension on the foreground arc. */
  tension: number
  /** Soft narrator lines — craft may interpret, never hard mandates. */
  guidanceLines: string[]
  suggestResolveThreadIds: number[]
  suggestCompleteObjectiveIds: number[]
  suggestDormantThreadIds: number[]
}

/** Empty fail-open beat when the dossier has nothing to direct. */
export function emptyDirectorBeat(): DirectorBeat {
  return {
    foregroundThreadId: null,
    phase: null,
    tension: 0,
    guidanceLines: [],
    suggestResolveThreadIds: [],
    suggestCompleteObjectiveIds: [],
    suggestDormantThreadIds: [],
  }
}

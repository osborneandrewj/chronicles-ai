// Director beat — one-turn story pressure (Track A1 + BeatBrief).
// mustStage / mustNot / cast are structural (same force as planned moves).
// guidanceLines stay soft craft notes. No I/O.

export type DirectorPhase =
  | 'setup'
  | 'rising'
  | 'climax'
  | 'resolution'
  | 'concluded'

export type DirectorBeatKind =
  | 'pressure'
  | 'reveal'
  | 'arrival'
  | 'close'
  | 'stall_escalate'
  | 'local'
  | 'yield'

export type DirectorCastRole = 'initiate' | 'react' | 'background' | 'arrive'

export type DirectorCastSlot = {
  characterId: number
  name: string
  role: DirectorCastRole
}

export type DirectorBeat = {
  /** Highest-ranked active thread pressuring STATE this turn. */
  foregroundThreadId: number | null
  phase: DirectorPhase | null
  /** 0..1 advisory tension on the foreground arc. */
  tension: number
  /** Structural beat kind. Null when the dossier has nothing to direct. */
  beatKind: DirectorBeatKind | null
  /** Binding: narrator must realize these as this turn's fiction. */
  mustStage: string[]
  /** Binding: narrator must not do these this turn. */
  mustNot: string[]
  /** Who initiates / reacts / stays background / is arriving. */
  cast: DirectorCastSlot[]
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
    beatKind: null,
    mustStage: [],
    mustNot: [],
    cast: [],
    guidanceLines: [],
    suggestResolveThreadIds: [],
    suggestCompleteObjectiveIds: [],
    suggestDormantThreadIds: [],
  }
}

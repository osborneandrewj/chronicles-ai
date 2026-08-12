// Subworld exit dossier bookkeeping (Track A4). Leaving a sim must not freeze
// eternal actives. Pure: takes dossier + exit kind, returns status writes.
// Copy prefers "left unresolved" over moral failure unless death.

import type { StoryObjective, StoryThread } from '@/domain/entities'
import type { ExitKind } from '@/domain/services/sim-run-report'

export type ConcludeThreadWrite = {
  id: number
  status: 'dormant' | 'failed' | 'resolved'
  resolved_turn_id: number | null
  reason: string
}

export type ConcludeObjectiveWrite = {
  id: number
  status: 'failed' | 'blocked' | 'completed'
  completed_turn_id: number | null
  blocker: string | null
  reason: string
}

export type ConcludeSubworldDossierResult = {
  threadWrites: ConcludeThreadWrite[]
  objectiveWrites: ConcludeObjectiveWrite[]
  /** Optional hub aftermath thread seed (idempotent title). */
  hubAftermathTitle: string | null
  hubAftermathSummary: string | null
}

const LEFT_BLOCKER = 'Left the simulation before this was finished'

/**
 * Mark abandoned subworld arcs on exit. Already closed rows are left alone.
 * Death → more failed; return/abort → dormant threads + failed/blocked objectives.
 */
export function concludeSubworldDossier(args: {
  threads: StoryThread[]
  objectives: StoryObjective[]
  /** Sim exit kind; non-death (e.g. awakening/return) leaves work unresolved. */
  exitKind: ExitKind | 'return' | 'abort'
  turnId: number | null
  subworldName?: string | null
  reportHeadline?: string | null
}): ConcludeSubworldDossierResult {
  const threadWrites: ConcludeThreadWrite[] = []
  const objectiveWrites: ConcludeObjectiveWrite[] = []
  const isDeath = args.exitKind === 'death'

  for (const t of args.threads) {
    if (t.status !== 'active') continue
    if (isDeath) {
      threadWrites.push({
        id: t.id,
        status: 'failed',
        resolved_turn_id: args.turnId,
        reason: 'subworld_exit_death',
      })
    } else {
      threadWrites.push({
        id: t.id,
        status: 'dormant',
        resolved_turn_id: null,
        reason: 'subworld_exit_left_unresolved',
      })
    }
  }

  for (const o of args.objectives) {
    if (o.status !== 'active' && o.status !== 'blocked') continue
    if (isDeath) {
      objectiveWrites.push({
        id: o.id,
        status: 'failed',
        completed_turn_id: args.turnId,
        blocker: o.blocker ?? 'Subject did not survive the simulation',
        reason: 'subworld_exit_death',
      })
    } else {
      objectiveWrites.push({
        id: o.id,
        status: 'failed',
        completed_turn_id: args.turnId,
        blocker: LEFT_BLOCKER,
        reason: 'subworld_exit_left_unresolved',
      })
    }
  }

  const name = (args.subworldName ?? 'the simulation').trim() || 'the simulation'
  const hubAftermathTitle = `Aftermath — ${name}`
  const hubAftermathSummary =
    args.reportHeadline?.trim() ||
    (isDeath
      ? `Run ended in death inside ${name}; residual pressure may surface on the hub.`
      : `Subject left ${name} with work left unresolved; residual pressure may surface on the hub.`)

  return {
    threadWrites,
    objectiveWrites,
    hubAftermathTitle,
    hubAftermathSummary,
  }
}

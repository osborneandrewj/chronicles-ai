// Decide which dossier rows to close from a director BeatBrief + confirmation.
// Pure. Does not write. Confirmation is prose resolution language and/or a
// staged/modified NPC reconcile when the beat is already a close.

import type { StoryObjective, StoryThread } from '@/domain/entities'
import type { DirectorBeatKind } from '@/domain/entities/director-beat'
import { hasResolutionStorySignal } from '@/domain/services/story-signal'

export type DirectorCloseTarget = {
  id: number
  title: string
  status: 'resolved' | 'failed'
}

export type DirectorObjectiveClose = {
  id: number
  title: string
  status: 'completed' | 'failed'
}

export type DirectorClosePlan = {
  threads: DirectorCloseTarget[]
  objectives: DirectorObjectiveClose[]
}

export type DecideDirectorClosesInput = {
  beatKind: DirectorBeatKind | null
  foregroundThreadId: number | null
  suggestResolveThreadIds: number[]
  suggestCompleteObjectiveIds: number[]
  threads: Array<Pick<StoryThread, 'id' | 'title' | 'status'>>
  objectives: Array<Pick<StoryObjective, 'id' | 'title' | 'status'>>
  playerText: string
  narratorText: string
  reconcileConfirmed: boolean
}

export function emptyDirectorClosePlan(): DirectorClosePlan {
  return { threads: [], objectives: [] }
}

export function decideDirectorCloses(input: DecideDirectorClosesInput): DirectorClosePlan {
  const asked =
    input.beatKind === 'close' ||
    input.suggestResolveThreadIds.length > 0 ||
    input.suggestCompleteObjectiveIds.length > 0
  if (!asked) return emptyDirectorClosePlan()

  const proseConfirm = hasResolutionStorySignal(input.playerText, input.narratorText)
  const confirmed = proseConfirm || (input.beatKind === 'close' && input.reconcileConfirmed)
  if (!confirmed) return emptyDirectorClosePlan()

  const failed = isFailureOutcome(input.playerText, input.narratorText)
  const threadStatus = failed ? 'failed' : 'resolved'
  const objectiveStatus = failed ? 'failed' : 'completed'

  const threadIds = new Set(input.suggestResolveThreadIds)
  if (input.beatKind === 'close' && input.foregroundThreadId != null) {
    threadIds.add(input.foregroundThreadId)
  }

  const threads: DirectorCloseTarget[] = input.threads
    .filter((t) => threadIds.has(t.id) && t.status === 'active')
    .map((t) => ({ id: t.id, title: t.title, status: threadStatus }))

  const objIds = new Set(input.suggestCompleteObjectiveIds)
  const objectives: DirectorObjectiveClose[] = input.objectives
    .filter((o) => objIds.has(o.id) && (o.status === 'active' || o.status === 'blocked'))
    .map((o) => ({ id: o.id, title: o.title, status: objectiveStatus }))

  return { threads, objectives }
}

function isFailureOutcome(playerText: string, narratorText: string): boolean {
  const text = `${playerText}\n${narratorText}`.toLowerCase()
  return /\b(fail(?:ed|s|ing)?|collapses?|too\s+late|deadline\s+(passed|missed)|miss(?:ed|es|ing)?\s+(the\s+)?deadline)\b/.test(
    text,
  )
}
// Close-bias gate (Track A3). After the main archivist patch, decide whether a
// focused lifecycle-only Haiku pass is warranted. Pure — fail-open when unsure.

import { hasResolutionStorySignal } from '@/domain/services/story-signal'

export type CloseBiasGateInput = {
  playerText: string
  narratorText: string
  /** Active threads + active/blocked objectives before this turn's apply. */
  activeDossierCount: number
  /**
   * True when the main archivist patch already included a lifecycle close
   * (thread resolved/failed or objective completed/failed).
   */
  mainPatchClosedSomething: boolean
  /**
   * Soft director suggestions for resolve/complete (optional).
   */
  directorSuggestsClose?: boolean
}

/**
 * Run a focused close pass when fiction clearly resolved work but the main
 * extract did not close anything and the dossier still has pressure.
 */
export function shouldRunCloseBiasPass(input: CloseBiasGateInput): boolean {
  if (input.activeDossierCount <= 0) return false
  if (input.mainPatchClosedSomething) return false
  if (input.directorSuggestsClose) return true
  return hasResolutionStorySignal(input.playerText, input.narratorText)
}

/** Count lifecycle closes present in an archivist-shaped patch. */
export function patchClosesSomething(patch: {
  story_threads?: Array<{ status?: string }> | null
  story_objectives?: Array<{ status?: string }> | null
}): boolean {
  for (const t of patch.story_threads ?? []) {
    if (t.status === 'resolved' || t.status === 'failed' || t.status === 'dormant') {
      return true
    }
  }
  for (const o of patch.story_objectives ?? []) {
    if (o.status === 'completed' || o.status === 'failed') return true
  }
  return false
}

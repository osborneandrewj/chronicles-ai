// Pure lifecycle rule for story-thread *references* from child dossier rows
// (clues, objectives, timeline events). Linking to a thread must not reopen a
// closed parent; only explicit story_threads[] patches may set lifecycle status.

export type SoftQuestKind = 'mystery' | 'background'

export type ExistingThreadRef = {
  id: number
  kind: string
  status: string
}

export type ThreadReferenceCreate = {
  action: 'create'
  kind: 'quest' | 'mystery'
  status: 'active'
}

export type ThreadReferenceLink = {
  action: 'link'
  id: number
  /** When true, upgrade kind mystery/background → quest without touching status. */
  upgradeKindToQuest: boolean
}

export type ThreadReferenceDecision = ThreadReferenceCreate | ThreadReferenceLink

const SOFT_QUEST_KINDS = new Set<string>(['mystery', 'background'])

/**
 * Decide how a child-row thread_title should resolve to a parent thread.
 *
 * - Missing title → create (caller supplies title).
 * - Existing thread → link only; never change status.
 * - preferQuest upgrades soft kinds only while the thread is still active.
 */
export function resolveThreadReference(
  existing: ExistingThreadRef | null,
  options: { preferQuest?: boolean } = {},
): ThreadReferenceDecision {
  if (!existing) {
    return {
      action: 'create',
      kind: options.preferQuest ? 'quest' : 'mystery',
      status: 'active',
    }
  }

  const upgradeKindToQuest =
    !!options.preferQuest &&
    existing.status === 'active' &&
    SOFT_QUEST_KINDS.has(existing.kind)

  return {
    action: 'link',
    id: existing.id,
    upgradeKindToQuest,
  }
}

export function isClosedThreadStatus(status: string): boolean {
  return status === 'resolved' || status === 'failed' || status === 'dormant'
}

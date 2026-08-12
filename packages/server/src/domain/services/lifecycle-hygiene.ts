// Deterministic dossier lifecycle hygiene (Track A2). When work finishes,
// sibling / parent rows should not stay eternally active as orphan routes.
// Pure: takes loaded rows + a lifecycle event, returns write intents.
// Fail-open — never invents new threads; only retargets status.

import type { StoryObjective, StoryThread } from '@/domain/entities'

export type LifecycleEvent =
  | { type: 'thread_closed'; threadId: number; status: 'resolved' | 'failed' }
  | { type: 'objective_completed'; objectiveId: number; threadId: number | null }
  | { type: 'objective_failed'; objectiveId: number; threadId: number | null }

export type ThreadStatusWrite = {
  id: number
  status: 'resolved' | 'failed' | 'dormant'
  resolved_turn_id: number | null
  reason: string
}

export type ObjectiveStatusWrite = {
  id: number
  status: 'completed' | 'failed' | 'blocked'
  completed_turn_id: number | null
  blocker: string | null
  reason: string
}

export type LifecycleHygieneResult = {
  threadWrites: ThreadStatusWrite[]
  objectiveWrites: ObjectiveStatusWrite[]
}

/**
 * Apply lifecycle hygiene for one event against the current dossier snapshot.
 *
 * Policies:
 * 1. Thread → resolved|failed ⇒ sibling actives under that thread complete/fail/dormant.
 * 2. Last active objective complete ⇒ suggest parent resolve (thread write).
 * 3. Objective failed with parent still active ⇒ leave parent (caller may dormant later).
 */
export function applyLifecycleHygiene(args: {
  event: LifecycleEvent
  threads: StoryThread[]
  objectives: StoryObjective[]
  turnId: number | null
}): LifecycleHygieneResult {
  const threadWrites: ThreadStatusWrite[] = []
  const objectiveWrites: ObjectiveStatusWrite[] = []
  const turnId = args.turnId

  if (args.event.type === 'thread_closed') {
    const { threadId, status } = args.event
    const thread = args.threads.find((t) => t.id === threadId)
    if (!thread) return { threadWrites, objectiveWrites }

    const childObjectives = args.objectives.filter(
      (o) => o.thread_id === threadId || titlesMatch(o.thread_title, thread.title),
    )
    for (const o of childObjectives) {
      if (o.status === 'completed' || o.status === 'failed') continue
      if (status === 'resolved') {
        objectiveWrites.push({
          id: o.id,
          status: 'completed',
          completed_turn_id: turnId,
          blocker: null,
          reason: 'parent_thread_resolved',
        })
      } else {
        objectiveWrites.push({
          id: o.id,
          status: 'failed',
          completed_turn_id: turnId,
          blocker: o.blocker ?? 'Parent thread failed',
          reason: 'parent_thread_failed',
        })
      }
    }

    // Sibling active threads that are pure route-children (same title prefix /
    // "route" style) go dormant — never force-resolve unrelated threats.
    for (const t of args.threads) {
      if (t.id === threadId) continue
      if (t.status !== 'active') continue
      if (isRouteSibling(thread, t)) {
        threadWrites.push({
          id: t.id,
          status: 'dormant',
          resolved_turn_id: null,
          reason: 'sibling_route_after_parent_close',
        })
      }
    }
    return { threadWrites, objectiveWrites }
  }

  if (args.event.type === 'objective_completed') {
    const event = args.event
    const obj = args.objectives.find((o) => o.id === event.objectiveId)
    if (!obj) return { threadWrites, objectiveWrites }

    const parentId = event.threadId ?? obj.thread_id
    if (parentId == null) return { threadWrites, objectiveWrites }

    const parent = args.threads.find((t) => t.id === parentId)
    if (!parent || parent.status !== 'active') return { threadWrites, objectiveWrites }

    const siblings = args.objectives.filter(
      (o) =>
        o.id !== obj.id &&
        (o.thread_id === parentId || titlesMatch(o.thread_title, parent.title)) &&
        (o.status === 'active' || o.status === 'blocked'),
    )
    if (siblings.length === 0) {
      // Last active objective under parent → suggest parent resolve.
      threadWrites.push({
        id: parent.id,
        status: 'resolved',
        resolved_turn_id: turnId,
        reason: 'last_objective_completed',
      })
    }
    return { threadWrites, objectiveWrites }
  }

  // objective_failed — no automatic parent fail (may still have other routes).
  return { threadWrites, objectiveWrites }
}

/**
 * Batch hygiene after an archivist patch applied multiple lifecycle closes.
 * Dedupes writes by id (last write wins).
 */
export function hygieneFromClosedRows(args: {
  closedThreadIds: Array<{ id: number; status: 'resolved' | 'failed' }>
  completedObjectiveIds: Array<{ id: number; threadId: number | null }>
  threads: StoryThread[]
  objectives: StoryObjective[]
  turnId: number | null
}): LifecycleHygieneResult {
  const threadById = new Map<number, ThreadStatusWrite>()
  const objById = new Map<number, ObjectiveStatusWrite>()

  for (const t of args.closedThreadIds) {
    const r = applyLifecycleHygiene({
      event: { type: 'thread_closed', threadId: t.id, status: t.status },
      threads: args.threads,
      objectives: args.objectives,
      turnId: args.turnId,
    })
    for (const w of r.threadWrites) threadById.set(w.id, w)
    for (const w of r.objectiveWrites) objById.set(w.id, w)
  }
  for (const o of args.completedObjectiveIds) {
    const r = applyLifecycleHygiene({
      event: {
        type: 'objective_completed',
        objectiveId: o.id,
        threadId: o.threadId,
      },
      threads: args.threads,
      objectives: args.objectives,
      turnId: args.turnId,
    })
    for (const w of r.threadWrites) threadById.set(w.id, w)
    for (const w of r.objectiveWrites) objById.set(w.id, w)
  }

  return {
    threadWrites: [...threadById.values()],
    objectiveWrites: [...objById.values()],
  }
}

function titlesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Route-style siblings: same kind quest with overlapping title tokens, or
 * explicit "route"/"path"/"objective branch" language. Conservative — false
 * negatives preferred over closing unrelated threats.
 */
function isRouteSibling(parent: StoryThread, other: StoryThread): boolean {
  if (parent.kind !== 'quest' && parent.kind !== 'mystery') return false
  if (other.kind === 'threat') return false
  const p = parent.title.toLowerCase()
  const o = other.title.toLowerCase()
  if (o.includes(p) || p.includes(o)) return true
  if (/\b(route|path|branch|follow-?up|aftermath)\b/.test(o) && shareToken(p, o)) {
    return true
  }
  return false
}

function shareToken(a: string, b: string): boolean {
  const ta = new Set(a.split(/[^a-z0-9]+/).filter((w) => w.length >= 4))
  for (const w of b.split(/[^a-z0-9]+/)) {
    if (w.length >= 4 && ta.has(w)) return true
  }
  return false
}

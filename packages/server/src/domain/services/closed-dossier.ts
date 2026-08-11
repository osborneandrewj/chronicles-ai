// Compact "recently closed" and active-pressure selections for narrator,
// archivist, and NPC agent context. Pure — no I/O. Caps keep token cost small.

import type { StoryDossier, StoryObjective, StoryThread } from '@/domain/entities'

export const CLOSED_DOSSIER_CAPS = {
  narratorThreads: 3,
  narratorObjectives: 3,
  archivistThreads: 5,
  archivistObjectives: 5,
  npcThreads: 3,
  npcObjectives: 3,
  npcActivePressures: 4,
} as const

const CLOSED_THREAD_STATUSES = new Set(['resolved', 'failed'])
const CLOSED_OBJECTIVE_STATUSES = new Set(['completed', 'failed'])
const ACTIVE_OBJECTIVE_STATUSES = new Set(['active', 'blocked'])

function closureTurnKey(row: {
  resolved_turn_id?: number | null
  completed_turn_id?: number | null
  source_turn_id?: number | null
  updated_at?: string
  created_at?: string
}): number {
  const turn =
    row.resolved_turn_id ??
    row.completed_turn_id ??
    row.source_turn_id ??
    null
  if (turn != null && Number.isFinite(turn)) return turn
  const t = row.updated_at || row.created_at || ''
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : 0
}

function byClosureRecencyDesc<T extends {
  resolved_turn_id?: number | null
  completed_turn_id?: number | null
  source_turn_id?: number | null
  updated_at?: string
  created_at?: string
}>(a: T, b: T): number {
  return closureTurnKey(b) - closureTurnKey(a)
}

export function selectRecentlyClosedThreads(
  threads: StoryThread[],
  cap: number,
): StoryThread[] {
  return threads
    .filter((t) => CLOSED_THREAD_STATUSES.has(t.status))
    .sort(byClosureRecencyDesc)
    .slice(0, Math.max(0, cap))
}

export function selectRecentlyClosedObjectives(
  objectives: StoryObjective[],
  cap: number,
): StoryObjective[] {
  return objectives
    .filter((o) => CLOSED_OBJECTIVE_STATUSES.has(o.status))
    .sort(byClosureRecencyDesc)
    .slice(0, Math.max(0, cap))
}

export type CompactClosedThread = {
  title: string
  status: string
  kind?: string
  summary: string | null
  resolved_turn_id: number | null
}

export type CompactClosedObjective = {
  title: string
  status: string
  thread_title: string | null
  detail: string | null
  completed_turn_id: number | null
}

export type CompactActivePressure = {
  title: string
  kind: string
  status: string
  summary: string | null
}

function compactThread(t: StoryThread): CompactClosedThread {
  return {
    title: t.title,
    status: t.status,
    kind: t.kind,
    summary: t.summary,
    resolved_turn_id: t.resolved_turn_id,
  }
}

function compactObjective(o: StoryObjective): CompactClosedObjective {
  return {
    title: o.title,
    status: o.status,
    thread_title: o.thread_title,
    detail: o.detail,
    completed_turn_id: o.completed_turn_id,
  }
}

/** Compact story context for the NPC agent (active + recently closed). */
export function buildNpcStoryContext(dossier: StoryDossier): {
  active_pressures: CompactActivePressure[]
  recently_closed_threads: CompactClosedThread[]
  recently_closed_objectives: CompactClosedObjective[]
} {
  const activeThreads = dossier.threads
    .filter((t) => t.status === 'active')
    .slice(0, CLOSED_DOSSIER_CAPS.npcActivePressures)
    .map((t) => ({
      title: t.title,
      kind: t.kind,
      status: t.status,
      summary: t.summary,
    }))

  const activeObjectives = dossier.objectives
    .filter((o) => ACTIVE_OBJECTIVE_STATUSES.has(o.status))
    .slice(0, CLOSED_DOSSIER_CAPS.npcActivePressures)
    .map((o) => ({
      title: o.title,
      kind: 'objective',
      status: o.status,
      summary: o.detail,
    }))

  // Prefer threads, then fill remaining slots with objectives.
  const active_pressures = [
    ...activeThreads,
    ...activeObjectives,
  ].slice(0, CLOSED_DOSSIER_CAPS.npcActivePressures)

  return {
    active_pressures,
    recently_closed_threads: selectRecentlyClosedThreads(
      dossier.threads,
      CLOSED_DOSSIER_CAPS.npcThreads,
    ).map(compactThread),
    recently_closed_objectives: selectRecentlyClosedObjectives(
      dossier.objectives,
      CLOSED_DOSSIER_CAPS.npcObjectives,
    ).map(compactObjective),
  }
}

/** Compact closed rows for archivist prior-state JSON. */
export function buildArchivistClosedDossier(dossier: StoryDossier): {
  recently_closed_threads: CompactClosedThread[]
  recently_closed_objectives: CompactClosedObjective[]
} {
  return {
    recently_closed_threads: selectRecentlyClosedThreads(
      dossier.threads,
      CLOSED_DOSSIER_CAPS.archivistThreads,
    ).map(compactThread),
    recently_closed_objectives: selectRecentlyClosedObjectives(
      dossier.objectives,
      CLOSED_DOSSIER_CAPS.archivistObjectives,
    ).map(compactObjective),
  }
}

/** Count active playable dossier pressure (threads + objectives). */
export function countActiveDossierRows(dossier: StoryDossier): number {
  const threads = dossier.threads.filter((t) => t.status === 'active').length
  const objectives = dossier.objectives.filter((o) =>
    ACTIVE_OBJECTIVE_STATUSES.has(o.status),
  ).length
  return threads + objectives
}

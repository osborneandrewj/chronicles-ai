// Pure Director service (Track A1). One foreground pressure decision per turn.
// Deterministic; fail-open empty beat. Soft guidance only — no hard climax
// fiction. Structure/closure gap, not prose volume.

import type { DirectorBeat, DirectorPhase } from '@/domain/entities/director-beat'
import { emptyDirectorBeat } from '@/domain/entities/director-beat'
import {
  extractDeadlineMinutes,
  rankObjectives,
  rankThreads,
  type RankableObjective,
  type RankableThread,
  type RankingContext,
} from '@/domain/services/dossier-ranking'

/** Cap active threats shown as heavy pressure in STATE. */
export const DIRECTOR_THREAT_CAP = 2
/** Cap active quests as heavy pressure. */
export const DIRECTOR_QUEST_CAP = 1
/** Turns without engagement before stall escalation. */
export const DIRECTOR_STALL_TURNS = 8

export type RankableObjectiveWithThread = RankableObjective & {
  thread_title?: string | null
  thread_id?: number | null
}

export type DirectorSnapshot = {
  threads: RankableThread[]
  objectives: RankableObjectiveWithThread[]
  clockMinutes: number | null
  /** Current player turn id (for stall / recency). */
  currentTurnId: number | null
  playerText: string
  /**
   * Optional names of characters currently en route (Track M). Soft preference
   * for threads that mention them — never required for A1.
   */
  enRouteNames?: string[]
}

export type DirectorDecision = DirectorBeat & {
  /** Thread ids that should render as compact background one-liners. */
  backgroundThreadIds: number[]
  /** Max threats + quests the renderer should treat as heavy pressure. */
  heavyThreadIds: number[]
}

/**
 * Decide the turn's director beat. Pure.
 *
 * Rules (v1):
 * 1. Rank active threads (stakes + recency + deadline).
 * 2. One foreground: highest rank.
 * 3. Tension: engage bump / ignore decay / stall escalate.
 * 4. Cap heavy STATE threats/quests; rest are background.
 * 5. Soft suggest-resolve when phase is resolution and signals match.
 */
export function decideDirector(snapshot: DirectorSnapshot): DirectorDecision {
  const activeThreads = snapshot.threads.filter((t) => t.status === 'active')
  const activeObjectives = snapshot.objectives.filter(
    (o) => o.status === 'active' || o.status === 'blocked',
  )

  if (activeThreads.length === 0 && activeObjectives.length === 0) {
    return { ...emptyDirectorBeat(), backgroundThreadIds: [], heavyThreadIds: [] }
  }

  const ctx: RankingContext = { clockMinutes: snapshot.clockMinutes }
  const ranked = rankThreads(activeThreads, ctx, activeThreads.length)
  // Soft boost: threads whose text mentions an en-route character.
  const enRoute = (snapshot.enRouteNames ?? []).map((n) => n.toLowerCase()).filter(Boolean)
  const ordered =
    enRoute.length === 0
      ? ranked
      : [...ranked].sort((a, b) => {
          const aHit = mentionsAny(a, enRoute) ? 1 : 0
          const bHit = mentionsAny(b, enRoute) ? 1 : 0
          return bHit - aHit
        })

  const foreground = ordered[0] ?? null
  const foregroundThreadId = foreground?.id ?? null

  const phase = derivePhase(foreground, activeObjectives, snapshot)
  const engaged = foreground
    ? playerEngages(snapshot.playerText, foreground, activeObjectives)
    : false
  const stallTurns = foreground
    ? turnsSince(foreground, snapshot.currentTurnId)
    : 0
  const tension = computeTension({ engaged, phase, stallTurns })

  const heavyThreadIds = selectHeavyThreadIds(ordered)
  const backgroundThreadIds = ordered
    .map((t) => t.id)
    .filter((id) => id !== foregroundThreadId && !heavyThreadIds.includes(id))

  const guidanceLines = buildGuidance({
    foreground,
    phase,
    tension,
    engaged,
    stallTurns,
    activeObjectives,
    clockMinutes: snapshot.clockMinutes,
  })

  const { suggestResolveThreadIds, suggestCompleteObjectiveIds, suggestDormantThreadIds } =
    softSuggestions({
      ordered,
      activeObjectives,
      phase,
      engaged,
      stallTurns,
      playerText: snapshot.playerText,
    })

  return {
    foregroundThreadId,
    phase,
    tension,
    guidanceLines,
    suggestResolveThreadIds,
    suggestCompleteObjectiveIds,
    suggestDormantThreadIds,
    backgroundThreadIds,
    heavyThreadIds,
  }
}

// ── Internals ───────────────────────────────────────────────────────────────

function mentionsAny(
  t: RankableThread,
  namesLower: string[],
): boolean {
  const hay = `${t.title} ${t.summary ?? ''} ${t.stakes ?? ''} ${t.hidden ?? ''}`.toLowerCase()
  return namesLower.some((n) => n.length >= 2 && hay.includes(n))
}

function derivePhase(
  foreground: RankableThread | null,
  objectives: RankableObjectiveWithThread[],
  snapshot: DirectorSnapshot,
): DirectorPhase | null {
  if (!foreground) {
    if (objectives.length === 0) return 'concluded'
    return 'rising'
  }
  const childObj = objectives.filter(
    (o) =>
      o.thread_title &&
      foreground.title &&
      o.thread_title.toLowerCase() === foreground.title.toLowerCase(),
  )
  const activeChild = childObj.filter((o) => o.status === 'active' || o.status === 'blocked')
  const completedChild = childObj.filter((o) => o.status === 'completed')

  const deadline = extractDeadlineMinutes(
    foreground.title,
    foreground.summary,
    foreground.stakes,
    foreground.consequences,
    foreground.hidden,
  )
  const clock = snapshot.clockMinutes
  const nearDeadline =
    deadline != null && clock != null && deadline - clock <= 1440 && deadline - clock > 0
  const pastDeadline = deadline != null && clock != null && clock >= deadline

  if (pastDeadline) return 'climax'
  if (nearDeadline && activeChild.length > 0) return 'climax'
  if (completedChild.length > 0 && activeChild.length === 0) return 'resolution'
  if (activeChild.length === 0 && completedChild.length === 0) {
    // Fresh thread, little structure.
    const age = turnsSince(foreground, snapshot.currentTurnId)
    if (age <= 2) return 'setup'
  }
  return 'rising'
}

function turnsSince(
  row: { source_turn_id?: number | null; updated_at?: string },
  currentTurnId: number | null,
): number {
  if (
    currentTurnId != null &&
    row.source_turn_id != null &&
    Number.isFinite(row.source_turn_id)
  ) {
    return Math.max(0, currentTurnId - row.source_turn_id)
  }
  return 0
}

function playerEngages(
  playerText: string,
  thread: RankableThread,
  objectives: RankableObjectiveWithThread[],
): boolean {
  const text = playerText.toLowerCase()
  if (!text.trim()) return false
  const tokens = significantTokens(
    `${thread.title} ${thread.summary ?? ''} ${thread.stakes ?? ''}`,
  )
  if (tokens.some((t) => text.includes(t))) return true
  for (const o of objectives) {
    if (o.status !== 'active' && o.status !== 'blocked') continue
    const ot = significantTokens(`${o.title} ${o.detail ?? ''}`)
    if (ot.some((t) => text.includes(t))) return true
  }
  return false
}

function significantTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 12)
}

function computeTension(args: {
  engaged: boolean
  phase: DirectorPhase | null
  stallTurns: number
}): number {
  let t = 0.35
  if (args.phase === 'setup') t = 0.25
  if (args.phase === 'rising') t = 0.45
  if (args.phase === 'climax') t = 0.8
  if (args.phase === 'resolution') t = 0.55
  if (args.phase === 'concluded') t = 0.1
  if (args.engaged) t = Math.min(1, t + 0.15)
  if (args.stallTurns >= DIRECTOR_STALL_TURNS) t = Math.min(1, t + 0.2)
  return Math.round(t * 100) / 100
}

function selectHeavyThreadIds(ordered: RankableThread[]): number[] {
  const threats = ordered.filter((t) => t.kind === 'threat').slice(0, DIRECTOR_THREAT_CAP)
  const quests = ordered.filter((t) => t.kind === 'quest').slice(0, DIRECTOR_QUEST_CAP)
  const ids = new Set<number>([...threats, ...quests].map((t) => t.id))
  // Always include foreground (first) if not already.
  if (ordered[0]) ids.add(ordered[0].id)
  return [...ids]
}

function buildGuidance(args: {
  foreground: RankableThread | null
  phase: DirectorPhase | null
  tension: number
  engaged: boolean
  stallTurns: number
  activeObjectives: RankableObjectiveWithThread[]
  clockMinutes: number | null
}): string[] {
  const lines: string[] = []
  if (!args.foreground) {
    lines.push('No active foreground arc — stage local scene pressure only.')
    return lines
  }
  lines.push(
    `Foreground arc: "${args.foreground.title}" (${args.foreground.kind}, phase ${args.phase ?? 'rising'}, tension ${args.tension.toFixed(2)}).`,
  )
  if (args.foreground.stakes) {
    lines.push(`Stakes: ${truncate(args.foreground.stakes, 160)}`)
  }
  if (args.phase === 'climax') {
    lines.push('Climax window: let consequences land; do not open a new major arc this turn.')
  }
  if (args.phase === 'resolution') {
    lines.push(
      'Resolution window: stage payoff residue; prefer closing open objectives over new complications.',
    )
  }
  if (args.stallTurns >= DIRECTOR_STALL_TURNS && !args.engaged) {
    lines.push(
      'Arc is stalling — escalate soft pressure (time, NPC initiative, environmental cost) without railroading.',
    )
  }
  if (args.phase === 'setup') {
    lines.push('Setup: establish pressure cleanly; one clear hook is enough.')
  }
  const deadline = extractDeadlineMinutes(
    args.foreground.title,
    args.foreground.summary,
    args.foreground.stakes,
    args.foreground.consequences,
  )
  if (deadline != null && args.clockMinutes != null) {
    const delta = deadline - args.clockMinutes
    if (delta <= 0) {
      lines.push('Deadline has passed — stage failure pressure or overdue cost.')
    } else if (delta <= 1440) {
      lines.push('Deadline within ~1 day of world clock — compress time pressure.')
    }
  }
  return lines
}

function softSuggestions(args: {
  ordered: RankableThread[]
  activeObjectives: RankableObjectiveWithThread[]
  phase: DirectorPhase | null
  engaged: boolean
  stallTurns: number
  playerText: string
}): {
  suggestResolveThreadIds: number[]
  suggestCompleteObjectiveIds: number[]
  suggestDormantThreadIds: number[]
} {
  const suggestResolveThreadIds: number[] = []
  const suggestCompleteObjectiveIds: number[] = []
  const suggestDormantThreadIds: number[] = []

  const resolutionLang =
    /\b(done|finished|complete|resolved|over|settled|ended|paid|escaped|defeated)\b/i.test(
      args.playerText,
    )

  if (args.phase === 'resolution' || resolutionLang) {
    const fg = args.ordered[0]
    if (fg) suggestResolveThreadIds.push(fg.id)
    for (const o of args.activeObjectives.slice(0, 3)) {
      if (o.status === 'active' || o.status === 'blocked') {
        suggestCompleteObjectiveIds.push(o.id)
      }
    }
  }

  // Background threads that have been idle forever → soft dormant suggestion.
  for (const t of args.ordered.slice(3)) {
    if (t.kind === 'background' || t.kind === 'relationship') {
      suggestDormantThreadIds.push(t.id)
    }
  }

  return { suggestResolveThreadIds, suggestCompleteObjectiveIds, suggestDormantThreadIds }
}

function truncate(s: string, n: number): string {
  const t = s.trim()
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`
}

/** Re-export ranking helper for Director-shaped tests. */
export { rankObjectives, rankThreads }

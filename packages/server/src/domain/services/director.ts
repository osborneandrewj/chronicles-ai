// Pure Director service (Track A1). One foreground pressure decision per turn.
// Deterministic; fail-open empty beat. Soft guidance only — no hard climax
// fiction. Structure/closure gap, not prose volume.

import type {
  DirectorBeat,
  DirectorBeatKind,
  DirectorCastSlot,
  DirectorPhase,
} from '@/domain/entities/director-beat'
import { emptyDirectorBeat } from '@/domain/entities/director-beat'
import type { PendingDirectorBeat } from '@/domain/entities/director-state'
import {
  extractDeadlineMinutes,
  rankObjectives,
  rankThreads,
  type RankableObjective,
  type RankableThread,
  type RankingContext,
} from '@/domain/services/dossier-ranking'
import { isPlayerYieldingFloor } from '@/domain/services/open-order'
import { isSettledLeftoverThread } from '@/domain/services/settled-findings'

/** Cap active threats shown as heavy pressure in STATE. */
export const DIRECTOR_THREAT_CAP = 2
/** Cap active quests as heavy pressure. */
export const DIRECTOR_QUEST_CAP = 1
/** Turns without engagement before stall escalation. */
export const DIRECTOR_STALL_TURNS = 8
/** Consecutive stall_escalate beats before MUST STAGE must change the board. */
export const DIRECTOR_STALL_REPEAT_BOARD = 1

const STAGING_BEATS = new Set<DirectorBeatKind>([
  'pressure',
  'reveal',
  'arrival',
  'close',
  'stall_escalate',
])

export type RankableObjectiveWithThread = RankableObjective & {
  thread_title?: string | null
  thread_id?: number | null
}

export type DirectorCastCandidate = {
  id: number
  name: string
  isPlayer?: boolean
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
  /** Present characters for CAST assignment (player is ignored). */
  presentCast?: DirectorCastCandidate[]
  /** En-route characters with ids (arrive slots). */
  enRouteCast?: DirectorCastCandidate[]
  /** Unused pending beat from last turn's gated brain. */
  pendingBeat?: PendingDirectorBeat | null
  /** Prior turn's consumed beat — in-scene play and stall-repeat. */
  lastBeatKind?: DirectorBeatKind | null
  lastForegroundThreadId?: number | null
  stallStreak?: number
  /** They cannot act; world should advance and restore agency. */
  wakeAdvance?: boolean
  /** Player text this turn authors a collapse or restraint. */
  collapsingThisTurn?: boolean
  /** Player asked to remain unable to act; still change the board. */
  stayUnder?: boolean
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
  const leftoverIds = new Set(
    snapshot.threads
      .filter((t) => isSettledLeftoverThread(t, snapshot.threads, snapshot.objectives))
      .map((t) => t.id),
  )
  const pendingBeat =
    snapshot.pendingBeat && leftoverIds.has(snapshot.pendingBeat.foregroundThreadId ?? -1)
      ? null
      : snapshot.pendingBeat
  const directed = { ...snapshot, pendingBeat }
  const activeThreads = directed.threads.filter(
    (t) => t.status === 'active' && !leftoverIds.has(t.id),
  )
  const activeObjectives = directed.objectives.filter(
    (o) => o.status === 'active' || o.status === 'blocked',
  )

  if (activeThreads.length === 0 && activeObjectives.length === 0) {
    return mergePendingBeat(emptyDossierDecision(directed, leftoverIds), directed)
  }

  const ctx: RankingContext = { clockMinutes: snapshot.clockMinutes }
  const ranked = rankThreads(activeThreads, ctx, activeThreads.length)
  const addressed = namedPresent(snapshot.playerText, snapshot.presentCast ?? [])
  const addressedTokens = nameTokens(addressed.map((c) => c.name))
  // Soft boost: player-addressed names, then en-route mentions.
  const enRoute = (snapshot.enRouteNames ?? []).map((n) => n.toLowerCase()).filter(Boolean)
  const ordered =
    addressedTokens.length === 0 && enRoute.length === 0
      ? ranked
      : [...ranked].sort((a, b) => {
          const aAddr = mentionsAny(a, addressedTokens) ? 1 : 0
          const bAddr = mentionsAny(b, addressedTokens) ? 1 : 0
          if (aAddr !== bAddr) return bAddr - aAddr
          const aHit = mentionsAny(a, enRoute) ? 1 : 0
          const bHit = mentionsAny(b, enRoute) ? 1 : 0
          return bHit - aHit
        })

  const foreground = ordered[0] ?? null
  const foregroundThreadId = foreground?.id ?? null

  const phase = derivePhase(foreground, activeObjectives, snapshot)
  const engaged = foreground ? isPlayerEngagedWithThread(snapshot, foreground) : false
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

  const cast = assignCast({
    present: snapshot.presentCast ?? [],
    enRoute: snapshot.enRouteCast ?? namesToCast(snapshot.enRouteNames),
    foreground,
    playerText: snapshot.playerText,
  })
  const closing =
    suggestResolveThreadIds.length > 0 || suggestCompleteObjectiveIds.length > 0
  const beatKind = deriveBeatKind({
    foreground,
    phase,
    engaged,
    stallTurns,
    playerText: snapshot.playerText,
    cast,
    hasObjectives: activeObjectives.length > 0,
    closing,
    wakeAdvance: snapshot.wakeAdvance,
    stayUnder: snapshot.stayUnder,
  })
  const lastForegroundThreadId = snapshot.lastForegroundThreadId ?? null
  const mustStage = buildMustStage({
    foreground,
    beatKind,
    cast,
    closing,
    stallTurns,
    engaged,
    lastBeatKind: snapshot.lastBeatKind ?? null,
    lastForegroundThreadId,
    stallStreak: snapshot.stallStreak ?? 0,
    wakeAdvance: snapshot.wakeAdvance === true,
    collapsingThisTurn: snapshot.collapsingThisTurn === true,
    stayUnder: snapshot.stayUnder === true,
    playerText: snapshot.playerText,
  })
  const settledTitles = snapshot.objectives
    .filter((o) => o.status === 'completed')
    .map((o) => o.title)
    .filter((t) => t.trim().length > 0)
    .slice(-3)
  const mustNot = buildMustNot({
    beatKind,
    phase,
    settledTitles,
    repeatPressure: isRepeatForegroundPressure({
      foreground,
      beatKind,
      lastBeatKind: snapshot.lastBeatKind ?? null,
      lastForegroundThreadId,
    }),
  })

  return mergePendingBeat(
    {
      foregroundThreadId,
      phase,
      tension,
      beatKind,
      mustStage,
      mustNot,
      cast,
      guidanceLines,
      suggestResolveThreadIds,
      suggestCompleteObjectiveIds,
      suggestDormantThreadIds: [...new Set([...suggestDormantThreadIds, ...leftoverIds])],
      backgroundThreadIds,
      heavyThreadIds,
    },
    directed,
  )
}

/** Overlay a pending brain beat unless the player engaged a different thread
 * or is in-scene on a stall pending (stall overlay would freeze a live scene). */
export function mergePendingBeat(
  decision: DirectorDecision,
  snapshot: DirectorSnapshot,
): DirectorDecision {
  const pending = snapshot.pendingBeat
  if (!pending) return decision
  if (playerOverridesPending(snapshot, pending)) return decision
  if (snapshot.wakeAdvance || snapshot.stayUnder) return decision
  if (shouldDropStallPending(snapshot, pending)) return decision
  if (shouldDropProcedurePending(snapshot, pending)) return decision
  return {
    ...decision,
    beatKind: pending.beatKind,
    foregroundThreadId: pending.foregroundThreadId ?? decision.foregroundThreadId,
    mustStage: pending.mustStage.length > 0 ? pending.mustStage : decision.mustStage,
    mustNot: uniqueLines([...decision.mustNot, ...pending.mustNot]),
    cast: pending.cast.length > 0 ? pending.cast : decision.cast,
    guidanceLines: uniqueLines([...pending.guidanceLines, ...decision.guidanceLines]),
  }
}

function playerOverridesPending(
  snapshot: DirectorSnapshot,
  pending: PendingDirectorBeat,
): boolean {
  if (pending.foregroundThreadId == null) return false
  const other = snapshot.threads.filter(
    (t) => t.status === 'active' && t.id !== pending.foregroundThreadId,
  )
  return other.some((t) => isPlayerEngagedWithThread(snapshot, t))
}

function shouldDropStallPending(
  snapshot: DirectorSnapshot,
  pending: PendingDirectorBeat,
): boolean {
  if (pending.beatKind !== 'stall_escalate') return false
  const thread =
    pending.foregroundThreadId != null
      ? snapshot.threads.find((t) => t.id === pending.foregroundThreadId)
      : null
  if (thread) return isPlayerEngagedWithThread(snapshot, thread)
  return !isIdleMove(snapshot.playerText)
}

/** Empty-dossier local pendings restage the same procedure forever unless dropped. */
function shouldDropProcedurePending(
  snapshot: DirectorSnapshot,
  pending: PendingDirectorBeat,
): boolean {
  if (pending.beatKind !== 'local') return false
  if (isRepeatEmptyLocal(snapshot)) return true
  if (pending.foregroundThreadId == null && !isIdleMove(snapshot.playerText)) return true
  return false
}

function isRepeatEmptyLocal(snapshot: DirectorSnapshot): boolean {
  const last = snapshot.lastBeatKind
  return last === 'local' || last === 'yield'
}

function emptyDossierDecision(
  snapshot: DirectorSnapshot,
  leftoverIds: Set<number>,
): DirectorDecision {
  const empty: DirectorDecision = {
    ...emptyDirectorBeat(),
    suggestDormantThreadIds: [...leftoverIds],
    backgroundThreadIds: [],
    heavyThreadIds: [],
  }
  if (!isRepeatEmptyLocal(snapshot)) return empty
  return {
    ...empty,
    beatKind: 'yield',
    mustStage: [
      'End the current procedure. Land a named next place or a named result this turn.',
    ],
    mustNot: [
      'Do not restage the same watch / wait / reading / monitoring loop.',
      'Do not start another interval, timer, or baseline pass.',
    ],
    guidanceLines: [
      'No active foreground arc. The last beat was already local. Change the board.',
    ],
  }
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const key = line.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out
}

// ── Internals ───────────────────────────────────────────────────────────────

function mentionsAny(
  t: RankableThread,
  namesLower: string[],
): boolean {
  const hay = `${t.title} ${t.summary ?? ''} ${t.stakes ?? ''} ${t.hidden ?? ''}`.toLowerCase()
  return nameTokens(namesLower).some((n) => n.length >= 3 && hay.includes(n))
}

function nameTokens(names: string[]): string[] {
  const out: string[] = []
  for (const n of names) {
    const trimmed = n.trim().toLowerCase()
    if (!trimmed) continue
    out.push(trimmed)
    for (const part of trimmed.split(/\s+/)) {
      if (part.length >= 3) out.push(part)
    }
  }
  return out
}

function namedPresent(
  playerText: string,
  present: DirectorCastCandidate[],
): DirectorCastCandidate[] {
  const text = playerText.toLowerCase()
  if (!text.trim()) return []
  const hits: DirectorCastCandidate[] = []
  for (const c of present) {
    if (c.isPlayer) continue
    for (const part of c.name.toLowerCase().split(/\s+/)) {
      if (part.length < 3) continue
      if (new RegExp(`\\b${escapeRegExp(part)}\\b`, 'i').test(text)) {
        hits.push(c)
        break
      }
    }
  }
  return hits
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

function isPlayerEngagedWithThread(
  snapshot: DirectorSnapshot,
  thread: RankableThread,
): boolean {
  if (playerEngages(snapshot.playerText, thread, snapshot.objectives)) return true
  if (playerNamesPresent(snapshot.playerText, snapshot.presentCast ?? [])) return true
  if (
    snapshot.lastForegroundThreadId === thread.id &&
    snapshot.lastBeatKind != null &&
    STAGING_BEATS.has(snapshot.lastBeatKind) &&
    !isIdleMove(snapshot.playerText)
  ) {
    return true
  }
  return false
}

function playerNamesPresent(
  playerText: string,
  present: DirectorCastCandidate[],
): boolean {
  const text = playerText.toLowerCase()
  if (!text.trim()) return false
  for (const c of present) {
    if (c.isPlayer) continue
    for (const part of c.name.toLowerCase().split(/\s+/)) {
      if (part.length < 3) continue
      if (new RegExp(`\\b${escapeRegExp(part)}\\b`, 'i').test(text)) return true
    }
  }
  return false
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

const DIRECTOR_REACT_CAP = 2

function namesToCast(names: string[] | undefined): DirectorCastCandidate[] {
  return (names ?? []).map((name, i) => ({ id: -1 - i, name }))
}

function assignCast(args: {
  present: DirectorCastCandidate[]
  enRoute: DirectorCastCandidate[]
  foreground: RankableThread | null
  playerText?: string
}): DirectorCastSlot[] {
  const npcs = args.present.filter((c) => !c.isPlayer && c.name.trim())
  const addressedIds = new Set(
    namedPresent(args.playerText ?? '', args.present).map((c) => c.id),
  )
  const mentioned = (name: string): boolean =>
    Boolean(args.foreground && mentionsAny(args.foreground, [name.toLowerCase()]))

  const scored = [...npcs].sort((a, b) => {
    const aAddr = addressedIds.has(a.id) ? 1 : 0
    const bAddr = addressedIds.has(b.id) ? 1 : 0
    if (aAddr !== bAddr) return bAddr - aAddr
    const aHit = mentioned(a.name) ? 1 : 0
    const bHit = mentioned(b.name) ? 1 : 0
    return bHit - aHit || a.id - b.id
  })

  const slots: DirectorCastSlot[] = []
  let reactCount = 0
  for (const c of scored) {
    const addressed = addressedIds.has(c.id)
    let role: DirectorCastSlot['role'] = 'background'
    if (slots.every((s) => s.role !== 'initiate')) role = 'initiate'
    else if (addressed || reactCount < DIRECTOR_REACT_CAP) {
      role = 'react'
      if (!addressed) reactCount += 1
    }
    slots.push({ characterId: c.id, name: c.name, role })
  }

  const presentIds = new Set(npcs.map((c) => c.id))
  for (const c of args.enRoute) {
    if (presentIds.has(c.id) || !c.name.trim()) continue
    if (args.foreground && mentioned(c.name)) {
      slots.push({ characterId: c.id, name: c.name, role: 'arrive' })
    }
  }
  return slots
}

function deriveBeatKind(args: {
  foreground: RankableThread | null
  phase: DirectorPhase | null
  engaged: boolean
  stallTurns: number
  playerText: string
  cast: DirectorCastSlot[]
  hasObjectives: boolean
  closing: boolean
  wakeAdvance?: boolean
  collapsingThisTurn?: boolean
  stayUnder?: boolean
}): DirectorBeatKind | null {
  if (args.wakeAdvance || args.stayUnder) return 'yield'
  if (!args.foreground && !args.hasObjectives) return null
  if (args.cast.some((c) => c.role === 'arrive')) return 'arrival'
  if (isPlayerYieldingFloor(args.playerText)) return 'yield'
  if (args.closing || args.phase === 'resolution') return 'close'
  if (args.stallTurns >= DIRECTOR_STALL_TURNS && !args.engaged) return 'stall_escalate'
  if (isIdleMove(args.playerText) && !args.engaged) return 'yield'
  if (isRevealMove(args.playerText)) return 'reveal'
  if (!args.foreground || args.phase === 'setup') return 'local'
  return 'pressure'
}

function isIdleMove(text: string): boolean {
  if (isPlayerYieldingFloor(text)) return true
  return /\b(wait|look around|stare|sit|drink|idle|do nothing|stay|linger)\b/i.test(
    text,
  )
}

function isRevealMove(text: string): boolean {
  return /\b(examine|search|inspect|read|ask about|look at|study|who is|what is)\b/i.test(
    text,
  )
}

function isRepeatForegroundPressure(args: {
  foreground: RankableThread | null
  beatKind: DirectorBeatKind | null
  lastBeatKind: DirectorBeatKind | null
  lastForegroundThreadId: number | null
}): boolean {
  if (!args.foreground) return false
  if (args.lastForegroundThreadId !== args.foreground.id) return false
  if (args.lastBeatKind !== 'pressure' && args.lastBeatKind !== 'yield') return false
  return args.beatKind === 'pressure' || args.beatKind === 'yield'
}

function buildMustStage(args: {
  foreground: RankableThread | null
  beatKind: DirectorBeatKind | null
  cast: DirectorCastSlot[]
  closing: boolean
  stallTurns: number
  engaged: boolean
  lastBeatKind: DirectorBeatKind | null
  lastForegroundThreadId: number | null
  stallStreak: number
  wakeAdvance: boolean
  collapsingThisTurn: boolean
  stayUnder: boolean
  playerText: string
}): string[] {
  const lines: string[] = []
  if (args.wakeAdvance) {
    lines.push(
      'The protagonist cannot act. Advance time until they can. Do not wait for their choice.',
    )
    lines.push(
      'Others act. Land one changed board: a named place, a named result, a logged incident, or new presence. Open on the first moment they can act again.',
    )
    return lines
  }
  if (args.stayUnder) {
    lines.push(
      'The protagonist still cannot act. Advance time. Do not wait for their choice and do not restore agency this turn.',
    )
    lines.push(
      'Others act. Land one changed board: a named place, a named result, a logged incident, or new presence.',
    )
    return lines
  }
  if (args.foreground && args.beatKind) {
    if (
      isRepeatForegroundPressure({
        foreground: args.foreground,
        beatKind: args.beatKind,
        lastBeatKind: args.lastBeatKind,
        lastForegroundThreadId: args.lastForegroundThreadId,
      })
    ) {
      lines.push(
        `Advance "${args.foreground.title}" with a new consequence — a finding, named next place, new person, or information that was not on the last turn. Do not restage the same bodily event or procedure.`,
      )
    } else {
      lines.push(
        `Stage a concrete beat of "${args.foreground.title}" (${args.beatKind}).`,
      )
    }
  } else if (args.beatKind === 'local') {
    lines.push('Stage local scene pressure only — no new major arc.')
  }
  if (isPlayerYieldingFloor(args.playerText)) {
    lines.push(
      'The protagonist yielded the floor. Write through the current procedure or exchange this turn — complete remaining checks, deliver the finding, finish the conversation beat.',
    )
    lines.push(
      'Land one changed board: a named result, a named next place, a logged incident, or new presence. Do not stop mid-check or mid-exchange waiting for another continue. Do not end on a question whose only useful answer is continue.',
    )
  }
  const initiator = args.cast.find((c) => c.role === 'initiate')
  if (initiator) {
    lines.push(
      `${initiator.name} initiates — they act first; do not wait for the protagonist to prompt them.`,
    )
  }
  if (args.collapsingThisTurn) {
    lines.push(
      'After they cannot act, others may start to move. Do not ask the protagonist a question or a choice.',
    )
  }
  if (args.closing) {
    lines.push('Prefer closing listed work over opening a new complication.')
  }
  if (args.beatKind === 'stall_escalate' && isRepeatStall(args)) {
    lines.push(
      'Change the board this turn: a named result, a named next place, or off-stage pressure arriving. Do not restage the same watch / wait / reading loop.',
    )
  } else if (args.stallTurns >= DIRECTOR_STALL_TURNS && !args.engaged) {
    lines.push(
      'Escalate time, NPC initiative, or environmental cost without railroading.',
    )
  }
  return lines
}

function isRepeatStall(args: {
  lastBeatKind: DirectorBeatKind | null
  stallStreak: number
}): boolean {
  return args.lastBeatKind === 'stall_escalate' || args.stallStreak >= DIRECTOR_STALL_REPEAT_BOARD
}

function buildMustNot(args: {
  beatKind: DirectorBeatKind | null
  phase: DirectorPhase | null
  settledTitles: string[]
  repeatPressure: boolean
}): string[] {
  const lines: string[] = []
  if (
    args.beatKind === 'close' ||
    args.beatKind === 'stall_escalate' ||
    args.phase === 'climax' ||
    args.phase === 'resolution'
  ) {
    lines.push('Do not open a new major arc this turn.')
  }
  if (args.beatKind === 'close') {
    lines.push('Do not revive recently closed work as a new quest.')
  }
  if (args.repeatPressure) {
    lines.push(
      'Do not re-describe an unchanged symptom, monitor reading, or room from the last turn.',
    )
  }
  if (args.settledTitles.length > 0) {
    lines.push(
      `Do not reverse settled findings: ${args.settledTitles.join('; ')}.`,
    )
  }
  return lines
}

/** Serialize the binding BeatBrief for turn metadata (`director` key). */
export function directorBeatToMetadata(
  d: DirectorDecision,
): Record<string, unknown> {
  return {
    beatKind: d.beatKind,
    foregroundThreadId: d.foregroundThreadId,
    phase: d.phase,
    tension: d.tension,
    mustStage: d.mustStage,
    mustNot: d.mustNot,
    cast: d.cast,
    suggestResolveThreadIds: d.suggestResolveThreadIds,
    suggestCompleteObjectiveIds: d.suggestCompleteObjectiveIds,
    suggestDormantThreadIds: d.suggestDormantThreadIds,
  }
}

/** Re-export ranking helper for Director-shaped tests. */
export { rankObjectives, rankThreads }

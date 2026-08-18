// Pure dossier ranking (narrator-controls-story-continuity PR D / R8).
// formatDossierBlock hard-slices to N quests/threads/objectives — taken off the
// front unordered, so stale never-completing objectives permanently occupy the
// window and push newer goals out of STATE. Rank before slice: deadline
// proximity (when structured data exists), then stakes, then recency.
//
// No I/O. No schema change in v1 for deadline fields — proximity is applied when
// a parseable deadline appears in title/detail/stakes/consequences free text
// (Day N / dusk / etc.), otherwise stakes + recency only. Do not bury silent
// deadline parsing without tests — see rankObjectives tests.

import type {
  StoryClue,
  StoryObjective,
  StoryResource,
  StoryThread,
  TimelineEvent,
} from '@/domain/entities'
import { isSomaticProcedureThread } from '@/domain/services/basic-plots'
import { tryParseWorldTime } from '@/domain/services/narrative-clock'

export const DOSSIER_CAPS = {
  quests: 4,
  threads: 4,
  objectives: 5,
  clues: 6,
  resources: 6,
  timeline: 5,
} as const

export type RankableObjective = Pick<
  StoryObjective,
  'id' | 'title' | 'status' | 'detail' | 'blocker' | 'created_at' | 'updated_at' | 'source_turn_id'
>

export type RankableThread = Pick<
  StoryThread,
  | 'id'
  | 'title'
  | 'kind'
  | 'status'
  | 'summary'
  | 'stakes'
  | 'consequences'
  | 'hidden'
  | 'created_at'
  | 'updated_at'
  | 'source_turn_id'
>

export type RankingContext = {
  /** Current internal clock minutes (null = ignore deadline proximity). */
  clockMinutes: number | null
}

function recencyKey(row: { updated_at?: string; created_at?: string; source_turn_id?: number | null }): number {
  // Prefer source_turn_id when present (monotonic); else updated_at/created_at string.
  if (row.source_turn_id != null && Number.isFinite(row.source_turn_id)) {
    return row.source_turn_id
  }
  const t = row.updated_at || row.created_at || ''
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : 0
}

function stakesScore(text: string | null | undefined): number {
  if (!text) return 0
  const t = text.toLowerCase()
  let score = Math.min(40, t.length / 4)
  if (/\b(death|kill|die|dead|massacre|blood|execute)\b/.test(t)) score += 30
  if (/\b(deadline|before|by dusk|by dawn|by night|day\s+\d+)\b/.test(t)) score += 25
  if (/\b(threat|danger|pursue|hunt|arrest|exile|war)\b/.test(t)) score += 20
  if (/\b(must|urgent|immediately|critical)\b/.test(t)) score += 15
  return score
}

/**
 * Extract a deadline minute estimate from free-text fields when present.
 * Returns null when no structured/parseable deadline is found (v1 limitation).
 */
export function extractDeadlineMinutes(
  ...fields: Array<string | null | undefined>
): number | null {
  for (const field of fields) {
    if (!field) continue
    // Prefer an explicit "Day N" (+ optional band) phrase.
    const dayPhrase = field.match(/\bday\s+(\d+)(?:[^.]{0,40}?\b(morning|midday|afternoon|evening|dusk|dawn|night)\b)?/i)
    if (dayPhrase) {
      const day = parseInt(dayPhrase[1]!, 10)
      const band = (dayPhrase[2] || 'evening').toLowerCase()
      const bandHour =
        band === 'morning' || band === 'dawn'
          ? 8
          : band === 'midday' || band === 'afternoon'
            ? 13
            : band === 'night'
              ? 23
              : 19 // evening / dusk
      return (Math.max(1, day) - 1) * 1440 + bandHour * 60
    }
    const parsed = tryParseWorldTime(field)
    if (parsed.ok && /\bday\s+\d+/i.test(field)) return parsed.minutes
  }
  return null
}

function deadlineProximityScore(
  deadlineMinutes: number | null,
  clockMinutes: number | null,
): number {
  if (deadlineMinutes == null || clockMinutes == null) return 0
  const delta = deadlineMinutes - clockMinutes
  // Past deadline: still high pressure (failure pressure).
  if (delta <= 0) return 100
  // Closer deadlines rank higher. Within 1 day → very high; within 3 days → high.
  if (delta <= 1440) return 90
  if (delta <= 3 * 1440) return 70
  if (delta <= 7 * 1440) return 40
  return 15
}

function objectiveScore(o: RankableObjective, ctx: RankingContext): number {
  const deadline = extractDeadlineMinutes(o.title, o.detail, o.blocker)
  const proximity = deadlineProximityScore(deadline, ctx.clockMinutes)
  const stakes = stakesScore([o.title, o.detail, o.blocker].filter(Boolean).join(' '))
  const recency = recencyKey(o) / 1e6 // keep secondary
  const blockedBoost = o.status === 'blocked' ? 5 : 0
  return proximity * 10 + stakes + blockedBoost + recency
}

function threadScore(t: RankableThread, ctx: RankingContext): number {
  const deadline = extractDeadlineMinutes(t.title, t.summary, t.stakes, t.consequences, t.hidden)
  const proximity = deadlineProximityScore(deadline, ctx.clockMinutes)
  const stakes = stakesScore([t.stakes, t.consequences, t.summary, t.hidden].filter(Boolean).join(' '))
  const kindBoost =
    t.kind === 'quest' ? 25 : t.kind === 'threat' ? 30 : t.kind === 'mystery' ? 10 : 0
  const recency = recencyKey(t) / 1e6
  // A repeating medical/procedure "threat" must not outrank a real mystery/quest.
  const somaticPenalty = isSomaticProcedureThread(t) ? 80 : 0
  return proximity * 10 + stakes + kindBoost + recency - somaticPenalty
}

export function rankObjectives<T extends RankableObjective>(
  objectives: T[],
  ctx: RankingContext,
  limit: number = DOSSIER_CAPS.objectives,
): T[] {
  return [...objectives]
    .sort((a, b) => objectiveScore(b, ctx) - objectiveScore(a, ctx))
    .slice(0, limit)
}

export function rankThreads<T extends RankableThread>(
  threads: T[],
  ctx: RankingContext,
  limit: number = DOSSIER_CAPS.threads,
): T[] {
  return [...threads]
    .sort((a, b) => threadScore(b, ctx) - threadScore(a, ctx))
    .slice(0, limit)
}

export function rankQuests<T extends RankableThread>(
  quests: T[],
  ctx: RankingContext,
  limit: number = DOSSIER_CAPS.quests,
): T[] {
  return rankThreads(quests, ctx, limit)
}

export function rankClues<T extends StoryClue>(clues: T[], limit: number = DOSSIER_CAPS.clues): T[] {
  return [...clues]
    .sort((a, b) => recencyKey(b) - recencyKey(a))
    .slice(0, limit)
}

export function rankResources<T extends StoryResource>(
  resources: T[],
  limit: number = DOSSIER_CAPS.resources,
): T[] {
  // Salient first, then recency.
  return [...resources]
    .sort((a, b) => {
      if (a.salient !== b.salient) return (b.salient ?? 0) - (a.salient ?? 0)
      return recencyKey(b) - recencyKey(a)
    })
    .slice(0, limit)
}

export function rankTimeline<T extends TimelineEvent>(
  events: T[],
  limit: number = DOSSIER_CAPS.timeline,
): T[] {
  return [...events]
    .filter((e) => e.importance >= 3)
    .sort((a, b) => {
      if (a.importance !== b.importance) return b.importance - a.importance
      return recencyKey(b) - recencyKey(a)
    })
    .slice(0, limit)
}

/**
 * Pick the single highest-pressure active quest/objective for the PRIMARY
 * PRESSURE pin. Prefer quests with deadline/stakes language; fall back to
 * highest-ranked objective.
 */
export function pickPrimaryPressure(
  threads: RankableThread[],
  objectives: RankableObjective[],
  ctx: RankingContext,
): { title: string; detail: string | null; kind: 'quest' | 'objective' } | null {
  const activeQuests = threads.filter((t) => t.status === 'active' && t.kind === 'quest')
  const rankedQuests = rankQuests(activeQuests, ctx, 1)
  if (rankedQuests[0]) {
    const q = rankedQuests[0]
    const detail = [q.stakes, q.summary, q.consequences].filter(Boolean).join(' — ') || null
    return { title: q.title, detail, kind: 'quest' }
  }
  const activeObjectives = objectives.filter(
    (o) => o.status === 'active' || o.status === 'blocked',
  )
  const rankedObj = rankObjectives(activeObjectives, ctx, 1)
  if (rankedObj[0]) {
    const o = rankedObj[0]
    return {
      title: o.title,
      detail: o.detail,
      kind: 'objective',
    }
  }
  // Threat as last resort primary pressure.
  const threats = threads.filter((t) => t.status === 'active' && t.kind === 'threat')
  const rankedThreat = rankThreads(threats, ctx, 1)
  if (rankedThreat[0]) {
    const t = rankedThreat[0]
    return {
      title: t.title,
      detail: [t.stakes, t.summary].filter(Boolean).join(' — ') || null,
      kind: 'quest',
    }
  }
  return null
}

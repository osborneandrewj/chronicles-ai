import { bandForHour, type WorldTimeBand, worldTimeBand } from './world-clock'

// Narrative clock (starship P6 + open-world continuity). Time is tracked as
// minutes since a Day-1 00:00 baseline for ANY world. Bounded worlds use the
// counter for ship simulation; open/subworlds use it for narrative deadlines.
// Pure + deterministic — no I/O, no wall-clock.
//
// Design (narrator-controls-story-continuity PR C): the pure estimator is the
// PRIMARY per-turn writer. The LLM time-passage estimator is consulted only when
// the narration contains explicit jump language; merge is max(det, llm), never sum.

const MINUTES_PER_DAY = 1440
const MINUTES_PER_HOUR = 60

// ── Render / parse ──────────────────────────────────────────────────────────

// A natural time-of-day phrase per hour. CRITICAL: every phrase must round-trip
// through worldTimeBand() back to the SAME band the hour belongs to. We guarantee
// this two ways: the phrase carries the band word (the keyword branch), and
// minutesToWorldTime appends a '~HH:MM' clock token (the clock branch, which
// worldTimeBand trusts first). Bands: morning 5–11, midday 11–17, evening 17–21,
// night 21–5.
function hourPhrase(hour: number): string {
  if (hour < 5) return 'late night'
  if (hour < 7) return 'early morning'
  if (hour < 11) return 'morning'
  if (hour < 14) return 'midday'
  if (hour < 17) return 'afternoon'
  if (hour < 19) return 'early evening'
  if (hour < 21) return 'evening'
  if (hour < 23) return 'night'
  return 'late night'
}

export type MinutesToWorldTimeOptions = {
  /**
   * When true (default for bounded worlds), append ` (~HH:MM)` so the phrase
   * round-trips precisely. Open/subworlds omit the clock token — a sci-fi HUD
   * token reads wrong in Classical Greece — and accept a slightly lossier
   * keyword round-trip via worldTimeBand.
   */
  includeClockToken?: boolean
}

// Minutes since the Day-1 00:00 baseline → a narrative render + the WorldTimeBand.
export function minutesToWorldTime(
  minutes: number,
  options: MinutesToWorldTimeOptions = {},
): {
  worldTime: string
  band: WorldTimeBand
} {
  const includeClockToken = options.includeClockToken !== false
  const safe = Math.max(0, Math.floor(minutes))
  const day = Math.floor(safe / MINUTES_PER_DAY) + 1
  const minuteOfDay = safe % MINUTES_PER_DAY
  const hour = Math.floor(minuteOfDay / MINUTES_PER_HOUR)
  const minute = minuteOfDay % MINUTES_PER_HOUR
  const phrase = hourPhrase(hour)
  const worldTime = includeClockToken
    ? `Day ${day} — ${phrase} (~${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')})`
    : `Day ${day} — ${phrase}`
  return {
    worldTime,
    band: bandForHour(hour),
  }
}

export type ParseWorldTimeResult =
  | { ok: true; minutes: number }
  | { ok: false; reason: 'empty' | 'unparseable' }

/**
 * Strict parser for backfill. Reports unparseable rather than silently defaulting
 * to Day 1 / 12:00 — a free-text archivist time like "just after the market opens"
 * must not reset the clock backwards.
 *
 * Accepts:
 * - `Day N` + optional `~HH:MM` / `HH:MM` clock token
 * - band keywords (morning/midday/evening/night) with or without Day N
 * - Rejects empty and fully free-text strings with no day and no band keyword
 *   that worldTimeBand would invent as midday without evidence.
 */
export function tryParseWorldTime(worldTime: string | null | undefined): ParseWorldTimeResult {
  if (worldTime == null || !worldTime.trim()) return { ok: false, reason: 'empty' }
  const text = worldTime.trim()
  const lower = text.toLowerCase()

  const dayMatch = lower.match(/\bday\s+(\d+)/i)
  const hasDay = Boolean(dayMatch)
  const day = dayMatch ? Math.max(1, parseInt(dayMatch[1]!, 10)) : 1

  const clock = lower.match(/~?\s*(\d{1,2}):(\d{2})/)
  if (clock) {
    let hour = parseInt(clock[1]!, 10)
    let minute = parseInt(clock[2]!, 10)
    if (Number.isNaN(hour) || hour < 0 || hour > 23) hour = 12
    if (Number.isNaN(minute) || minute < 0 || minute > 59) minute = 0
    return { ok: true, minutes: (day - 1) * MINUTES_PER_DAY + hour * MINUTES_PER_HOUR + minute }
  }

  const hasBandKeyword =
    /\b(dawn|sunrise|morning|early|noon|midday|lunch|afternoon|dusk|sunset|evening|twilight|night|midnight|late)\b/.test(
      lower,
    )

  // Require either a Day N token or a band keyword — otherwise unparseable.
  if (!hasDay && !hasBandKeyword) {
    return { ok: false, reason: 'unparseable' }
  }

  const hour = bandAnchorHour(worldTimeBand(text))
  return { ok: true, minutes: (day - 1) * MINUTES_PER_DAY + hour * MINUTES_PER_HOUR }
}

// Best-effort parse used by legacy callers. Defaults to Day 1 midday when empty
// or unparseable — prefer tryParseWorldTime + clamp for open-world backfill.
export function worldTimeToMinutes(worldTime: string | null): number {
  const parsed = tryParseWorldTime(worldTime)
  if (parsed.ok) return parsed.minutes
  return 12 * MINUTES_PER_HOUR
}

/**
 * Resolve the internal minute counter for a turn advance.
 * - Prefer the stored counter when present.
 * - Else backfill from world_time via tryParseWorldTime.
 * - Unparseable / empty: hold at `fallbackMinutes` (usually 0 or prior) rather
 *   than resetting to Day 1 midday.
 * - Clamp so the resolved value never decreases relative to the stored counter
 *   when both exist (stored always wins if non-null).
 */
export function resolveClockMinutes(input: {
  storedMinutes: number | null | undefined
  worldTime: string | null | undefined
  /** Floor when stored is null and world_time is unparseable. Default 0. */
  holdMinutes?: number
}): number {
  if (input.storedMinutes != null && Number.isFinite(input.storedMinutes)) {
    return Math.max(0, Math.floor(input.storedMinutes))
  }
  const parsed = tryParseWorldTime(input.worldTime ?? null)
  if (parsed.ok) return parsed.minutes
  return Math.max(0, Math.floor(input.holdMinutes ?? 0))
}

function bandAnchorHour(band: WorldTimeBand): number {
  switch (band) {
    case 'morning':
      return 8
    case 'midday':
      return 13
    case 'evening':
      return 19
    case 'night':
      return 23
  }
}

// ── Deterministic per-turn estimate (primary writer) ────────────────────────

export type TurnTimeEstimateInput = {
  stance: string
  /** Scene opened/changed this turn (classifier or transition result). */
  sceneChanged: boolean
  /** Player or narrator clearly travelled / relocated. */
  travelled: boolean
  /** Narrator prose length (chars) — longer beats push toward the top of a band. */
  narrationLength: number
}

/**
 * Pure per-turn minute estimate. Rough bands:
 * - idle / observation: 2–5
 * - dialogue / interaction: 10–20
 * - travel or scene change: 30–90
 */
export function estimateTurnMinutes(input: TurnTimeEstimateInput): number {
  const len = Math.max(0, input.narrationLength)
  const long = len > 1200
  const short = len < 200

  if (input.sceneChanged || input.travelled) {
    if (long) return 90
    if (short) return 30
    return 55
  }

  const stance = (input.stance || '').toLowerCase()
  if (stance === 'observe' || stance === 'meta') {
    return short ? 2 : long ? 5 : 3
  }
  if (stance === 'say' || stance === 'interact' || stance === 'act') {
    return short ? 10 : long ? 20 : 15
  }
  // Default middle band (unclassified action).
  return short ? 8 : long ? 25 : 12
}

/**
 * Cheap pure predicate: does the narration contain explicit time-jump language
 * that should gate an LLM time-passage call?
 */
export function hasExplicitTimeJump(narration: string): boolean {
  const text = narration.toLowerCase()
  return (
    /\b(later|afterwards|afterward)\b/.test(text) ||
    /\b(the\s+next\s+morning|next\s+morning|the\s+following\s+morning)\b/.test(text) ||
    /\b(hours?\s+pass(?:es|ed)?|hours?\s+later|an\s+hour\s+later|a\s+while\s+(?:passes|later))\b/.test(
      text,
    ) ||
    /\b(by\s+nightfall|by\s+dusk|by\s+dawn|by\s+sunrise|by\s+sunset)\b/.test(text) ||
    /\b(three\s+days|two\s+days|several\s+days|a\s+day\s+later|the\s+next\s+day)\b/.test(text) ||
    /\b(that\s+night|the\s+next\s+night|overnight)\b/.test(text) ||
    /\b(weeks?\s+later|months?\s+later)\b/.test(text) ||
    /\b(time\s+passes|time\s+passed|as\s+the\s+(?:hours|days)\s+(?:pass|passed))\b/.test(text)
  )
}

/** Merge rule: max(deterministic, llm), never sum. */
export function mergeElapsedMinutes(deterministic: number, llm: number | null | undefined): number {
  const d = Math.max(0, Math.floor(deterministic))
  if (llm == null || !Number.isFinite(llm)) return d
  return Math.max(d, Math.max(0, Math.floor(llm)))
}

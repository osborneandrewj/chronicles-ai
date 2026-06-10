import { bandForHour, type WorldTimeBand, worldTimeBand } from './world-clock'

// The prose-driven ship-clock (starship P6). Time for a bounded world is tracked
// as minutes since a Day-1 00:00 baseline. A small step estimates how much
// in-world time the latest narration covered and advances the counter by that;
// these pure functions turn the counter into a NARRATIVE render (a time-of-day
// phrase, not a minute readout) and back. No I/O, no wall-clock — deterministic.

const MINUTES_PER_DAY = 1440
const MINUTES_PER_HOUR = 60

// A natural time-of-day phrase per hour. CRITICAL: every phrase must round-trip
// through worldTimeBand() back to the SAME band the hour belongs to. We guarantee
// this two ways: the phrase carries the band word (the keyword branch), and
// minutesToShipTime appends a '~HH:MM' clock token (the clock branch, which
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

// Minutes since the Day-1 00:00 baseline → a narrative render + the WorldTimeBand
// (for routines). day rolls over every 1440 minutes; the '~HH:MM' suffix makes the
// phrase parse back to the same band via worldTimeBand's clock branch.
export function minutesToShipTime(minutes: number): {
  worldTime: string
  band: WorldTimeBand
} {
  const safe = Math.max(0, Math.floor(minutes))
  const day = Math.floor(safe / MINUTES_PER_DAY) + 1
  const minuteOfDay = safe % MINUTES_PER_DAY
  const hour = Math.floor(minuteOfDay / MINUTES_PER_HOUR)
  const minute = minuteOfDay % MINUTES_PER_HOUR
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  return {
    worldTime: `Day ${day} — ${hourPhrase(hour)} (~${clock})`,
    band: bandForHour(hour),
  }
}

// Parse a 'Day N — phrase (~HH:MM)' string back to minutes since the baseline for
// init/backfill. Best-effort: reads the day and the '~HH:MM' clock token (falling
// back to worldTimeBand's keyword reading when no clock is present); defaults to
// Day 1, midday (12:00) when nothing parses.
export function shipTimeToMinutes(worldTime: string | null): number {
  if (!worldTime) return 12 * MINUTES_PER_HOUR

  const dayMatch = worldTime.match(/\bday\s+(\d+)/i)
  const day = dayMatch ? Math.max(1, parseInt(dayMatch[1]!, 10)) : 1

  const clock = worldTime.match(/~?\s*(\d{1,2}):(\d{2})/)
  let hour: number
  let minute: number
  if (clock) {
    hour = parseInt(clock[1]!, 10)
    minute = parseInt(clock[2]!, 10)
    if (Number.isNaN(hour) || hour < 0 || hour > 23) hour = 12
    if (Number.isNaN(minute) || minute < 0 || minute > 59) minute = 0
  } else {
    // No clock token — anchor to a representative hour for the parsed band.
    hour = bandAnchorHour(worldTimeBand(worldTime))
    minute = 0
  }

  return (day - 1) * MINUTES_PER_DAY + hour * MINUTES_PER_HOUR + minute
}

// A representative hour for each band, used only when shipTimeToMinutes gets a
// phrase with no clock token (so the band survives the round-trip).
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

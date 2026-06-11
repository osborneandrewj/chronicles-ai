import type { WorldTimeBand } from '@/domain/services/world-clock'

// Pure tick → world-clock mapping for the bounded-world pre-sim (P2). A tick is
// one WorldTimeBand, so the four bands cycle in order and the in-world day rolls
// over every four ticks. No I/O, no wall-clock — deterministic.

const BANDS: readonly WorldTimeBand[] = ['morning', 'midday', 'evening', 'night']
const TICKS_PER_DAY = BANDS.length

// tick 0 = morning of day 1; the band cycles morning→midday→evening→night.
export function tickToBand(tick: number): WorldTimeBand {
  const index = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY
  return BANDS[index]!
}

// A readable world_time label, e.g. 'Day 1 — morning'. The day advances every
// four ticks; startDay offsets the first day (defaults to 1).
export function tickToWorldTime(tick: number, startDay = 1): string {
  const day = startDay + Math.floor(tick / TICKS_PER_DAY)
  return `Day ${day} — ${tickToBand(tick)}`
}

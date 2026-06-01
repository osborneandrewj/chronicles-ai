import { z } from 'zod'

import type { WorldTimeBand } from '@/lib/world-time'

export type LoopBand = { activity: string; place?: string | null }
export type DailyLoop = Partial<Record<WorldTimeBand, LoopBand>>

const LoopBandSchema = z.object({
  activity: z.string(),
  place: z.string().nullable().optional(),
})

export const DailyLoopSchema = z
  .object({
    morning: LoopBandSchema.optional(),
    midday: LoopBandSchema.optional(),
    evening: LoopBandSchema.optional(),
    night: LoopBandSchema.optional(),
  })
  .describe(
    'A time-banded daily routine for this NPC. Each band names one short activity and (optionally) ' +
      'the place it happens in. Author once, then leave unchanged.',
  )

export function parseDailyLoop(json: string | null): DailyLoop | null {
  if (!json) return null
  try {
    const parsed = DailyLoopSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function activityForBand(loop: DailyLoop | null, band: WorldTimeBand): LoopBand | null {
  if (!loop) return null
  return loop[band] ?? null
}

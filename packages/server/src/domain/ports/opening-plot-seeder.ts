// OpeningPlotSeeder — 2–3 starting story_threads at world birth.
// Distinct from ThreadBootstrapper (empty-dossier fallback mid-play).
// Pure port: no SDK / SQL.

import type { BasicPlotId } from '@/domain/services/basic-plots'
import type {
  OpeningPlotCrew,
  OpeningPlotDraft,
  OpeningPlotRelationship,
} from '@/domain/services/opening-plots'

export type OpeningPlotSeederInput = {
  premise: string
  worldName?: string | null
  crew: OpeningPlotCrew[]
  relationships?: OpeningPlotRelationship[]
  seed: number
}

export type OpeningPlotSeederResult = {
  threads: OpeningPlotDraft[]
}

export type { BasicPlotId }

export interface OpeningPlotSeeder {
  generate(input: OpeningPlotSeederInput): Promise<OpeningPlotSeederResult>
}

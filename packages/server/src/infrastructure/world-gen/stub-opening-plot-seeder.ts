import 'server-only'

import type {
  OpeningPlotSeeder,
  OpeningPlotSeederInput,
  OpeningPlotSeederResult,
} from '@/domain/ports/opening-plot-seeder'
import { draftOpeningPlots } from '@/domain/services/opening-plots'

/** Deterministic opening threads — no LLM. Same inputs → same drafts. */
export class StubOpeningPlotSeeder implements OpeningPlotSeeder {
  async generate(input: OpeningPlotSeederInput): Promise<OpeningPlotSeederResult> {
    return { threads: draftOpeningPlots(input) }
  }
}

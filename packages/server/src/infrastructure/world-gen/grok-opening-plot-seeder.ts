import 'server-only'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { xai } from '@ai-sdk/xai'
import { generateObject } from 'ai'
import { z } from 'zod'

import type {
  OpeningPlotSeeder,
  OpeningPlotSeederInput,
  OpeningPlotSeederResult,
} from '@/domain/ports/opening-plot-seeder'
import { BASIC_PLOTS, type BasicPlotId } from '@/domain/services/basic-plots'
import { draftOpeningPlots } from '@/domain/services/opening-plots'
import { withObjectRetry } from '@/infrastructure/llm/generate-object'
import { NARRATOR_MODEL } from '@/infrastructure/llm/model-registry'

const PLOT_IDS = BASIC_PLOTS.map((p) => p.id) as [BasicPlotId, ...BasicPlotId[]]

const OpeningPlotsSchema = z.object({
  threads: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        kind: z.enum(['quest', 'mystery', 'threat', 'relationship']),
        summary: z.string().min(1).max(400),
        stakes: z.string().min(1).max(400),
        relevance_tags: z.array(z.string().min(1).max(40)).min(2).max(5),
        plot_shape: z.enum(PLOT_IDS),
      }),
    )
    .min(2)
    .max(3),
})

function loadPrompt(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const file = path.resolve(moduleDir, '../../../prompts', 'opening-plots.md')
  return readFileSync(file, 'utf8').trim()
}

export class GrokOpeningPlotSeeder implements OpeningPlotSeeder {
  async generate(input: OpeningPlotSeederInput): Promise<OpeningPlotSeederResult> {
    try {
      const crewLines = input.crew
        .map((c) => `- ${c.name} (${c.role})${c.goal ? ` — wants ${c.goal}` : ''}`)
        .join('\n')
      const relLines = (input.relationships ?? [])
        .map((r) => `- ${r.fromRole} → ${r.toRole}: ${r.kind} (valence ${r.valence})`)
        .join('\n')
      const { object } = await withObjectRetry(() =>
        generateObject({
          model: xai(NARRATOR_MODEL),
          schema: OpeningPlotsSchema,
          system: loadPrompt(),
          prompt: [
            `PREMISE: ${input.premise}`,
            input.worldName ? `PLACE NAME: ${input.worldName}` : '',
            '',
            'ENSEMBLE:',
            crewLines || '(none listed)',
            '',
            'TENSION EDGES:',
            relLines || '(none listed)',
            '',
            'Name 2–3 opening threads now. Distinct plot_shape values.',
          ]
            .filter(Boolean)
            .join('\n'),
        }),
      )
      return {
        threads: object.threads.map((t) => ({
          title: t.title,
          kind: t.kind,
          summary: t.summary,
          stakes: t.stakes,
          relevanceTags: t.relevance_tags,
          plotShape: t.plot_shape,
        })),
      }
    } catch (err) {
      console.error('[opening plots grok failed; using drafts]', err)
      return { threads: draftOpeningPlots(input) }
    }
  }
}

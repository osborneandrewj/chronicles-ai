import 'server-only'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { xai } from '@ai-sdk/xai'
import { generateObject } from 'ai'
import { z } from 'zod'

import type { MetaStoryBible } from '@/domain/entities'
import type { MetaStoryGenerator, MetaStoryGeneratorInput } from '@/domain/ports'
import { withObjectRetry } from '@/infrastructure/llm/generate-object'
import { NARRATOR_MODEL } from '@/infrastructure/llm/model-registry'

// Grok MetaStoryGenerator (Phase C, C8). A strong techno-thriller "architect"
// pass produces the hub's durable bible at creation. The judge/coherence punch-up
// passes are a follow-up; this single high-tier call already yields a coherent,
// pinnable bible, validated by Zod. The system prompt is loaded at runtime from
// prompts/meta-story.md so it stays git-diffable.

const ActSchema = z.object({
  title: z.string(),
  summary: z.string(),
  lucidityThreshold: z.number().int().min(0).max(10),
})

const BibleSchema = z.object({
  arcEngineId: z.string(),
  question: z.string(),
  institution: z.string(),
  hiddenTruth: z.string(),
  antagonist: z.string(),
  allies: z.string(),
  acts: z.array(ActSchema).min(3),
  bleedMotifs: z.array(z.string()).min(1),
  endgameFork: z.array(z.string()).min(2),
})

function loadPrompt(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const file = path.resolve(moduleDir, '../../../prompts', 'meta-story.md')
  return readFileSync(file, 'utf8').trim()
}

export class GrokMetaStoryGenerator implements MetaStoryGenerator {
  async generate(input: MetaStoryGeneratorInput): Promise<MetaStoryBible> {
    const system = loadPrompt()
    const user = [
      `HOME BASE: ${input.hubName}`,
      `SURFACE PREMISE: ${input.hubPremise}`,
      `ARC ENGINE id=${input.arcEngine.id} (${input.arcEngine.name}): ${input.arcEngine.premise}`,
      `ARC MOTIFS: ${input.arcEngine.motifs.join('; ')}`,
      `GENRES the player may visit: ${input.genreLabels.join(', ')}`,
    ].join('\n')

    const { object } = await withObjectRetry(() =>
      generateObject({
        model: xai(NARRATOR_MODEL),
        schema: BibleSchema,
        system,
        prompt: user,
      }),
    )

    // Force the arc engine id to the requested one regardless of model drift.
    return { ...object, arcEngineId: input.arcEngine.id }
  }
}

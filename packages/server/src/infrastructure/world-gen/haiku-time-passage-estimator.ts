import 'server-only'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'

import type {
  TimePassageEstimate,
  TimePassageEstimator,
  TimePassageEstimatorInput,
} from '@/domain/ports/time-passage-estimator'
import { withObjectRetry } from '@/infrastructure/llm/generate-object'
import { HAIKU_MODEL } from '@/infrastructure/llm/model-registry'

// HaikuTimePassageEstimator (starship P6) — the live TimePassageEstimator
// adapter and the only LLM seam in the prose-driven ship-clock. A one-shot
// structured Haiku call (mirrors haiku-drama-port.ts) reads the just-written
// narration and estimates how much in-world time it covered. The system prompt
// is loaded at runtime from prompts/time-passage.md so it stays git-diffable; Zod
// bounds the output to whole minutes in 0..2880 (two days). A deterministic
// StubTimePassageEstimator backs tests + the offline scripts with no spend.

// Two in-world days — a generous upper bound for a single "skip ahead to the next
// morning" beat, matching the prompt's cap.
const MAX_ELAPSED_MINUTES = 2880

const TimePassageSchema = z.object({
  elapsedMinutes: z.number().int().min(0).max(MAX_ELAPSED_MINUTES),
})

function loadTimePassagePrompt(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const file = path.resolve(moduleDir, '../../../prompts', 'time-passage.md')
  return readFileSync(file, 'utf8').trim()
}

export class HaikuTimePassageEstimator implements TimePassageEstimator {
  async estimate(input: TimePassageEstimatorInput): Promise<TimePassageEstimate> {
    const { object } = await withObjectRetry(() =>
      generateObject({
        model: anthropic(HAIKU_MODEL),
        schema: TimePassageSchema,
        system: loadTimePassagePrompt(),
        prompt: [
          input.priorWorldTime ? `OPENED AT: ${input.priorWorldTime}` : '',
          '',
          'NARRATION (the beat that just happened):',
          input.narration,
          '',
          'Estimate the in-world minutes this beat covered now.',
        ]
          .filter((line) => line !== '')
          .join('\n'),
      }),
    )

    return { elapsedMinutes: object.elapsedMinutes }
  }
}

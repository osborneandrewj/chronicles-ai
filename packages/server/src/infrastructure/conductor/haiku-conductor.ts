import 'server-only'

import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'

import type {
  ConductorInput,
  ConductorPort,
  ConductorResult,
} from '@/domain/ports/conductor'
import { sanitizeResolvedOutcome } from '@/domain/services/outcome-resolution'
import { withObjectRetry } from '@/infrastructure/llm/generate-object'
import { HAIKU_MODEL } from '@/infrastructure/llm/model-registry'
import { loadPrompt } from '@/lib/prompt-files'

const ConductorSchema = z.object({
  intent: z.string().max(160),
  stance: z.enum(['attempt', 'strong_intent', 'asserted_outcome', 'unclear']),
  inputMode: z.enum([
    'tactical_intent',
    'asserted_outcome',
    'cinematic_framing',
    'emotional_interiority',
    'meta_or_unclear',
  ]),
  outcome: z.enum([
    'failure',
    'partial_success',
    'success',
    'success_with_cost',
    'impossible',
  ]),
  worldStateDelta: z.string().max(240),
})

export class HaikuConductor implements ConductorPort {
  async resolve(input: ConductorInput): Promise<ConductorResult | null> {
    try {
      const { object, usage } = await withObjectRetry(() =>
        generateObject({
          model: anthropic(HAIKU_MODEL),
          schema: ConductorSchema,
          maxRetries: 1,
          system: loadPrompt('conductor-system'),
          messages: [{ role: 'user', content: buildConductorUserContent(input) }],
        }),
      )
      return {
        resolution: sanitizeResolvedOutcome(object, input.playerText),
        model: HAIKU_MODEL,
        usage,
      }
    } catch (err) {
      console.error('[conductor]', err)
      return null
    }
  }
}

export function buildConductorUserContent(input: ConductorInput): string {
  return [
    `CLASSIFIER: stance=${input.stance}, input_mode=${input.inputMode}`,
    '',
    'SCENE:',
    input.sceneDigest.trim() || '(none)',
    '',
    'PLAYER ACTION:',
    input.playerText,
  ].join('\n')
}

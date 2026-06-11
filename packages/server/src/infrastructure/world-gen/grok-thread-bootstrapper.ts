import 'server-only'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { xai } from '@ai-sdk/xai'
import { generateObject } from 'ai'
import { z } from 'zod'

import type {
  ThreadBootstrapInput,
  ThreadBootstrapResult,
  ThreadBootstrapper,
} from '@/domain/ports/thread-bootstrapper'
import { withObjectRetry } from '@/infrastructure/llm/generate-object'
import { NARRATOR_MODEL } from '@/infrastructure/llm/model-registry'

// GrokThreadBootstrapper — the live ThreadBootstrapper adapter. A focused Grok
// structured call (mirrors GrokEnsembleGenerator) whose schema is a REQUIRED
// threads array: a min-1 top-level array is what the model is actually forced to
// populate, vs the optional story_threads array the Haiku archivist silently
// omits inside its big combined patch. Grok already wrote the prose this turn and
// reliably emits structured output (proven in grok-crew-generator.ts). On any
// failure it returns `{ threads: [] }` so the turn never breaks (graceful, like
// the npc-agent skip). The system prompt is loaded at runtime from
// prompts/thread-bootstrap.md so it stays git-diffable.

const ThreadBootstrapSchema = z.object({
  threads: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        kind: z.enum(['quest', 'threat', 'mystery']),
        summary: z.string().min(1).max(400),
        stakes: z.string().max(400).nullable().optional(),
        relevance_tags: z.array(z.string().min(1).max(40)).min(2).max(5),
      }),
    )
    .min(1)
    .max(2),
})

function loadThreadBootstrapPrompt(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const file = path.resolve(moduleDir, '../../../prompts', 'thread-bootstrap.md')
  return readFileSync(file, 'utf8').trim()
}

export class GrokThreadBootstrapper implements ThreadBootstrapper {
  async bootstrap(input: ThreadBootstrapInput): Promise<ThreadBootstrapResult> {
    try {
      const { object } = await withObjectRetry(() =>
        generateObject({
          model: xai(NARRATOR_MODEL),
          schema: ThreadBootstrapSchema,
          system: loadThreadBootstrapPrompt(),
          prompt: [
            `PREMISE: ${input.premise}`,
            input.placeName ? `CURRENT PLACE: ${input.placeName}` : '',
            input.sceneTitle ? `CURRENT SCENE: ${input.sceneTitle}` : '',
            '',
            'RECENT NARRATION:',
            input.recentNarration || '(none yet)',
            '',
            'Name the central thread now.',
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
          stakes: t.stakes ?? null,
          relevanceTags: t.relevance_tags,
        })),
      }
    } catch (err) {
      console.error('[thread bootstrap failed]', err)
      return { threads: [] }
    }
  }
}

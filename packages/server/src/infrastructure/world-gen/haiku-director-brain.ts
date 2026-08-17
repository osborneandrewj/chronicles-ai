import 'server-only'

import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'

import type { DirectorBeatKind, DirectorCastSlot } from '@/domain/entities'
import type {
  DirectorBrainInput,
  DirectorBrainResult,
  DirectorDecisionPort,
} from '@/domain/ports/director-decision'
import { withObjectRetry } from '@/infrastructure/llm/generate-object'
import { HAIKU_MODEL } from '@/infrastructure/llm/model-registry'
import { loadPrompt } from '@/lib/prompt-files'

const BeatKindEnum = z.enum([
  'pressure',
  'reveal',
  'arrival',
  'close',
  'stall_escalate',
  'local',
  'yield',
])

const DirectorBrainSchema = z.object({
  beatKind: BeatKindEnum,
  foreground_thread_title: z.string().max(160).nullable(),
  mustStage: z.array(z.string().max(200)).min(1).max(3),
  mustNot: z.array(z.string().max(200)).max(2),
  cast: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        role: z.enum(['initiate', 'react', 'background', 'arrive']),
      }),
    )
    .max(6),
  guidanceLines: z.array(z.string().max(200)).max(3),
})

export class HaikuDirectorBrain implements DirectorDecisionPort {
  async proposeNextBeat(input: DirectorBrainInput): Promise<DirectorBrainResult | null> {
    try {
      const { object } = await withObjectRetry(() =>
        generateObject({
          model: anthropic(HAIKU_MODEL),
          schema: DirectorBrainSchema,
          maxRetries: 1,
          messages: [
            { role: 'system', content: loadPrompt('director-brain') },
            { role: 'user', content: buildUserContent(input) },
          ],
        }),
      )
      return mapResult(object, input)
    } catch (err) {
      console.error('[director-brain]', err)
      return null
    }
  }
}

function buildUserContent(input: DirectorBrainInput): string {
  const threads = input.threads
    .filter((t) => t.status === 'active')
    .map((t) => `- ${t.title} (${t.kind}) ${t.summary ?? ''}`)
    .join('\n')
  const present = input.present.map((p) => `- ${p.name} (#${p.id})`).join('\n')
  const last = input.lastDecision
  return [
    `REASON: ${input.reason}`,
    `PREMISE: ${input.premise}`,
    `LAST BEAT: kind=${last.beatKind ?? 'none'} phase=${last.phase ?? 'none'} tension=${last.tension}`,
    `FOREGROUND: ${last.foregroundTitle ?? '(none)'}`,
    `MUST STAGE NOW: ${last.mustStage.join(' | ') || '(none)'}`,
    `CAST NOW: ${last.cast.map((c) => `${c.role}:${c.name}`).join(', ') || '(none)'}`,
    '',
    'ACTIVE THREADS:',
    threads || '(none)',
    '',
    'PRESENT CHARACTERS:',
    present || '(none)',
    '',
    `PLAYER: ${input.playerText}`,
    `NARRATOR: ${input.narratorText.slice(0, 1200)}`,
  ].join('\n')
}

function mapResult(
  object: z.infer<typeof DirectorBrainSchema>,
  input: DirectorBrainInput,
): DirectorBrainResult {
  const thread = matchThread(object.foreground_thread_title, input.threads)
  return {
    beatKind: object.beatKind as DirectorBeatKind,
    foregroundThreadId: thread?.id ?? null,
    mustStage: object.mustStage,
    mustNot: object.mustNot,
    cast: resolveCast(object.cast, input.present),
    guidanceLines: object.guidanceLines,
  }
}

function matchThread(
  title: string | null,
  threads: DirectorBrainInput['threads'],
): { id: number } | undefined {
  if (!title) return undefined
  const key = title.trim().toLowerCase()
  return threads.find((t) => t.status === 'active' && t.title.toLowerCase() === key)
}

function resolveCast(
  raw: Array<{ name: string; role: DirectorCastSlot['role'] }>,
  present: Array<{ id: number; name: string }>,
): DirectorCastSlot[] {
  const byLower = new Map(present.map((p) => [p.name.toLowerCase(), p]))
  const slots: DirectorCastSlot[] = []
  let hasInitiate = false
  for (const row of raw) {
    const hit = byLower.get(row.name.toLowerCase())
    if (!hit) continue
    let role = row.role
    if (role === 'initiate' && hasInitiate) role = 'react'
    if (role === 'initiate') hasInitiate = true
    slots.push({ characterId: hit.id, name: hit.name, role })
  }
  return slots
}
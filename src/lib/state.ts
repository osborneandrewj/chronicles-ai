import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'

import { PREMISE } from '@/lib/prompt'

export type WorldState = {
  time: string
  location: string
  identity: string
}

export const INITIAL_STATE: WorldState = {
  time: 'Late afternoon, autumn 1897',
  location: 'Mevagissey harbour, Cornwall — pubs and quay still in view',
  identity:
    'Young letter-writer, recently returned home after seven years in London. Travel-worn, carrying a single case. Name not yet established.',
}

export function parseState(json: string | null): WorldState {
  if (!json) return INITIAL_STATE
  try {
    const parsed = JSON.parse(json) as Partial<WorldState>
    return {
      time: parsed.time ?? INITIAL_STATE.time,
      location: parsed.location ?? INITIAL_STATE.location,
      identity: parsed.identity ?? INITIAL_STATE.identity,
    }
  } catch {
    return INITIAL_STATE
  }
}

export function formatStateBlock(state: WorldState): string {
  return [
    '## AUTHORITATIVE STATE',
    'These facts are ground truth. Do not contradict them. If the player implies a change,',
    'narrate the attempt — do not silently rewrite location, time, or identity.',
    '',
    `- Time: ${state.time}`,
    `- Location: ${state.location}`,
    `- Identity: ${state.identity}`,
  ].join('\n')
}

const StateSchema = z.object({
  time: z.string().describe('In-world time of day and season/year, e.g. "Late afternoon, autumn 1897"'),
  location: z.string().describe('Where the protagonist currently is, specific enough to anchor sensory detail'),
  identity: z.string().describe('1-2 sentences: who the protagonist is, observable presentation, anything established about name/role'),
})

const EXTRACTOR_SYSTEM = `
You maintain the authoritative state for an interactive novel. Given the prior state and the most recent turn(s), return the updated state.

Rules:
- Preserve facts unless the latest turn clearly changes them.
- Time advances only when the narration says it does (a few minutes, an hour, the next morning).
- Location changes only when the narration moves the protagonist to a new place.
- Identity gains detail when narration or player action establishes a name, role, or visible change.
- Never invent facts not present in the prior state or recent turns.

PREMISE (context, do not extract from):
${PREMISE}
`.trim()

export async function extractState(
  prior: WorldState,
  recent: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<WorldState> {
  const transcript = recent
    .map((t) => `${t.role === 'user' ? 'PLAYER' : 'NARRATOR'}: ${t.content}`)
    .join('\n\n')

  const { object } = await generateObject({
    model: anthropic('claude-haiku-4-5-20251001'),
    schema: StateSchema,
    system: EXTRACTOR_SYSTEM,
    prompt: [
      'PRIOR STATE:',
      JSON.stringify(prior, null, 2),
      '',
      'RECENT TURNS:',
      transcript,
      '',
      'Return the updated state.',
    ].join('\n'),
  })

  return object
}

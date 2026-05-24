import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, type LanguageModelUsage } from 'ai'
import { z } from 'zod'

export type WorldState = {
  time: string
  location: string
  identity: string
}

// Last-resort defaults if a world's stored initial_state_json is malformed.
// Worlds always supply their own values via the create-world form; this is a
// shape guarantee, not a content default.
export const INITIAL_STATE_FALLBACK: WorldState = {
  time: 'Day 1, morning',
  location: 'Opening scene — see premise',
  identity: 'Newcomer — name not yet established.',
}

export function parseState(json: string | null, fallback: WorldState): WorldState {
  if (!json) return fallback
  try {
    const parsed = JSON.parse(json) as Partial<WorldState>
    return {
      time: parsed.time ?? fallback.time,
      location: parsed.location ?? fallback.location,
      identity: parsed.identity ?? fallback.identity,
    }
  } catch {
    return fallback
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

function buildExtractorSystem(premise: string): string {
  return `
You maintain the authoritative state for an interactive novel. Given the prior state and the most recent turn(s), return the updated state.

Rules:
- Preserve facts unless the latest turn clearly changes them.
- Time advances only when the narration says it does (a few minutes, an hour, the next morning).
- Location changes only when the narration moves the protagonist to a new place.
- Identity gains detail when narration or player action establishes a name, role, or visible change.
- Never invent facts not present in the prior state or recent turns.

PREMISE (context, do not extract from):
${premise}
`.trim()
}

export const EXTRACTOR_MODEL = 'claude-haiku-4-5-20251001'

export async function extractState(
  premise: string,
  prior: WorldState,
  recent: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<{ state: WorldState; usage: LanguageModelUsage }> {
  const transcript = recent
    .map((t) => `${t.role === 'user' ? 'PLAYER' : 'NARRATOR'}: ${t.content}`)
    .join('\n\n')

  const { object, usage } = await generateObject({
    model: anthropic(EXTRACTOR_MODEL),
    schema: StateSchema,
    system: buildExtractorSystem(premise),
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

  return { state: object, usage }
}

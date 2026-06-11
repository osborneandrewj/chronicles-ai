import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'

import { HAIKU_MODEL } from '@/infrastructure/llm/model-registry'

// One-shot Haiku call run when a player uses the Quick start creator. Given a
// genre label (+ optional player name) it synthesizes a complete starting
// world: title, premise, opening location, opening time, and a character
// description. Narrative richness comes later from the narrator's opening
// turn; this call only needs to produce a coherent, grounded seed. Modeled on
// region-extractor.ts. Throws on failure — unlike region extraction, a failed
// synthesis means there is nothing to create, so the caller must surface it.

const WORLD_GENERATOR_MODEL = HAIKU_MODEL

export const GeneratedWorldSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(120)
    .describe('A short, evocative title for the world (2–5 words).'),
  premise: z
    .string()
    .min(20)
    .max(2000)
    .describe(
      'One vivid paragraph: setting, era, tone, what is currently happening, ' +
        'and who the protagonist is. Concrete sensory detail over abstract mood.',
    ),
  location: z
    .string()
    .min(1)
    .max(400)
    .describe('Where the very first scene opens — a specific, concrete place.'),
  time: z
    .string()
    .min(1)
    .max(200)
    .describe('In-world opening time, e.g. "Day 1, morning".'),
  identity: z
    .string()
    .min(1)
    .max(600)
    .describe("1–2 sentences on the protagonist: who they are, what they look like, what they carry."),
})

export type GeneratedWorld = z.infer<typeof GeneratedWorldSchema>

export async function generateWorldFromGenre(
  genre: string,
  playerName: string | null,
): Promise<GeneratedWorld> {
  const nameLine = playerName
    ? `The protagonist is named "${playerName}". Weave this name into the character description.`
    : 'The protagonist is unnamed for now — write the description without inventing a proper name.'

  const { object } = await generateObject({
    model: anthropic(WORLD_GENERATOR_MODEL),
    schema: GeneratedWorldSchema,
    system:
      'You are a world designer for an interactive novel. Given a genre, you ' +
      'invent a fresh, specific starting situation a player can immediately ' +
      'step into. Favor concrete, grounded detail over generic tropes. Avoid ' +
      'clichés and brand/franchise names. Keep it coherent: the premise, ' +
      'location, time, and character must describe the same single opening moment.',
    prompt: [
      `GENRE: ${genre}`,
      '',
      nameLine,
      '',
      'Generate the starting world now.',
    ].join('\n'),
  })

  return object
}

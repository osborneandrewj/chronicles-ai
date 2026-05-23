import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, type LanguageModelUsage } from 'ai'
import { z } from 'zod'

export const CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001'

export const STANCES = ['do', 'say', 'think', 'observe', 'meta'] as const
export const INPUT_MODES = ['in-character', 'ooc', 'ambiguous'] as const

export type Stance = (typeof STANCES)[number]
export type InputMode = (typeof INPUT_MODES)[number]

export type Classification = {
  stance: Stance
  input_mode: InputMode
}

export type ClassificationResult = Classification & {
  usage?: LanguageModelUsage
  error?: string
}

const FALLBACK: Classification = { stance: 'do', input_mode: 'in-character' }

const ClassificationSchema = z.object({
  stance: z.enum(STANCES).describe(
    'do: physical action that advances the scene. say: dialogue or speech. think: internal thought, no outward action. observe: looking, listening, examining — no scene advance. meta: question to the narrator, not in-character.',
  ),
  input_mode: z.enum(INPUT_MODES).describe(
    'in-character: clearly a character action or speech. ooc: clearly out-of-character (questions to narrator, system requests). ambiguous: could be either.',
  ),
})

const CLASSIFIER_SYSTEM = `
You classify a player's input in an interactive novel. Output two enums only.

stance — what kind of move the player is making:
- do: a physical action that should advance the scene
- say: dialogue or speech to another character
- think: internal thought, no outward action
- observe: looking, listening, examining — no scene advance
- meta: a question or comment to the narrator, not in-character

input_mode — how the input is framed:
- in-character: clearly the protagonist acting or speaking
- ooc: clearly out-of-character (questions to narrator, system requests)
- ambiguous: could be either

Pick the dominant intent. If unsure between do and observe, prefer observe.
`.trim()

export async function classifyAction(text: string): Promise<ClassificationResult> {
  try {
    const { object, usage } = await generateObject({
      model: anthropic(CLASSIFIER_MODEL),
      schema: ClassificationSchema,
      system: CLASSIFIER_SYSTEM,
      prompt: `PLAYER INPUT:\n${text}`,
      maxOutputTokens: 200,
    })
    return { ...object, usage }
  } catch (err) {
    console.error('[classifier failed, falling back]', err)
    return { ...FALLBACK, error: String(err) }
  }
}

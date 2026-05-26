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
    'do: physical action that advances the scene. say: dialogue or speech (including bare in-world questions the protagonist would ask aloud). think: internal thought, no outward action. observe: looking, listening, examining — no scene advance. meta: a question or comment about the game/system/UI itself.',
  ),
  input_mode: z.enum(INPUT_MODES).describe(
    'in-character: the protagonist acting or speaking — the default. ooc: clearly addresses the narrator-as-system about the game/UI/rules. ambiguous: only when context truly cannot break the tie.',
  ),
})

const CLASSIFIER_SYSTEM = `
You classify a player's input in an interactive novel. Output two enums only.

You will receive a SCENE block (place + present NPCs) alongside the player
input. Use it. If the protagonist is in a scene with NPCs they could
plausibly address, a bare in-world question is almost always the
protagonist speaking aloud (say + in-character). If the protagonist is
alone and the input is a bare question, lean toward observe + in-character
(the protagonist asking themselves / scanning the scene) rather than ooc —
the OOC branch is reserved for inputs that clearly address the game/UI.

stance — what kind of move the player is making:
- do: a physical action that should advance the scene
- say: dialogue or speech to another character. Bare in-world questions
  ("Where is X?", "Who's that?", "What time is it?", "Tell me about Y")
  are say — the protagonist is asking aloud.
- think: internal thought, no outward action
- observe: looking, listening, examining — no scene advance
- meta: a question or comment ABOUT the game/system/UI/rules — not a
  question the protagonist would ask aloud. Examples: "how do I save?",
  "what model are you?", "summarise the story so far", "is this a game?",
  "(ooc) what just happened?". Bare in-world questions are NOT meta.

input_mode — how the input is framed:
- in-character: the protagonist acting or speaking. Default for any
  input that could plausibly be the protagonist's voice or action,
  including bare questions, one-word inputs, and ambiguous phrasings.
- ooc: explicitly addresses the narrator-as-system about the game,
  the model, the UI, the rules, or asks for a recap/summary the
  protagonist couldn't ask for. Often marked with "(ooc)" or
  similar; otherwise rare.
- ambiguous: only when the input genuinely could go either way and
  no leaning is possible. Prefer in-character when in doubt.

Default toward in-character + say for bare information questions. If
unsure between do and observe, prefer observe.
`.trim()

export async function classifyAction(
  text: string,
  sceneDigest?: string,
): Promise<ClassificationResult> {
  const promptParts: string[] = []
  if (sceneDigest && sceneDigest.trim().length > 0) {
    promptParts.push('SCENE:', sceneDigest, '')
  }
  promptParts.push('PLAYER INPUT:', text)
  try {
    const { object, usage } = await generateObject({
      model: anthropic(CLASSIFIER_MODEL),
      schema: ClassificationSchema,
      system: CLASSIFIER_SYSTEM,
      prompt: promptParts.join('\n'),
      maxOutputTokens: 200,
    })
    return { ...object, usage }
  } catch (err) {
    console.error('[classifier failed, falling back]', err)
    return { ...FALLBACK, error: String(err) }
  }
}

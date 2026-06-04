import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, type LanguageModelUsage } from 'ai'
import { z } from 'zod'

import { db } from '@/lib/db'
import {
  attachIntentsToNarratorTurn,
  getIntentsForPlayerTurn,
  reconcileIntentsBatch,
  type IntentDisposition,
  type NpcIntentRow,
} from '@/lib/npc-intents'

// v0.6.9 — light reconciliation pass. Runs after the narrator turn is
// persisted: takes the narrator's prose + the planned actions we put into
// the state block, and labels each intent staged/modified/ignored/
// contradicted. The labels feed back into the next NPC agent tick.
//
// This is deliberately a focused helper, not a full archivist pass. The
// archivist already extracts world state from the same prose; intent
// classification is narrower and benefits from a dedicated prompt.

export const RECONCILER_MODEL = 'claude-haiku-4-5-20251001'

const DispositionEnum = z.enum(['staged', 'modified', 'ignored', 'contradicted'])

const PerIntentResultSchema = z.object({
  intent_id: z
    .number()
    .int()
    .describe('The intent_id you were given. Echo it back so we can match the result.'),
  disposition: DispositionEnum.describe(
    'staged: the narrator depicted the planned action as written. ' +
      'modified: the narrator depicted a close cousin (different beat, target shift, partial). ' +
      'ignored: the narrator wrote past the plan without staging it. ' +
      'contradicted: the narrator depicted an outcome that conflicts with the plan ' +
      '(e.g. the planned target left first, the NPC physically could not).',
  ),
  interpretation: z
    .string()
    .optional()
    .describe('One short sentence describing how the narrator handled the plan, if non-obvious.'),
  outcome_summary: z
    .string()
    .optional()
    .describe('One short past-tense sentence describing what actually happened on the page.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('0.0-1.0 confidence in the disposition label. Low confidence is a flag, not a failure.'),
})

export const ReconciliationSchema = z.object({
  results: z.array(PerIntentResultSchema),
})

export type ReconciliationResult = z.infer<typeof PerIntentResultSchema>

export type ReconciliationRunResult = {
  results: ReconciliationResult[]
  usage: LanguageModelUsage | null
  model: string
  skipped?: 'no_intents' | 'no_pending' | 'all_attached_only'
  error?: string
}

// Look at the narrator prose and assign a disposition to each pending intent
// for the given player turn. "Pending" means the row was created in the
// pre-narrator agent pass and has not been reconciled yet. We always at
// least attach the narrator_turn_id, even if classification fails — the row
// becomes auditable as "narrator ran but we couldn't label".
export async function reconcileNpcIntentsForTurn({
  playerTurnId,
  narratorTurnId,
  narratorText,
}: {
  playerTurnId: number
  narratorTurnId: number
  narratorText: string
}): Promise<ReconciliationRunResult> {
  const intents = getIntentsForPlayerTurn(playerTurnId).filter(
    (row) => row.narrator_disposition === null,
  )
  if (intents.length === 0) {
    return {
      results: [],
      usage: null,
      model: RECONCILER_MODEL,
      skipped: 'no_pending',
    }
  }

  // Attach the narrator turn id up front so the row is at least cross-
  // referenced even if the LLM call fails.
  attachIntentsToNarratorTurn(
    intents.map((row) => row.id),
    narratorTurnId,
  )

  const characterNameById = new Map<number, string>()
  const nameStmt = db.prepare<[number]>('SELECT name FROM characters WHERE id = ?')
  for (const row of intents) {
    if (characterNameById.has(row.character_id)) continue
    const c = nameStmt.get(row.character_id) as { name: string } | undefined
    characterNameById.set(row.character_id, c?.name ?? `character #${row.character_id}`)
  }

  const prompt = buildReconcilerPrompt(intents, characterNameById, narratorText)
  try {
    const { object, usage } = await generateObject({
      model: anthropic(RECONCILER_MODEL),
      schema: ReconciliationSchema,
      messages: [
        {
          role: 'system',
          content: RECONCILER_SYSTEM,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        },
        { role: 'user', content: prompt },
      ],
    })

    // Drop any results referencing intent IDs we didn't ask about. The
    // reconciler should echo our ids back, but defense-in-depth is cheap.
    const validIds = new Set(intents.map((row) => row.id))
    const normalized = object.results.filter((r) => validIds.has(r.intent_id))
    reconcileIntentsBatch(
      normalized.map((r) => ({
        intentId: r.intent_id,
        narratorTurnId,
        disposition: r.disposition as IntentDisposition,
        interpretation: r.interpretation ?? null,
        outcomeSummary: r.outcome_summary ?? null,
        confidence: r.confidence ?? null,
      })),
    )

    return { results: normalized, usage, model: RECONCILER_MODEL }
  } catch (err) {
    return {
      results: [],
      usage: null,
      model: RECONCILER_MODEL,
      error: String(err),
    }
  }
}

const RECONCILER_SYSTEM = `You are a narrative reconciliation helper for an interactive novel.

You are given:
- A short list of NPC plans that were prepared BEFORE this narrator turn ran.
- The narrator's actual prose for the same turn.

For each plan, label how the narrator handled it. Definitions:
- "staged" — the narrator depicted the planned action as written, or a near-identical realization. Minor texture changes are still "staged".
- "modified" — the narrator depicted a clearly related but altered action: different target, shifted beat, partial execution, the NPC tried but in a different way, the timing changed.
- "ignored" — the narrator wrote past the plan without staging it. The NPC is in the scene but the planned action did not appear, even partially.
- "contradicted" — the narrator depicted something that makes the plan impossible or in direct conflict: the planned target had already left, the NPC could not physically do it, the planned move failed in the prose.

Be honest. A plan that the narrator silently dropped is "ignored", not "staged". Do not flatter the plans.

Return one result per intent_id you were given, even if low-confidence. Use confidence ~0.4 when the prose is ambiguous; ~0.9+ when the action is clearly on the page or clearly absent.

Echo the intent_id back exactly. Do not invent new ids.`

function buildReconcilerPrompt(
  intents: NpcIntentRow[],
  characterNameById: Map<number, string>,
  narratorText: string,
): string {
  const intentBlock = intents
    .map((row) => {
      const npcName = characterNameById.get(row.character_id) ?? `character #${row.character_id}`
      return [
        `intent_id: ${row.id}`,
        `npc: ${npcName}`,
        `intent: ${row.intent_text}`,
        `planned_action: ${row.planned_action}`,
      ].join('\n')
    })
    .join('\n---\n')

  return [
    'PLANS THAT WERE PREPARED FOR THIS TURN:',
    intentBlock,
    '',
    'NARRATOR PROSE:',
    narratorText,
    '',
    'Return a result for each intent_id above.',
  ].join('\n')
}

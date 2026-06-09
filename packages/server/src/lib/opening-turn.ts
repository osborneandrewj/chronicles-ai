import { xai } from '@ai-sdk/xai'
import { generateText } from 'ai'

import type { SceneRepository } from '@/domain/ports'
import { NARRATOR_MODEL } from '@/infrastructure/llm/model-registry'
import { ARCHIVIST_MODEL, applyArchivistPatch, extractPatch } from '@/lib/archivist'
import { isOverDailyLimit } from '@/lib/cost-cap'
import { insertTurn, updateTurnMetadata } from '@/lib/db'
import { formatPremiseBlock, NARRATOR_BASE } from '@/lib/prompt'
import {
  formatStateBlock,
  getNarratorWorldStateVia,
  type NarratorWorldStateDeps,
} from '@/lib/world-state'

// Trailing directive that nudges the narrator into the "Opening a new world"
// branch of NARRATOR_BASE. The system prompt already carries the length /
// fourth-wall / additions / NPC rules; this just signals which mode to run.
const OPENING_DIRECTIVE =
  "OPENING TURN: this world has no history yet. Make the narrator's first move per the " +
  '"Opening a new world" section of your system prompt. The player has not spoken; ' +
  'do not echo or pre-empt them.'

// Generates and persists the world's opening narrator turn, then runs the
// archivist on it. Called from the world-creation server action so the player
// lands on /play with the opening already streamed-and-saved.
//
// Returns silently on failures so a flaky LLM call doesn't block world
// creation entirely; the player can send their own first turn if the opening
// never lands. Console-logs surface in Railway logs for diagnosis.
// Read ports the opening turn reads (P2 cutover): the narrator-context assembler
// plus the active-scene lookup. The server action hands these in from the
// container; SQLite delegates to the same `lib/db` readers (byte-identical).
export type OpeningTurnDeps = NarratorWorldStateDeps & {
  scenes: Pick<SceneRepository, 'activeForWorld'>
}

export async function generateOpeningTurn(
  deps: OpeningTurnDeps,
  worldId: number,
  premise: string,
): Promise<void> {
  if (await isOverDailyLimit()) {
    console.warn('[opening-turn] daily token cap reached; skipping opening for world', worldId)
    return
  }

  const priorState = await getNarratorWorldStateVia(deps, worldId)
  const stateBlock = formatStateBlock(priorState)
  const premiseBlock = formatPremiseBlock(premise)
  const activeSceneId = (await deps.scenes.activeForWorld(worldId))?.id ?? null

  let text: string
  let narratorUsage: Awaited<ReturnType<typeof generateText>>['usage']
  try {
    const result = await generateText({
      model: xai(NARRATOR_MODEL),
      system: NARRATOR_BASE,
      messages: [
        {
          role: 'user',
          content: `${premiseBlock}\n\n${stateBlock}\n\n${OPENING_DIRECTIVE}`,
        },
      ],
    })
    text = result.text
    narratorUsage = result.usage
  } catch (err) {
    console.error('[opening-turn] narrator generation failed', err)
    return
  }

  const trimmed = text.trim()
  if (trimmed.length === 0) return

  const narratorTurn = insertTurn(worldId, 'assistant', trimmed, activeSceneId)
  const narratorMeta = { model: NARRATOR_MODEL, usage: narratorUsage, opening: true }

  // Visible cost lands immediately; the archivist follow-up below merges its
  // own key via updateTurnMetadata's json_patch semantics. Mirrors /api/chat.
  updateTurnMetadata(narratorTurn.id, { narrator: narratorMeta })

  try {
    const { patch, usage: archivistUsage } = await extractPatch(
      premise,
      priorState,
      [{ role: 'assistant', content: trimmed }],
      null,
      true, // isOpening — bootstrap the central thread + concrete place kind
    )
    await applyArchivistPatch(worldId, narratorTurn.id, patch)
    updateTurnMetadata(narratorTurn.id, {
      archivist: { model: ARCHIVIST_MODEL, usage: archivistUsage, patch },
    })
  } catch (err) {
    updateTurnMetadata(narratorTurn.id, {
      archivist: { model: ARCHIVIST_MODEL, error: String(err) },
    })
    console.error('[opening-turn] archivist patch failed', err)
  }
}

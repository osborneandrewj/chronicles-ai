import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, type LanguageModelUsage } from 'ai'
import { z } from 'zod'

import { db } from '@/lib/db'
import { appendFactWithProvenance, stripFactProvenance } from '@/lib/memorable-facts'
import { loadPrompt } from '@/lib/prompt-files'
import type { NarratorWorldState } from '@/lib/world-state'

// Discriminated on `action` rather than the doc's keep_open/close/open key shape.
// Discriminated unions translate to a cleaner JSON schema (oneOf with a literal
// discriminator) and are easier for the model to satisfy than schemas where the
// variant is implied by which key is present.
const SceneActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep_open') }),
  z.object({
    action: z.literal('close'),
    summary: z.string().describe('One or two past-tense sentences summarizing the scene that just ended.'),
  }),
  z.object({
    action: z.literal('open'),
    title: z.string().describe('A short title for the new scene.'),
    place_name: z
      .string()
      .describe('The place where the new scene opens. Will be upserted by name within the world.'),
  }),
])

const PlacePatchSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  kind: z.string().optional().describe('Free-form, e.g. "harbour", "tavern", "ship\'s deck".'),
})

const CharacterPatchSchema = z.object({
  name: z.string(),
  is_player: z.boolean().optional().describe('True only for the protagonist. Never set for NPCs.'),
  description: z.string().optional(),
  current_place_name: z
    .string()
    .optional()
    .describe('Place name (within this world). Will be resolved by case-insensitive match.'),
  memorable_facts_append: z
    .string()
    .optional()
    .describe('A single short sentence to append. Append-only — do not retract earlier facts.'),
  status: z.enum(['active', 'inactive', 'dead']).optional(),
  active_goal: z
    .string()
    .nullable()
    .optional()
    .describe(
      "What this NPC wants right now (short, scene-immediate, e.g. 'sell the player a room'). " +
        'Omit to leave unchanged. Set explicitly to null only when the goal was clearly ' +
        'satisfied or abandoned in the latest turn. Never invent grand long-term arcs.',
    ),
  current_attitude: z
    .string()
    .nullable()
    .optional()
    .describe(
      "How this NPC is currently behaving (short, e.g. 'polite but increasingly afraid', " +
        "'sarcastic, testing'). Omit to leave unchanged. Set explicitly to null only when the " +
        'prior attitude has clearly dropped. Keep it immediate and observable, not a full ' +
        'psychological profile.',
    ),
})

export const ArchivistPatchSchema = z.object({
  current_time: z
    .string()
    .optional()
    .describe('Updated in-world time. Omit if the narration did not advance time.'),
  scene: SceneActionSchema.optional().describe(
    'Default to omitting (equivalent to keep_open). Use close/open only when a scene clearly ends or starts.',
  ),
  places: z.array(PlacePatchSchema).optional(),
  characters: z.array(CharacterPatchSchema).optional(),
})

export type ArchivistPatch = z.infer<typeof ArchivistPatchSchema>

export const ARCHIVIST_MODEL = 'claude-haiku-4-5-20251001'

export async function extractPatch(
  premise: string,
  prior: NarratorWorldState,
  recent: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<{ patch: ArchivistPatch; usage: LanguageModelUsage }> {
  const transcript = recent
    .map((t) => `${t.role === 'user' ? 'PLAYER' : 'NARRATOR'}: ${t.content}`)
    .join('\n\n')

  const priorBlock = JSON.stringify(
    {
      world_time: prior.worldTime,
      current_scene: prior.currentScene
        ? {
            title: prior.currentScene.title,
            scene_number: prior.currentScene.scene_number,
            place: prior.currentPlace?.name ?? null,
          }
        : null,
      present_characters: prior.presentCharacters.map((c) => ({
        name: c.name,
        is_player: c.is_player === 1,
        description: c.description,
        memorable_facts: stripFactProvenance(c.memorable_facts),
        status: c.status,
      })),
    },
    null,
    2,
  )

  const { object, usage } = await generateObject({
    model: anthropic(ARCHIVIST_MODEL),
    schema: ArchivistPatchSchema,
    system: `${loadPrompt('archivist-system')}\n\nPREMISE (context, do not extract from):\n${premise}`,
    prompt: [
      'PRIOR STATE:',
      priorBlock,
      '',
      'RECENT TURNS:',
      transcript,
      '',
      'Return the patch.',
    ].join('\n'),
  })

  return { patch: object, usage }
}

// Prepared statements for patch application. All writes happen inside the
// transaction opened by applyArchivistPatch — better-sqlite3's db.transaction
// composes prepared statements implicitly.
const findPlaceByNameStmt = db.prepare<[number, string]>(
  'SELECT id FROM places WHERE world_id = ? AND lower(name) = lower(?)',
)
const insertPlaceStmt = db.prepare<[number, string, string | null, string | null]>(
  `INSERT INTO places (world_id, name, description, kind)
   VALUES (?, ?, ?, ?) RETURNING id`,
)
const updatePlaceStmt = db.prepare<[string | null, string | null, number]>(
  `UPDATE places SET
     description = COALESCE(?, description),
     kind        = COALESCE(?, kind),
     updated_at  = datetime('now')
   WHERE id = ?`,
)

const findCharacterByNameStmt = db.prepare<[number, string]>(
  `SELECT id, memorable_facts FROM characters
   WHERE world_id = ? AND lower(name) = lower(?)`,
)
const insertCharacterStmt = db.prepare<
  [number, string, string | null, number, number | null, string | null, string, string | null, string | null]
>(
  `INSERT INTO characters (world_id, name, description, is_player, current_place_id,
                           memorable_facts, status, active_goal, current_attitude)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
)
const updateCharacterStmt = db.prepare<
  [string | null, number | null, number | null, string | null, string | null, number]
>(
  `UPDATE characters SET
     description       = COALESCE(?, description),
     current_place_id  = COALESCE(?, current_place_id),
     is_player         = COALESCE(?, is_player),
     memorable_facts   = COALESCE(?, memorable_facts),
     status            = COALESCE(?, status),
     updated_at        = datetime('now')
   WHERE id = ?`,
)
// active_goal / current_attitude need three-state semantics (omitted =
// unchanged, null = clear, string = set). COALESCE collapses null and
// undefined, so these run as separate conditional updates instead of
// piggybacking on updateCharacterStmt.
const setActiveGoalStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET active_goal = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setCurrentAttitudeStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET current_attitude = ?, updated_at = datetime('now') WHERE id = ?`,
)

const closeSceneStmt = db.prepare<[string, number, number]>(
  `UPDATE scenes SET status = 'completed', summary = ?, closed_at_turn = ?
   WHERE id = ?`,
)
const maxSceneNumberStmt = db.prepare<[number]>(
  'SELECT COALESCE(MAX(scene_number), 0) as n FROM scenes WHERE world_id = ?',
)
const insertSceneStmt = db.prepare<[number, number, string, number, number]>(
  `INSERT INTO scenes (world_id, place_id, title, scene_number, opened_at_turn)
   VALUES (?, ?, ?, ?, ?) RETURNING id`,
)
const setCurrentSceneStmt = db.prepare<[number, number]>(
  'UPDATE worlds SET current_scene_id = ? WHERE id = ?',
)
const setWorldTimeStmt = db.prepare<[string, number]>(
  'UPDATE worlds SET world_time = ? WHERE id = ?',
)
const currentSceneIdStmt = db.prepare<[number]>(
  'SELECT current_scene_id FROM worlds WHERE id = ?',
)
const autoCloseSceneStmt = db.prepare<[number, number]>(
  `UPDATE scenes SET status = 'completed', closed_at_turn = ?
   WHERE id = ? AND status = 'active'`,
)

function upsertPlace(
  worldId: number,
  name: string,
  description: string | undefined,
  kind: string | undefined,
): number {
  const existing = findPlaceByNameStmt.get(worldId, name) as { id: number } | undefined
  if (existing) {
    if (description !== undefined || kind !== undefined) {
      updatePlaceStmt.run(description ?? null, kind ?? null, existing.id)
    }
    return existing.id
  }
  const row = insertPlaceStmt.get(worldId, name, description ?? null, kind ?? null) as { id: number }
  return row.id
}


// Apply a validated patch to the world. Wrapped in a single transaction so a
// partial failure leaves no half-applied state (e.g. a new place row with no
// scene pointing at it). The narrator turn itself was committed earlier; this
// is the structural update that follows.
export function applyArchivistPatch(
  worldId: number,
  narratorTurnId: number,
  patch: ArchivistPatch,
): void {
  const tx = db.transaction(() => {
    // 1. Places first, so character.current_place_name and scene.open.place_name
    //    can resolve to ids in the same patch.
    if (patch.places) {
      for (const p of patch.places) {
        upsertPlace(worldId, p.name, p.description, p.kind)
      }
    }

    // 2. Characters. Look up by lowercased name; upsert with COALESCE so an
    //    omitted field doesn't overwrite an existing value with NULL.
    if (patch.characters) {
      for (const c of patch.characters) {
        const placeId =
          c.current_place_name !== undefined
            ? upsertPlace(worldId, c.current_place_name, undefined, undefined)
            : null
        const existing = findCharacterByNameStmt.get(worldId, c.name) as
          | { id: number; memorable_facts: string | null }
          | undefined
        if (existing) {
          const nextFacts = appendFactWithProvenance(
            existing.memorable_facts,
            c.memorable_facts_append,
            narratorTurnId,
          )
          updateCharacterStmt.run(
            c.description ?? null,
            placeId,
            c.is_player === undefined ? null : c.is_player ? 1 : 0,
            nextFacts,
            c.status ?? null,
            existing.id,
          )
          // Goal / attitude are three-state: omitted (undefined) = unchanged;
          // explicit null = clear; string = set.
          if (c.active_goal !== undefined) {
            setActiveGoalStmt.run(c.active_goal, existing.id)
          }
          if (c.current_attitude !== undefined) {
            setCurrentAttitudeStmt.run(c.current_attitude, existing.id)
          }
        } else {
          insertCharacterStmt.run(
            worldId,
            c.name,
            c.description ?? null,
            c.is_player ? 1 : 0,
            placeId,
            appendFactWithProvenance(null, c.memorable_facts_append, narratorTurnId),
            c.status ?? 'active',
            c.active_goal ?? null,
            c.current_attitude ?? null,
          )
        }
      }
    }

    // 3. Scene action. close must complete before open so scene_number sequencing
    //    works without juggling.
    if (patch.scene && patch.scene.action !== 'keep_open') {
      if (patch.scene.action === 'close') {
        const cursor = currentSceneIdStmt.get(worldId) as
          | { current_scene_id: number | null }
          | undefined
        if (cursor?.current_scene_id) {
          closeSceneStmt.run(patch.scene.summary, narratorTurnId, cursor.current_scene_id)
        }
      } else {
        // action === 'open' — auto-close the prior active scene if one exists,
        // then create the new scene. Auto-close has no summary; v0.6's CRUD UI
        // can backfill if it matters.
        const cursor = currentSceneIdStmt.get(worldId) as
          | { current_scene_id: number | null }
          | undefined
        if (cursor?.current_scene_id) {
          autoCloseSceneStmt.run(narratorTurnId, cursor.current_scene_id)
        }
        const placeId = upsertPlace(worldId, patch.scene.place_name, undefined, undefined)
        const { n } = maxSceneNumberStmt.get(worldId) as { n: number }
        const row = insertSceneStmt.get(worldId, placeId, patch.scene.title, n + 1, narratorTurnId) as {
          id: number
        }
        setCurrentSceneStmt.run(row.id, worldId)
      }
    }

    // 4. World clock.
    if (patch.current_time) {
      setWorldTimeStmt.run(patch.current_time, worldId)
    }
  })
  tx()
}

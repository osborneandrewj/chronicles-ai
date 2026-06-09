import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, type LanguageModelUsage } from 'ai'
import { z } from 'zod'

import { applyArchivistPatch as runApplyArchivistPatch } from '@/application/use-cases/apply-archivist-patch'
import { getContainer } from '@/composition/container'
import { sanitizeArchivistPatch } from '@/domain/services/patch-sanitizer'
import { HAIKU_MODEL } from '@/infrastructure/llm/model-registry'
import { isDescriptorName } from '@/lib/character-identity'
import { coerceJsonObject, tolerateNulls } from '@/lib/llm-schema'
import { stripFactProvenance } from '@/lib/memorable-facts'
import type { PlaceOccupancy } from '@/lib/place-population'
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

const SceneContextSchema = z.object({
  scene_mood: z
    .enum(['atmospheric', 'tense', 'violent', 'intimate', 'wondrous'])
    .optional()
    .describe('Current prose mood for the active scene. Omit if unchanged.'),
  pace: z
    .enum(['slow', 'medium', 'fast'])
    .optional()
    .describe('Current rhythm of the active scene. Omit if unchanged.'),
  focus: z
    .enum(['environment', 'characters', 'action', 'internal'])
    .optional()
    .describe('What the active scene is primarily attending to. Omit if unchanged.'),
})

const PlacePatchSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  kind: z.string().optional().describe('Free-form, e.g. "harbour", "tavern", "ship\'s deck".'),
  player_notes_append: z
    .string()
    .optional()
    .describe(
      'Player-asserted canon about this place — only set from the correction channel, never ' +
        'from narrator extraction. A single short sentence; appended on its own line to existing ' +
        'player_notes. Never set from the normal narrator-extraction archivist path.',
    ),
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
  observations_append: z
    .string()
    .optional()
    .describe(
      'A single short sentence describing something this NPC noticed about the protagonist in ' +
        'the latest turns — only for present NPCs, and only when the protagonist did something ' +
        'observably off-pattern (repeated themselves, agitated, dissociated, ignored what they ' +
        'would normally notice, said something out of character). Append-only. Omit on routine ' +
        'turns; never set for the player.',
    ),
  player_notes_append: z
    .string()
    .optional()
    .describe(
      'Player-asserted canon about this character — only set from the correction channel, never ' +
        'from narrator extraction. A single short sentence; appended on its own line to existing ' +
        'player_notes. Use this for facts the player tells the archivist directly (a car, a ' +
        'family member, a job, a corrected detail). Never set from the normal narrator-extraction ' +
        'archivist path.',
    ),
  aliases: z
    .array(z.string())
    .optional()
    .describe(
      'Other names or descriptors that refer to the same character. Used in two ways: (1) the ' +
        'correction channel can list pre-existing rows that should be merged into this one ' +
        '(e.g. "Bob and Robert are the same"); (2) the narrator-extraction path lists alternate ' +
        'descriptors seen in prose for unnamed figures so subsequent turns resolve them to this ' +
        'same row. Each alias is looked up by case-insensitive exact match against existing ' +
        'characters and any match is merged in; all final aliases are persisted on the canonical ' +
        'row so future references resolve correctly. ' +
        'NARRATOR-EXTRACTION USE: when a figure is unnamed and described by a new variant ' +
        '(e.g. "the man at the gyro van" → "the man in the canvas vest" → "the pale-eyed man"), ' +
        'list the new descriptor here on the same row, do NOT mint a new character. ' +
        'CORRECTION USE: only set when the player explicitly tells the archivist two existing ' +
        'rows are the same person.',
    ),
  reveals_name_of: z
    .string()
    .optional()
    .describe(
      'The existing descriptor/title or prior name of the figure this row IS. Set when a figure ' +
        'you already track is given or reveals a proper name: put the proper name in `name` and the ' +
        'old descriptor here. The named existing row is renamed and merged into this one — the safe, ' +
        'preferred way to handle a name reveal (clearer than `aliases`).',
    ),
})

const StoryThreadPatchSchema = z.object({
  title: z.string().describe('Short stable title for an active plotline, mystery, threat, or mission.'),
  kind: z.enum(['quest', 'mystery', 'threat', 'relationship', 'background']).optional(),
  status: z.enum(['active', 'resolved', 'failed', 'dormant']).optional(),
  summary: z.string().optional().describe('One short sentence describing what this thread is about.'),
  stakes: z.string().optional().describe('What gets worse if this thread is ignored.'),
  rewards: z.string().optional().describe('What success may gain: reputation, safety, payment, leverage, answers.'),
  consequences: z.string().optional().describe('What failure or delay may cost.'),
  hidden: z
    .string()
    .optional()
    .describe('Narrator-visible pressure that should influence events but not be exposed directly.'),
  relevance_tags: z
    .array(z.string())
    .optional()
    .describe('Lowercase topic + place-kind tags (e.g. "bar","docks","medical","courier") used to surface this thread where it is relevant. Tag the place kinds and subjects the protagonist would pursue it at. Emit 2-5 tags.'),
})

const StoryCluePatchSchema = z.object({
  title: z.string().describe('Short name for the clue/evidence/lead.'),
  thread_title: z.string().optional().describe('Existing or new story thread title this clue belongs to.'),
  detail: z.string().optional().describe('Concrete discovered fact, evidence, or partial result.'),
  implication: z.string().optional().describe('What this clue points toward, if known.'),
  status: z.enum(['open', 'interpreted', 'spent', 'false_lead']).optional(),
})

const StoryObjectivePatchSchema = z.object({
  title: z.string().describe('Short playable objective or next step.'),
  thread_title: z.string().optional().describe('Existing or new story thread title this objective belongs to.'),
  status: z.enum(['active', 'blocked', 'completed', 'failed']).optional(),
  detail: z.string().optional().describe('What the protagonist can do about it.'),
  blocker: z.string().optional().describe('Specific obstacle blocking the objective, if any.'),
})

const StoryResourcePatchSchema = z.object({
  name: z.string().describe('Tool, companion, authority, asset, wound, corruption, or other play-relevant resource.'),
  owner_name: z.string().optional().describe('Known character who owns or carries it, if any.'),
  kind: z.string().optional().describe('Free-form kind, e.g. tool, companion, weapon, authority, injury.'),
  status: z.string().optional().describe('Current status, e.g. active, damaged, missing, spent.'),
  detail: z.string().optional().describe('Short play-relevant detail.'),
})

const TimelineEventPatchSchema = z.object({
  title: z.string().describe('Short milestone title.'),
  thread_title: z.string().optional().describe('Existing or new story thread title this event belongs to.'),
  summary: z.string().describe('One sentence describing the event.'),
  importance: z.number().int().min(1).max(5).optional().describe('3 is normal notable; 5 is campaign-defining.'),
})

export const ArchivistPatchSchema = z.object({
  current_time: z
    .string()
    .optional()
    .describe('Updated in-world time. Omit if the narration did not advance time.'),
  scene: coerceJsonObject(SceneActionSchema).optional().describe(
    'Default to omitting (equivalent to keep_open). Use close/open only when a scene clearly ends or starts.',
  ),
  scene_context: SceneContextSchema.optional().describe(
    'Compact mood/pace/focus read for narrator prose control. Update when the latest turn clearly changes the scene\'s rhythm or attention.',
  ),
  places: z.array(tolerateNulls(PlacePatchSchema)).optional(),
  characters: z.array(tolerateNulls(CharacterPatchSchema)).optional(),
  story_threads: z.array(tolerateNulls(StoryThreadPatchSchema)).optional(),
  story_clues: z.array(tolerateNulls(StoryCluePatchSchema)).optional(),
  story_objectives: z.array(tolerateNulls(StoryObjectivePatchSchema)).optional(),
  story_resources: z.array(tolerateNulls(StoryResourcePatchSchema)).optional(),
  timeline_events: z.array(tolerateNulls(TimelineEventPatchSchema)).optional(),
})

// Correction-channel response: same patch shape plus a short natural-language
// reply the inspector shows back to the player. Modeled as a superset so the
// apply path can ignore `reply` and the route handler can render it without
// touching the patch types.
export const CorrectionPatchSchema = ArchivistPatchSchema.extend({
  reply: z
    .string()
    .describe(
      'One or two short sentences describing what was changed, in plain English ' +
        '("Recorded that you drive a Subaru Outback on your character."). Concrete, ' +
        'no narration, no promises about future narrator behavior. Required.',
    ),
})

export type ArchivistPatch = z.infer<typeof ArchivistPatchSchema>
export type CorrectionPatchResult = z.infer<typeof CorrectionPatchSchema>

export const ARCHIVIST_MODEL = HAIKU_MODEL

// Patch sanitization + deterministic-move extraction moved to the pure domain
// service `domain/services/patch-sanitizer.ts` (P4). Re-exported here so
// existing importers of `@/lib/archivist` keep working during the migration.
// `sanitizeArchivistPatch` is also used locally (imported above) and exported
// through that binding.
export { sanitizeArchivistPatch }
export {
  extractDeterministicPatch,
  normalizeTransitPlaceName,
} from '@/domain/services/patch-sanitizer'

function formatOccupancyForArchivist(occupancy: PlaceOccupancy | null): string {
  if (!occupancy) return ''
  const promotable = occupancy.groups.filter((g) => g.promotable)
  if (promotable.length === 0 && occupancy.encounter_hooks.length === 0) return ''
  const lines: string[] = ['NEARBY PROMOTABLE OCCUPANTS (promote ONLY if the protagonist engaged them this turn):']
  for (const g of promotable) {
    lines.push(`- ${g.id}: ${g.label} (${g.role}) — ${g.behavior}`)
  }
  for (const h of occupancy.encounter_hooks) {
    if (h.kind === 'continuation') {
      lines.push(`- hook ${h.id}: occupant ${h.occupant_id ?? '(place)'} relates to thread "${h.thread_ref}". If engaged, add a clue/objective to that thread.`)
    } else {
      lines.push(`- hook ${h.id}: occupant ${h.occupant_id ?? '(place)'} can open a NEW thread — premise: ${h.premise}. If engaged, create that thread (tagged).`)
    }
  }
  return lines.join('\n')
}

// The dossier is empty and the latest narration carries story-shaped pressure.
// Fires on the opening turn AND on any later turn until the world has at least
// one active thread — the gap that left worlds with a permanently empty dossier
// (Haiku ignored the one-shot opening directive). Reframed as a hard mandate.
export const THREAD_MANDATE_DIRECTIVE = [
  'DOSSIER BOOTSTRAP — this world has no active story_thread yet.',
  'The latest narration establishes story pressure. You MUST create at least one story_thread',
  'capturing the central goal, danger, or tension in play. Choose kind: quest for a goal the',
  'protagonist is pursuing or has taken on, threat for a danger or clock bearing down, mystery',
  'only for an unexplained situation with no objective yet. Set 2-5 lowercase relevance_tags',
  '(topic + place-kind). A memorable_fact is NOT a substitute for a thread.',
].join('\n')

// Only on the world's literal first narration: the starting place needs a kind
// so the world can populate it.
export const PLACE_KIND_DIRECTIVE = [
  "OPENING TURN — set the starting place's kind via a places[] patch — the concrete locale where",
  'the scene opens (e.g. street, transit, bar, market, hospital, office, cafe, restaurant, park,',
  'dock, alley) — so the world can populate it. Patch the place by the name shown in PRIOR STATE.',
].join('\n')

// Pure assembly of the archivist's user message. Extracted so the directive
// injection contract is unit-testable without exercising the LLM call.
export function buildArchivistUserContent(parts: {
  priorBlock: string
  transcript: string
  occupancyBlock: string
  threadMandate: boolean
  placeKindMandate: boolean
}): string {
  const { priorBlock, transcript, occupancyBlock, threadMandate, placeKindMandate } = parts
  return [
    'PRIOR STATE:',
    priorBlock,
    '',
    'RECENT TURNS:',
    transcript,
    ...(occupancyBlock ? ['', occupancyBlock] : []),
    ...(threadMandate ? ['', THREAD_MANDATE_DIRECTIVE] : []),
    ...(placeKindMandate ? ['', PLACE_KIND_DIRECTIVE] : []),
    '',
    'NOTE: a character marked "descriptor_placeholder": true is an unnamed stand-in. If the latest turn names that figure (they state a name, are named, or ID is found), rename THAT row — set `name` to the proper name and `reveals_name_of` to the descriptor — do not create a new character.',
    'Return the patch.',
  ].join('\n')
}

export async function extractPatch(
  premise: string,
  prior: NarratorWorldState,
  recent: Array<{ role: 'user' | 'assistant'; content: string }>,
  occupancy: PlaceOccupancy | null = null,
  isOpening = false,
  bootstrapDossier = false,
): Promise<{ patch: ArchivistPatch; usage: LanguageModelUsage }> {
  const transcript = recent
    .map((t) => `${t.role === 'user' ? 'PLAYER' : 'NARRATOR'}: ${t.content}`)
    .join('\n\n')

  const occupancyBlock = formatOccupancyForArchivist(occupancy)

  const priorBlock = JSON.stringify(
    {
      world_time: prior.worldTime,
      current_scene: prior.currentScene
        ? {
            title: prior.currentScene.title,
            scene_number: prior.currentScene.scene_number,
            place: prior.currentPlace?.name ?? null,
            scene_mood: prior.currentScene.scene_mood,
            pace: prior.currentScene.pace,
            focus: prior.currentScene.focus,
          }
        : null,
      present_characters: prior.presentCharacters.map((c) => ({
        name: c.name,
        is_player: c.is_player === 1,
        status: c.status,
        descriptor_placeholder:
          c.is_player === 1 ? undefined : isDescriptorName(c.name) || undefined,
        current_place:
          c.current_place_id && prior.currentPlace?.id === c.current_place_id
            ? prior.currentPlace.name
            : undefined,
        memorable_facts:
          c.is_player === 1 ? lastNLines(stripFactProvenance(c.memorable_facts), 5) : undefined,
        observations: c.is_player === 1 ? undefined : lastNLines(stripFactProvenance(c.observations), 2),
      })),
      known_characters: prior.knownCharacters.map((c) => ({
        name: c.name,
        is_player: c.is_player === 1,
        status: c.status,
        descriptor_placeholder:
          c.is_player === 1 ? undefined : isDescriptorName(c.name) || undefined,
        description: limit(c.description, 120),
        memorable_facts:
          c.is_player === 1 ? lastNLines(stripFactProvenance(c.memorable_facts), 5) : undefined,
      })),
      known_places: prior.knownPlaces.map((p) => ({
        name: p.name,
        kind: p.kind,
      })),
      dossier: {
        active_threads: prior.dossier.threads
          .filter((t) => t.status === 'active')
          .slice(0, 6)
          .map((t) => ({
            title: t.title,
            kind: t.kind,
            summary: limit(t.summary, 140),
            stakes: limit(t.stakes, 120),
            rewards: limit(t.rewards, 100),
            consequences: limit(t.consequences, 120),
          })),
        open_clues: prior.dossier.clues
          .filter((c) => c.status === 'open' || c.status === 'interpreted')
          .slice(0, 8)
          .map((c) => ({
            title: c.title,
            thread: c.thread_title,
            detail: limit(c.detail, 140),
            implication: limit(c.implication, 120),
            status: c.status,
          })),
        current_objectives: prior.dossier.objectives
          .filter((o) => o.status === 'active' || o.status === 'blocked')
          .slice(0, 8)
          .map((o) => ({
            title: o.title,
            thread: o.thread_title,
            detail: limit(o.detail, 140),
            blocker: limit(o.blocker, 120),
            status: o.status,
          })),
      },
    },
    null,
    2,
  )

  const { object, usage } = await generateObject({
    model: anthropic(ARCHIVIST_MODEL),
    schema: ArchivistPatchSchema,
    messages: [
      {
        role: 'system',
        content: `${loadPrompt('archivist-system')}\n\nPREMISE (context, do not extract from):\n${premise}`,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      },
      {
        role: 'user',
        content: buildArchivistUserContent({
          priorBlock,
          transcript,
          occupancyBlock,
          threadMandate: isOpening || bootstrapDossier,
          placeKindMandate: isOpening,
        }),
      },
    ],
  })

  return { patch: sanitizeArchivistPatch(prior, recent, object), usage }
}

// v0.6.6 correction channel. The player is speaking to the archivist directly
// — not through the narrator. We hand the model: the current world state, the
// last few narrator turns (so corrections like "the car from the last turn"
// can ground), and the player's correction text. The model returns a standard
// ArchivistPatch plus a one-sentence reply. The reply is rendered in the
// inspector; the patch flows through applyArchivistPatch like any other.
//
// Recent turns are included read-only context — the prompt forbids advancing
// scene/time from this channel, but seeing recent narration helps with
// pronoun resolution.
export async function extractCorrectionPatch(
  prior: NarratorWorldState,
  playerText: string,
  recent: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<{ patch: ArchivistPatch; reply: string; usage: LanguageModelUsage }> {
  const trimmed = playerText.trim()
  if (!trimmed) {
    throw new Error('extractCorrectionPatch: playerText is required')
  }

  const transcript =
    recent.length > 0
      ? recent
          .map((t) => `${t.role === 'user' ? 'PLAYER (in narration)' : 'NARRATOR'}: ${t.content}`)
          .join('\n\n')
      : '(no prior narration in this session)'

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
      known_characters: prior.knownCharacters.map((c) => ({
        name: c.name,
        is_player: c.is_player === 1,
        status: c.status,
        description: limit(c.description, 160),
        player_notes: c.player_notes,
      })),
      known_places: prior.knownPlaces.map((p) => ({
        name: p.name,
        kind: p.kind,
        description: limit(p.description, 160),
        player_notes: p.player_notes,
      })),
    },
    null,
    2,
  )

  const { object, usage } = await generateObject({
    model: anthropic(ARCHIVIST_MODEL),
    schema: CorrectionPatchSchema,
    messages: [
      {
        role: 'system',
        content: loadPrompt('archivist-correction'),
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      },
      {
        role: 'user',
        content: [
          'PRIOR STATE:',
          priorBlock,
          '',
          'RECENT NARRATION (read-only context — do not advance scene or time):',
          transcript,
          '',
          'PLAYER MESSAGE (this is what the player is telling you directly):',
          trimmed,
          '',
          'Return the patch + reply.',
        ].join('\n'),
      },
    ],
  })

  const { reply, ...patchWithoutReply } = object
  // Run the patch through the same sanitizer so the correction channel inherits
  // existing scene/place safety rules — and so we cannot accidentally advance
  // the scene through this path even if the model tries.
  const sanitized = sanitizeArchivistPatch(prior, recent, patchWithoutReply as ArchivistPatch)
  // Defense in depth: scene action and current_time are never legitimate
  // outputs from this channel. Strip if present.
  delete sanitized.scene
  delete sanitized.current_time
  return { patch: sanitized, reply: reply.trim(), usage }
}

function lastNLines(value: string | null, n: number): string | null {
  if (!value) return null
  const lines = value.split('\n').filter((line) => line.trim().length > 0)
  return lines.slice(-n).join('\n') || null
}

function limit(value: string | null, max: number): string | null {
  if (!value) return null
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1).trimEnd()}...`
}

// Flat row shapes shared with the inspector + name-resolution. The patch
// application itself (and its SQL) moved to the `apply-archivist-patch` use case
// driven by the active store's ports; these types stay here as the public shape
// importers already consume.
export type PlaceRow = {
  id: number
  name: string
  description: string | null
  kind: string | null
  player_notes: string | null
}

export type CharacterRow = {
  id: number
  name: string
  description: string | null
  is_player: number
  current_place_id: number | null
  memorable_facts: string | null
  status: 'active' | 'inactive' | 'dead'
  active_goal: string | null
  current_attitude: string | null
  observations: string | null
  agency_level: string
  personal_goals: string | null
  current_focus: string | null
  recent_activity: string | null
  private_beliefs: string | null
  reveries: string | null
  relationship_to_player: string | null
  long_term_agenda: string | null
  tool_access: string | null
  appearance_count: number
  last_seen_turn_id: number | null
  last_agent_tick_turn_id: number | null
  player_notes: string | null
  aliases: string | null
  updated_at: string
}

// Apply a validated patch to the world (P4 carve). The deciding logic now lives
// in the `apply-archivist-patch` use case driven by the active store's ports;
// this thin wrapper builds the port bag from the composition root so SQLite
// callers hit SQLite and Mongo callers hit Mongo. Async by mandate (the ports
// are async, the work is wrapped in UnitOfWork). The narrator turn itself was
// committed earlier; this is the structural update that follows.
export function applyArchivistPatch(
  worldId: number,
  narratorTurnId: number,
  patch: ArchivistPatch,
): Promise<void> {
  const { characters, dossierWriter, places, reveries, scenes, timeline, unitOfWork, worlds } =
    getContainer()
  return runApplyArchivistPatch(
    { worldId, turnId: narratorTurnId, patch },
    { characters, dossierWriter, places, reveries, scenes, timeline, unitOfWork, worlds },
  )
}

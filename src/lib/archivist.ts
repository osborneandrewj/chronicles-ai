import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, type LanguageModelUsage } from 'ai'
import { z } from 'zod'

import { isDescriptorName } from '@/lib/character-identity'
import { db } from '@/lib/db'
import { appendFactWithProvenance, stripFactProvenance } from '@/lib/memorable-facts'
import type { PlaceOccupancy } from '@/lib/place-population'
import { loadPrompt } from '@/lib/prompt-files'
import { repointReveries } from '@/lib/reveries'
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
  scene: SceneActionSchema.optional().describe(
    'Default to omitting (equivalent to keep_open). Use close/open only when a scene clearly ends or starts.',
  ),
  scene_context: SceneContextSchema.optional().describe(
    'Compact mood/pace/focus read for narrator prose control. Update when the latest turn clearly changes the scene\'s rhythm or attention.',
  ),
  places: z.array(PlacePatchSchema).optional(),
  characters: z.array(CharacterPatchSchema).optional(),
  story_threads: z.array(StoryThreadPatchSchema).optional(),
  story_clues: z.array(StoryCluePatchSchema).optional(),
  story_objectives: z.array(StoryObjectivePatchSchema).optional(),
  story_resources: z.array(StoryResourcePatchSchema).optional(),
  timeline_events: z.array(TimelineEventPatchSchema).optional(),
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
type CharacterPatch = NonNullable<ArchivistPatch['characters']>[number]
type StoryThreadPatch = NonNullable<ArchivistPatch['story_threads']>[number]
type StoryCluePatch = NonNullable<ArchivistPatch['story_clues']>[number]
type StoryObjectivePatch = NonNullable<ArchivistPatch['story_objectives']>[number]
type StoryResourcePatch = NonNullable<ArchivistPatch['story_resources']>[number]

export const ARCHIVIST_MODEL = 'claude-haiku-4-5-20251001'

export function extractDeterministicPatch(
  prior: NarratorWorldState,
  playerText: string,
  narratorText: string,
): ArchivistPatch | null {
  const destination = extractDestination(playerText)
  if (!destination) return null

  const destinationKey = normalize(destination)
  if (!destinationKey || destinationKey === normalize(prior.currentPlace?.name ?? '')) return null
  if (!narratorAcceptsDestination(destination, narratorText)) return null

  const player = prior.presentCharacters.find((c) => c.is_player === 1)
  if (!player) return null

  return {
    places: [{ name: destination }],
    characters: [{ name: player.name, is_player: true, current_place_name: destination }],
    scene: {
      action: 'open',
      title: `At ${destination}`,
      place_name: destination,
    },
  }
}

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

export function sanitizeArchivistPatch(
  prior: NarratorWorldState,
  recent: Array<{ role: 'user' | 'assistant'; content: string }>,
  patch: ArchivistPatch,
): ArchivistPatch {
  const latestNarrator = [...recent].reverse().find((t) => t.role === 'assistant')?.content ?? ''
  const latestPlayer = [...recent].reverse().find((t) => t.role === 'user')?.content ?? ''
  const blockedPlayerPlaces = new Set<string>()
  const currentPlaceName = prior.currentPlace?.name ?? null

  const sanitized: ArchivistPatch = { ...patch }

  if (
    patch.scene?.action === 'open' &&
    isDifferentPlace(patch.scene.place_name, currentPlaceName) &&
    !supportsPhysicalTransition(prior, patch.scene.place_name, latestPlayer, latestNarrator)
  ) {
    blockedPlayerPlaces.add(canonicalPlaceKey(patch.scene.place_name))
    delete sanitized.scene
  }

  if (patch.characters) {
    const playerNames = new Set(
      prior.knownCharacters.filter((c) => c.is_player === 1).map((c) => canonicalCharacterKey(c.name)),
    )
    const characters = patch.characters
      .map((c) => {
        if (!isPlayerPatch(c, playerNames) || c.current_place_name === undefined) return c

        const requestedPlace = c.current_place_name
        const blocked = blockedPlayerPlaces.has(canonicalPlaceKey(requestedPlace))
        const unsupported =
          isDifferentPlace(requestedPlace, currentPlaceName) &&
          !supportsPhysicalTransition(prior, requestedPlace, latestPlayer, latestNarrator)

        if (!blocked && !unsupported) return c

        const rest = { ...c }
        delete rest.current_place_name
        return rest
      })
      .filter(hasMeaningfulCharacterPatch)

    if (characters.length > 0) {
      sanitized.characters = characters
    } else {
      delete sanitized.characters
    }
  }

  return sanitized
}

function extractDestination(text: string): string | null {
  const patterns = [
    /\b(?:i\s+)?(?:go|walk|run|drive|head|travel)\s+(?:back\s+)?to\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
    /\b(?:i\s+)?(?:return)\s+to\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
    /\b(?:i\s+)?(?:enter|walk into|go into)\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const destination = cleanDestination(match[1])
    if (destination) return destination
  }
  return null
}

function narratorAcceptsDestination(destination: string, narratorText: string): boolean {
  const narrator = normalize(narratorText)
  if (!narrator) return false

  const aliases = destinationMentionAliases(destination)
  const mentionsDestination = aliases.some((alias) => containsAsPhrase(narrator, alias))
  if (!mentionsDestination) return false

  // The narrator has to depict actual relocation, arrival, or parking there.
  // This keeps failed attempts ("the road blocks you") from moving state while
  // still accepting natural prose like "Whitworth buildings rise ahead".
  return hasActualMotion(narrator) || /\b(?:arrive|arrival|park|parking|pull into|pulls into|reach|reaches|come into view|comes into view)\b/.test(narrator)
}

function destinationMentionAliases(destination: string): string[] {
  const normalized = normalize(destination)
  const words = normalized.split(' ').filter(Boolean)
  const generic = new Set([
    'the',
    'a',
    'an',
    'to',
    'at',
    'in',
    'university',
    'college',
    'campus',
    'department',
    'building',
    'buildings',
    'room',
    'office',
    'entrance',
    'main',
  ])
  const distinctive = words.filter((word) => word.length >= 4 && !generic.has(word))
  const aliases = [normalized]

  if (distinctive.length === 1) aliases.push(distinctive[0])
  if (distinctive.length > 1) aliases.push(distinctive.join(' '))

  return [...new Set(aliases.filter((alias) => alias.length > 0))]
}

function cleanDestination(raw: string): string | null {
  const value = raw
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:and|then|so)\b.*$/i, '')
    .trim()
  if (value.length < 3 || value.length > 80) return null
  if (/^(sleep|bed|work|home)$/i.test(value)) return null
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isPlayerPatch(c: CharacterPatch, playerNames: Set<string>): boolean {
  return c.is_player === true || playerNames.has(canonicalCharacterKey(c.name))
}

function hasMeaningfulCharacterPatch(c: CharacterPatch): boolean {
  return (
    c.description !== undefined ||
    c.current_place_name !== undefined ||
    c.memorable_facts_append !== undefined ||
    c.status !== undefined ||
    c.active_goal !== undefined ||
    c.current_attitude !== undefined ||
    c.observations_append !== undefined ||
    c.player_notes_append !== undefined ||
    (c.aliases !== undefined && c.aliases.length > 0) ||
    c.reveals_name_of !== undefined
  )
}

function isDifferentPlace(requestedName: string, currentName: string | null): boolean {
  if (!currentName) return true
  return canonicalPlaceKey(requestedName) !== canonicalPlaceKey(currentName)
}

function supportsPhysicalTransition(
  prior: NarratorWorldState,
  requestedName: string,
  latestPlayer: string,
  latestNarrator: string,
): boolean {
  const aliases = placeAliasKeys(prior, requestedName)
  if (aliases.length === 0) return false

  const narrator = normalize(latestNarrator)
  const player = normalize(latestPlayer)
  const hasNarratedDestination = aliases.some((alias) => containsAsPhrase(narrator, alias))
  if (!hasNarratedDestination) return false

  return aliases.some((alias) => {
    const narratorWindow = windowAroundPhrase(narrator, alias, 28)
    if (hasActualMotion(narratorWindow)) return true

    const playerWindow = windowAroundPhrase(player, alias, 18)
    return hasActualMotion(playerWindow) && hasActualMotion(narrator)
  })
}

function placeAliasKeys(prior: NarratorWorldState, requestedName: string): string[] {
  const requested = canonicalPlaceKey(requestedName)
  const known = prior.knownPlaces.find((p) => canonicalPlaceKey(p.name) === requested)
  const source = `${requestedName} ${known?.description ?? ''} ${known?.kind ?? ''}`
  const aliases = [requested]

  if (/\b(?:apartment|bedroom|home|house|kitchen|residence)\b/i.test(source)) {
    aliases.push('home', 'house')
  }

  return [...new Set(aliases.filter((alias) => alias.length > 0))]
}

function windowAroundPhrase(value: string, phrase: string, radiusWords: number): string {
  const words = value.split(' ').filter((word) => word.length > 0)
  const phraseWords = phrase.split(' ').filter((word) => word.length > 0)
  if (words.length === 0 || phraseWords.length === 0) return ''

  const idx = words.findIndex((_, i) =>
    phraseWords.every((word, offset) => words[i + offset] === word),
  )
  if (idx === -1) return ''

  const start = Math.max(0, idx - radiusWords)
  const end = Math.min(words.length, idx + phraseWords.length + radiusWords)
  return words.slice(start, end).join(' ')
}

function hasActualMotion(value: string): boolean {
  if (!value) return false
  if (/\b(?:think|thinking|thought|remember|remembering|memory|imagine|imagining|wish|wishing|wonder|wondering)\b/.test(value)) {
    return false
  }

  return (
    /\byou (?:go|goes|walk|walks|run|runs|drive|drives|head|heads|travel|travels|return|returns|enter|enters|arrive|arrives|follow|follows|leave|leaves|step|steps|cross|crosses|climb|climbs|move|moves|land|lands|wake|wakes|park|parks|pull|pulls)\b/.test(value) ||
    /\byou make your way\b/.test(value) ||
    /\byou (?:are|re) (?:led|taken|carried|brought|ushered|escorted|shown)\b/.test(value) ||
    /\b(?:leads|takes|carries|brings|ushers|escorts|shows) you\b/.test(value) ||
    /\b(?:when|by the time) you arrive\b/.test(value) ||
    /\bscene (?:cuts|shifts)\b/.test(value)
  )
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
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

// Prepared statements for patch application. All writes happen inside the
// transaction opened by applyArchivistPatch — better-sqlite3's db.transaction
// composes prepared statements implicitly.
type PlaceRow = {
  id: number
  name: string
  description: string | null
  kind: string | null
  player_notes: string | null
}

type CharacterRow = {
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

const listPlacesForWorldStmt = db.prepare<[number]>(
  'SELECT id, name, description, kind, player_notes FROM places WHERE world_id = ? ORDER BY id ASC',
)
const currentPlaceForWorldStmt = db.prepare<[number]>(
  `SELECT p.id, p.name, p.description, p.kind, p.player_notes
   FROM worlds w
   JOIN scenes s ON s.id = w.current_scene_id
   JOIN places p ON p.id = s.place_id
   WHERE w.id = ?`,
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
const mergePlaceStmt = db.prepare<[string | null, string | null, number]>(
  `UPDATE places SET
     description = ?,
     kind        = ?,
     updated_at  = datetime('now')
   WHERE id = ?`,
)
const moveCharactersToPlaceStmt = db.prepare<[number, number]>(
  'UPDATE characters SET current_place_id = ? WHERE current_place_id = ?',
)
const moveScenesToPlaceStmt = db.prepare<[number, number]>(
  `UPDATE scenes SET place_id = ?, updated_at = datetime('now') WHERE place_id = ?`,
)
const deletePlaceStmt = db.prepare<[number]>('DELETE FROM places WHERE id = ?')

const listCharactersForWorldStmt = db.prepare<[number]>(
  `SELECT id, name, description, is_player, current_place_id, memorable_facts,
          status, active_goal, current_attitude, observations, agency_level,
          personal_goals, current_focus, recent_activity,
          private_beliefs, reveries, relationship_to_player, long_term_agenda, tool_access, appearance_count,
          last_seen_turn_id, last_agent_tick_turn_id, player_notes, aliases, updated_at
   FROM characters
   WHERE world_id = ?
   ORDER BY id ASC`,
)
// Exact case-insensitive lookup. Distinct from resolveCharacter()'s soft-match
// path — used by the correction channel's `aliases` field where the player has
// explicitly told us two existing rows are the same person and the names
// would not otherwise overlap (e.g. "Bob" + "Robert").
const findCharacterByExactLowerNameStmt = db.prepare<[number, string]>(
  `SELECT id, name, description, is_player, current_place_id, memorable_facts,
          status, active_goal, current_attitude, observations, agency_level,
          personal_goals, current_focus, recent_activity,
          private_beliefs, reveries, relationship_to_player, long_term_agenda, tool_access, appearance_count,
          last_seen_turn_id, last_agent_tick_turn_id, player_notes, aliases, updated_at
   FROM characters
   WHERE world_id = ? AND lower(name) = lower(?)`,
)
// player_notes is single-author (the player, via the correction channel) and
// append-only by spec — a new line is added per correction, separated by
// newlines, no provenance tag. Lines persist forever in v0.6.6; per-line
// edit/delete is v0.7+.
const appendCharacterPlayerNotesStmt = db.prepare<[string, string, number]>(
  `UPDATE characters
   SET player_notes = CASE
       WHEN player_notes IS NULL OR length(trim(player_notes)) = 0 THEN ?
       ELSE player_notes || char(10) || ?
     END,
     updated_at = datetime('now')
   WHERE id = ?`,
)
const appendPlacePlayerNotesStmt = db.prepare<[string, string, number]>(
  `UPDATE places
   SET player_notes = CASE
       WHEN player_notes IS NULL OR length(trim(player_notes)) = 0 THEN ?
       ELSE player_notes || char(10) || ?
     END,
     updated_at = datetime('now')
   WHERE id = ?`,
)
const insertCharacterStmt = db.prepare<
  [
    number,
    string,
    string | null,
    number,
    number | null,
    string | null,
    string,
    string | null,
    string | null,
    string | null,
  ]
>(
  `INSERT INTO characters (world_id, name, description, is_player, current_place_id,
                           memorable_facts, status, active_goal, current_attitude, observations)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
// Observations are append-only — like memorable_facts, never cleared by patch.
// COALESCE pattern: pass null to leave unchanged, or the new fully-built value
// to overwrite. The appender builds the next value (existing + new line).
const setObservationsStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET observations = COALESCE(?, observations), updated_at = datetime('now')
   WHERE id = ?`,
)
const mergeCharacterStmt = db.prepare<
  [
    string,
    string | null,
    number | null,
    string | null,
    string,
    string | null,
    string | null,
    string | null,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    number,
    number | null,
    number | null,
    string | null,
    string | null,
    number,
  ]
>(
  `UPDATE characters SET
     name                    = ?,
     description             = ?,
     current_place_id        = ?,
     memorable_facts         = ?,
     status                  = ?,
     active_goal             = ?,
     current_attitude        = ?,
     observations            = ?,
     agency_level            = ?,
     personal_goals          = ?,
     current_focus           = ?,
     recent_activity         = ?,
     private_beliefs         = ?,
     relationship_to_player  = ?,
     long_term_agenda        = ?,
     tool_access             = ?,
     appearance_count        = ?,
     last_seen_turn_id       = ?,
     last_agent_tick_turn_id = ?,
     player_notes            = ?,
     aliases                 = ?,
     updated_at              = datetime('now')
   WHERE id = ?`,
)
const deleteCharacterStmt = db.prepare<[number]>('DELETE FROM characters WHERE id = ?')
// Used by mergeCharacters when the caller passes a canonicalName different
// from the kept row's existing name (alias-merge canonicalisation). Bumps
// updated_at so subsequent freshest() comparisons see the new mtime.
const setCharacterAliasesStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET aliases = ?, updated_at = datetime('now') WHERE id = ?`,
)
const renameCharacterStmt = db.prepare<[string, number]>(
  `UPDATE characters SET name = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setPlayersPlaceStmt = db.prepare<[number, number]>(
  `UPDATE characters SET current_place_id = ?, updated_at = datetime('now')
   WHERE world_id = ? AND is_player = 1`,
)

const closeSceneStmt = db.prepare<[string, number, number]>(
  `UPDATE scenes SET status = 'completed', summary = ?, closed_at_turn = ?, updated_at = datetime('now')
   WHERE id = ?`,
)
const maxSceneNumberStmt = db.prepare<[number]>(
  'SELECT COALESCE(MAX(scene_number), 0) as n FROM scenes WHERE world_id = ?',
)
const insertSceneStmt = db.prepare<[number, number, string, number, number]>(
  `INSERT INTO scenes (world_id, place_id, title, scene_number, opened_at_turn, updated_at)
   VALUES (?, ?, ?, ?, ?, datetime('now')) RETURNING id`,
)
const setCurrentSceneStmt = db.prepare<[number, number]>(
  'UPDATE worlds SET current_scene_id = ? WHERE id = ?',
)
const updateSceneContextStmt = db.prepare<
  [string | null, string | null, string | null, number]
>(
  `UPDATE scenes SET
     scene_mood = COALESCE(?, scene_mood),
     pace       = COALESCE(?, pace),
     focus      = COALESCE(?, focus),
     updated_at = datetime('now')
   WHERE id = ?`,
)
const setWorldTimeStmt = db.prepare<[string, number]>(
  'UPDATE worlds SET world_time = ? WHERE id = ?',
)
const currentSceneIdStmt = db.prepare<[number]>(
  'SELECT current_scene_id FROM worlds WHERE id = ?',
)
const autoCloseSceneStmt = db.prepare<[number, number]>(
  `UPDATE scenes SET status = 'completed', closed_at_turn = ?, updated_at = datetime('now')
   WHERE id = ? AND status = 'active'`,
)
// v0.6.10 scene-transition invariant reads: the active scene's place and the
// player row's place. currentSceneIdStmt returns only the scene id, so the
// scene place is a separate join; the player place is a direct lookup.
const currentScenePlaceIdStmt = db.prepare<[number]>(
  `SELECT s.place_id FROM worlds w JOIN scenes s ON s.id = w.current_scene_id WHERE w.id = ?`,
)
const playerPlaceIdStmt = db.prepare<[number]>(
  'SELECT current_place_id FROM characters WHERE world_id = ? AND is_player = 1',
)
const placeNameByIdStmt = db.prepare<[number]>('SELECT name FROM places WHERE id = ?')

type StoryThreadRow = {
  id: number
  title: string
  kind: StoryThreadPatch['kind']
  status: StoryThreadPatch['status']
  summary: string | null
  stakes: string | null
  rewards: string | null
  consequences: string | null
  hidden: string | null
  relevance_tags_json: string
}

const storyThreadByTitleStmt = db.prepare<[number, string]>(
  `SELECT id, title, kind, status, summary, stakes, rewards, consequences, hidden, relevance_tags_json
   FROM story_threads
   WHERE world_id = ? AND lower(title) = lower(?)`,
)
const insertStoryThreadStmt = db.prepare<
  [
    number,
    string,
    string,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string,
    number | null,
  ]
>(
  `INSERT INTO story_threads
     (world_id, title, kind, status, summary, stakes, rewards, consequences, hidden, relevance_tags_json, source_turn_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   RETURNING id`,
)
// relevance_tags_json uses a plain assignment (not COALESCE like the
// nullable fields above): the caller computes relevanceTagsJson to a
// non-null value — new tags when the patch supplies them, else the
// existing row's tags — so the JS layer owns the preserve-merge.
const updateStoryThreadStmt = db.prepare<
  [
    string,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string,
    number | null,
    number,
  ]
>(
  `UPDATE story_threads SET
     kind                = ?,
     status              = ?,
     summary             = COALESCE(?, summary),
     stakes              = COALESCE(?, stakes),
     rewards             = COALESCE(?, rewards),
     consequences        = COALESCE(?, consequences),
     hidden              = COALESCE(?, hidden),
     relevance_tags_json = ?,
     resolved_turn_id    = COALESCE(?, resolved_turn_id),
     updated_at          = datetime('now')
   WHERE id = ?`,
)
const storyClueByTitleStmt = db.prepare<[number, string]>(
  `SELECT id FROM story_clues WHERE world_id = ? AND lower(title) = lower(?)`,
)
const insertStoryClueStmt = db.prepare<
  [number, number | null, string, string | null, string | null, string, number | null]
>(
  `INSERT INTO story_clues (world_id, thread_id, title, detail, implication, status, source_turn_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const updateStoryClueStmt = db.prepare<
  [number | null, string | null, string | null, string, number]
>(
  `UPDATE story_clues SET
     thread_id   = COALESCE(?, thread_id),
     detail      = COALESCE(?, detail),
     implication = COALESCE(?, implication),
     status      = ?,
     updated_at  = datetime('now')
   WHERE id = ?`,
)
const storyObjectiveByTitleStmt = db.prepare<[number, string]>(
  `SELECT id FROM story_objectives WHERE world_id = ? AND lower(title) = lower(?)`,
)
const insertStoryObjectiveStmt = db.prepare<
  [number, number | null, string, string, string | null, string | null, number | null]
>(
  `INSERT INTO story_objectives (world_id, thread_id, title, status, detail, blocker, source_turn_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const updateStoryObjectiveStmt = db.prepare<
  [number | null, string, string | null, string | null, number | null, number]
>(
  `UPDATE story_objectives SET
     thread_id          = COALESCE(?, thread_id),
     status             = ?,
     detail             = COALESCE(?, detail),
     blocker            = COALESCE(?, blocker),
     completed_turn_id  = COALESCE(?, completed_turn_id),
     updated_at         = datetime('now')
   WHERE id = ?`,
)
const storyResourceByNameStmt = db.prepare<[number, string]>(
  `SELECT id FROM story_resources WHERE world_id = ? AND lower(name) = lower(?)`,
)
const insertStoryResourceStmt = db.prepare<
  [number, number | null, string, string | null, string | null, string | null, number | null]
>(
  `INSERT INTO story_resources (world_id, owner_character_id, name, kind, status, detail, source_turn_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const updateStoryResourceStmt = db.prepare<
  [number | null, string | null, string | null, string | null, number]
>(
  `UPDATE story_resources SET
     owner_character_id = COALESCE(?, owner_character_id),
     kind               = COALESCE(?, kind),
     status             = COALESCE(?, status),
     detail             = COALESCE(?, detail),
     updated_at         = datetime('now')
   WHERE id = ?`,
)
const insertTimelineEventStmt = db.prepare<
  [number, number, number | null, string | null, string, string, number]
>(
  `INSERT INTO timeline_events (world_id, turn_id, thread_id, world_time, title, summary, importance)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)

const CHARACTER_TITLE_WORDS = new Set([
  'captain',
  'capt',
  'chief',
  'doctor',
  'dr',
  'father',
  'general',
  'inquisitor',
  'lieutenant',
  'lt',
  'major',
  'miss',
  'mister',
  'mr',
  'mrs',
  'ms',
  'professor',
  'prof',
  'sergeant',
  'sgt',
])

const DESCRIPTIVE_CHARACTER_WORDS = new Set([
  'figure',
  'man',
  'shadow',
  'stranger',
  'woman',
])

const PLACE_DETAIL_WORDS = new Set([
  'apartment',
  'bedroom',
  'breakroom',
  'building',
  'bullpen',
  'campus',
  'fifth',
  'first',
  'floor',
  'food',
  'fourth',
  'front',
  'garage',
  'home',
  'house',
  'inside',
  'kitchen',
  'lot',
  'office',
  'room',
  'second',
  'shop',
  'sixth',
  'street',
  'third',
  'truck',
])

const GENERIC_ROOM_KEYS = new Set([
  'attic',
  'basement',
  'bathroom',
  'bedroom',
  'garage',
  'hallway',
  'kitchen',
  'living room',
  'office',
])

function upsertPlace(
  worldId: number,
  name: string,
  description: string | undefined,
  kind: string | undefined,
): number {
  const existing = resolvePlace(worldId, name)
  if (existing) {
    if (description !== undefined || kind !== undefined) {
      updatePlaceStmt.run(description ?? null, kind ?? null, existing.id)
    }
    return existing.id
  }
  const row = insertPlaceStmt.get(worldId, name, description ?? null, kind ?? null) as { id: number }
  return row.id
}

function resolvePlace(worldId: number, requestedName: string): PlaceRow | undefined {
  const rows = listPlacesForWorldStmt.all(worldId) as PlaceRow[]
  const currentPlace = currentPlaceForWorldStmt.get(worldId) as PlaceRow | undefined
  const matches = rows.filter((row) => placesMatch(requestedName, row.name, currentPlace))
  if (matches.length === 0) return undefined
  const target = matches[0]
  for (const duplicate of matches.slice(1)) {
    mergePlaces(target, duplicate)
  }
  return target
}

function mergePlaces(target: PlaceRow, source: PlaceRow): void {
  if (target.id === source.id) return
  const description = chooseLonger(target.description, source.description)
  const kind = target.kind ?? source.kind
  moveCharactersToPlaceStmt.run(target.id, source.id)
  moveScenesToPlaceStmt.run(target.id, source.id)
  deletePlaceStmt.run(source.id)
  mergePlaceStmt.run(description, kind, target.id)
  target.description = description
  target.kind = kind
}

function placesMatch(requestedName: string, existingName: string, currentPlace: PlaceRow | undefined): boolean {
  const requested = canonicalPlaceKey(requestedName)
  const existing = canonicalPlaceKey(existingName)
  if (!requested || !existing) return false
  if (requested === existing) return true
  if (containsAsPhrase(requested, existing) || containsAsPhrase(existing, requested)) {
    const requestedTokens = requested.split(' ')
    const existingTokens = existing.split(' ')
    const extraTokens =
      requestedTokens.length > existingTokens.length
        ? requestedTokens.filter((token) => !existingTokens.includes(token))
        : existingTokens.filter((token) => !requestedTokens.includes(token))
    return extraTokens.every((token) => PLACE_DETAIL_WORDS.has(token))
  }
  if (GENERIC_ROOM_KEYS.has(requested) && currentPlace?.id) {
    return currentPlace.name === existingName && isResidentialPlace(currentPlace)
  }
  return false
}

function canonicalPlaceKey(value: string): string {
  const withoutRouteNoise = value
    .replace(/\([^)]*\ben route\b[^)]*\)/gi, '')
    .replace(/\s+[-–—]\s+.*\ben route\b.*$/i, '')
    .replace(/\b(?:not yet at|on the way to|headed to)\b/gi, '')
    .replace(/\ben route to\s+/gi, '')
  const commaHead = withoutRouteNoise.split(',')[0] ?? withoutRouteNoise
  const dashHead = commaHead.split(/\s+[-–—]\s+/)[0] ?? commaHead
  return normalize(dashHead).replace(/^(?:the|his|her|their|our)\s+/, '')
}

function isResidentialPlace(place: PlaceRow): boolean {
  return /\b(?:apartment|bedroom|home|house|kitchen|residence)\b/i.test(
    `${place.name} ${place.description ?? ''} ${place.kind ?? ''}`,
  )
}

function resolveCharacter(worldId: number, requestedName: string): CharacterRow | undefined {
  const rows = listCharactersForWorldStmt.all(worldId) as CharacterRow[]
  // Aliases beat fuzzy match: if any row claims this descriptor as an
  // alias, treat that row as canonical regardless of fuzzy-token rules.
  // This is what lets the archivist deduplicate descriptor-only figures
  // ("the man at the gyro van" → existing "Man in the Canvas Vest" row).
  const aliasHit = findCharacterByNameOrAlias(rows, requestedName)
  if (aliasHit) return aliasHit
  const matches = rows.filter((row) => charactersMatch(requestedName, row.name))
  if (matches.length === 0) return undefined

  const exactMatches = matches.filter(
    (row) => canonicalCharacterKey(row.name) === canonicalCharacterKey(requestedName),
  )
  if (exactMatches.length === 1 && matches.length === 1) return exactMatches[0]

  const nonPlayerMatches = matches.filter((row) => row.is_player === 0)
  if (nonPlayerMatches.length !== matches.length) {
    return exactMatches.find((row) => row.is_player === 1) ?? exactMatches[0]
  }
  if (isAmbiguousCharacterMatch(requestedName, nonPlayerMatches)) {
    return exactMatches.length === 1 ? exactMatches[0] : undefined
  }

  const target = nonPlayerMatches[0]
  for (const duplicate of nonPlayerMatches.slice(1)) {
    mergeCharacters(target, duplicate)
  }
  return target
}

// For scalar single-valued fields, the older "target-first" rule discarded the
// merge source's value any time the target had one — even a stale one. That
// silently lost fresh state (active_goal, current_focus, current_attitude,
// current_place_id) whenever the older row happened to be the merge target.
// Now: pick whichever input value comes from the more recently updated row;
// non-null still beats null, ties go to target. Row-level updated_at is a
// coarse proxy for per-field freshness but matches user intuition (the row the
// system has been writing to is the live one).
function freshest<T>(
  target: CharacterRow,
  source: CharacterRow,
  pick: (row: CharacterRow) => T | null,
): T | null {
  const t = pick(target)
  const s = pick(source)
  if (t === null || t === undefined) return s ?? null
  if (s === null || s === undefined) return t
  return source.updated_at > target.updated_at ? s : t
}

// Run before resolveCharacter so the canonical name from the player's
// correction wins. Looks up canonical + each alias by exact (lower)case name
// — never via soft-match, because the player has *explicitly* asserted these
// rows are the same person and the names may not overlap (Bob / Robert) or
// may overlap-but-with-different-canonical-name (Jordana / Jordana Osborne).
// If canonical doesn't exist yet but an alias does, the alias row is renamed
// and promoted to be the canonical for subsequent iterations — cheaper than
// inserting a new row and losing the alias's history.
function runAliasMerges(
  worldId: number,
  canonicalName: string,
  aliases: string[],
): void {
  let canonical =
    (findCharacterByExactLowerNameStmt.get(worldId, canonicalName) as CharacterRow | undefined) ??
    undefined
  for (const aliasRaw of aliases) {
    const alias = aliasRaw.trim()
    if (!alias) continue
    if (canonicalCharacterKey(alias) === canonicalCharacterKey(canonicalName)) continue
    const aliasRow =
      (findCharacterByExactLowerNameStmt.get(worldId, alias) as CharacterRow | undefined) ??
      undefined
    if (!aliasRow) continue
    if (canonical) {
      if (canonical.id === aliasRow.id) continue
      // Never merge across the player/NPC boundary: a player-asserted alias
      // must not silently rewrite the protagonist row, and the protagonist's
      // identity is not editable through this channel.
      if (canonical.is_player !== aliasRow.is_player) continue
      mergeCharacters(canonical, aliasRow, canonicalName)
    } else {
      // No canonical row yet. Promote the alias by renaming it.
      renameCharacterStmt.run(canonicalName, aliasRow.id)
      aliasRow.name = canonicalName
      canonical = aliasRow
    }
  }
}

function mergeCharacters(
  target: CharacterRow,
  source: CharacterRow,
  canonicalName?: string,
): void {
  if (target.id === source.id) {
    if (canonicalName && canonicalName !== target.name) {
      renameCharacterStmt.run(canonicalName, target.id)
      target.name = canonicalName
    }
    return
  }
  const finalName = canonicalName ?? target.name
  // The losing row's display name and any aliases it had become aliases on
  // the kept row. Skip the name we're keeping as canonical (no self-aliases).
  const mergedAliasesRaw = mergeLineBlocks(target.aliases, source.aliases)
  const inferredAlias = source.name && source.name !== finalName ? source.name : null
  const carriedAlias =
    target.name && target.name !== finalName ? target.name : null
  const aliasesWithCarry = [mergedAliasesRaw, inferredAlias, carriedAlias]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('\n')
  const mergedAliases = filterAliasesAgainstName(aliasesWithCarry, finalName)
  const merged = {
    name: finalName,
    description: chooseLonger(target.description, source.description),
    current_place_id: freshest(target, source, (r) => r.current_place_id),
    memorable_facts: mergeLineBlocks(target.memorable_facts, source.memorable_facts),
    status: strongestStatus(target.status, source.status),
    active_goal: freshest(target, source, (r) => r.active_goal),
    current_attitude: freshest(target, source, (r) => r.current_attitude),
    observations: mergeLineBlocks(target.observations, source.observations),
    agency_level: strongestAgencyLevel(target.agency_level, source.agency_level),
    personal_goals: mergeLineBlocks(target.personal_goals, source.personal_goals),
    current_focus: freshest(target, source, (r) => r.current_focus),
    recent_activity: mergeLineBlocks(target.recent_activity, source.recent_activity),
    private_beliefs: mergeLineBlocks(target.private_beliefs, source.private_beliefs),
    relationship_to_player: freshest(target, source, (r) => r.relationship_to_player),
    long_term_agenda: mergeLineBlocks(target.long_term_agenda, source.long_term_agenda),
    tool_access: mergeLineBlocks(target.tool_access, source.tool_access),
    appearance_count: Math.max(target.appearance_count, source.appearance_count),
    last_seen_turn_id: maxNullable(target.last_seen_turn_id, source.last_seen_turn_id),
    last_agent_tick_turn_id: maxNullable(
      target.last_agent_tick_turn_id,
      source.last_agent_tick_turn_id,
    ),
    player_notes: mergeLineBlocks(target.player_notes, source.player_notes),
    aliases: mergedAliases,
  }
  // Re-point reverie ROWS onto the surviving target BEFORE deleting the source.
  // npc_reveries.character_id has ON DELETE CASCADE, so deleting the source
  // first would drop its reveries before we could carry them over. The dormant
  // characters.reveries text column is intentionally no longer merged here.
  repointReveries(source.id, target.id)
  deleteCharacterStmt.run(source.id)
  mergeCharacterStmt.run(
    merged.name,
    merged.description,
    merged.current_place_id,
    merged.memorable_facts,
    merged.status,
    merged.active_goal,
    merged.current_attitude,
    merged.observations,
    merged.agency_level,
    merged.personal_goals,
    merged.current_focus,
    merged.recent_activity,
    merged.private_beliefs,
    merged.relationship_to_player,
    merged.long_term_agenda,
    merged.tool_access,
    merged.appearance_count,
    merged.last_seen_turn_id,
    merged.last_agent_tick_turn_id,
    merged.player_notes,
    merged.aliases,
    target.id,
  )
  Object.assign(target, merged)
  // updated_at is bumped server-side by the merge; refresh the in-memory
  // copy so subsequent comparisons in this transaction stay correct.
  target.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function charactersMatch(requestedName: string, existingName: string): boolean {
  const requested = canonicalCharacterKey(requestedName)
  const existing = canonicalCharacterKey(existingName)
  if (!requested || !existing) return false
  if (requested === existing) return true
  if (isDescriptiveCharacterName(requestedName) || isDescriptiveCharacterName(existingName)) return false

  const requestedTokens = characterTokens(requestedName)
  const existingTokens = characterTokens(existingName)
  if (requestedTokens.length === 0 || existingTokens.length === 0) return false

  const shorter = requestedTokens.length <= existingTokens.length ? requestedTokens : existingTokens
  const longer = requestedTokens.length <= existingTokens.length ? existingTokens : requestedTokens
  if (shorter.length > 1) return shorter.every((token) => longer.includes(token))

  const token = shorter[0]
  if (token.length < 4) return false
  return longer.includes(token)
}

function isAmbiguousCharacterMatch(requestedName: string, matches: CharacterRow[]): boolean {
  const requestedTokens = characterTokens(requestedName)
  if (requestedTokens.length !== 1) return false
  const token = requestedTokens[0]
  return matches.filter((row) => characterTokens(row.name).includes(token)).length > 1
}

function canonicalCharacterKey(value: string): string {
  return characterTokens(value).join(' ')
}

function characterTokens(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 0 && !CHARACTER_TITLE_WORDS.has(token))
}

function isDescriptiveCharacterName(value: string): boolean {
  const tokens = characterTokens(value)
  return (
    normalize(value).startsWith('the ') ||
    tokens.some((token) => DESCRIPTIVE_CHARACTER_WORDS.has(token))
  )
}

function containsAsPhrase(value: string, phrase: string): boolean {
  return ` ${value} `.includes(` ${phrase} `)
}

function chooseLonger(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return b.length > a.length ? b : a
}

// Aliases are stored as a newline-separated list. This helper drops any line
// whose canonical key matches the canonical name itself (a row's canonical
// name is never simultaneously one of its aliases) plus exact duplicate
// lines, and returns null when the resulting list is empty.
function filterAliasesAgainstName(raw: string | null, name: string): string | null {
  if (!raw) return null
  const nameKey = canonicalCharacterKey(name)
  const seen = new Set<string>()
  const kept: string[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const key = canonicalCharacterKey(trimmed)
    if (!key || key === nameKey) continue
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(trimmed)
  }
  return kept.length > 0 ? kept.join('\n') : null
}

// Alias-aware lookup. Returns the existing row whose canonical name matches
// the requested name, OR whose aliases list contains a line whose canonical
// key matches. Used by resolveCharacter() so the archivist can record "the
// man at the gyro van" as an alias on "the man in the canvas vest" and
// subsequent prose referencing either descriptor lands on the same row.
function findCharacterByNameOrAlias(
  rows: CharacterRow[],
  requestedName: string,
): CharacterRow | null {
  const requestedKey = canonicalCharacterKey(requestedName)
  if (!requestedKey) return null
  for (const row of rows) {
    if (canonicalCharacterKey(row.name) === requestedKey) return row
    if (!row.aliases) continue
    for (const line of row.aliases.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (canonicalCharacterKey(trimmed) === requestedKey) return row
    }
  }
  return null
}

function mergeLineBlocks(a: string | null, b: string | null): string | null {
  const lines = [...(a?.split('\n') ?? []), ...(b?.split('\n') ?? [])]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return null
  return [...new Set(lines)].join('\n')
}

function strongestStatus(
  a: CharacterRow['status'],
  b: CharacterRow['status'],
): CharacterRow['status'] {
  const rank = { inactive: 0, active: 1, dead: 2 }
  return rank[b] > rank[a] ? b : a
}

function strongestAgencyLevel(a: string, b: string): string {
  const rank: Record<string, number> = { npc: 0, dormant: 1, distant: 2, nearby: 3, local: 4 }
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

function upsertStoryThread(
  worldId: number,
  narratorTurnId: number,
  patch: StoryThreadPatch,
): number {
  const existing = storyThreadByTitleStmt.get(worldId, patch.title) as StoryThreadRow | undefined
  const kind = patch.kind ?? existing?.kind ?? 'mystery'
  const status = patch.status ?? existing?.status ?? 'active'
  const resolvedTurnId =
    status === 'resolved' || status === 'failed' ? narratorTurnId : null
  const relevanceTagsJson = patch.relevance_tags
    ? JSON.stringify(patch.relevance_tags)
    : (existing?.relevance_tags_json ?? '[]')

  if (existing) {
    updateStoryThreadStmt.run(
      kind,
      status,
      patch.summary ?? null,
      patch.stakes ?? null,
      patch.rewards ?? null,
      patch.consequences ?? null,
      patch.hidden ?? null,
      relevanceTagsJson,
      resolvedTurnId,
      existing.id,
    )
    return existing.id
  }

  const row = insertStoryThreadStmt.get(
    worldId,
    patch.title,
    kind,
    status,
    patch.summary ?? null,
    patch.stakes ?? null,
    patch.rewards ?? null,
    patch.consequences ?? null,
    patch.hidden ?? null,
    relevanceTagsJson,
    narratorTurnId,
  ) as { id: number }
  return row.id
}

function resolveStoryThreadId(
  worldId: number,
  narratorTurnId: number,
  threadTitle: string | undefined,
  options: { preferQuest?: boolean } = {},
): number | null {
  if (!threadTitle) return null
  // A thread that carries playable objectives is a mission — surface it as a
  // `quest` rather than leaving it under the catch-all `mystery` default the
  // model reaches for. We only upgrade the soft kinds (`mystery`/`background`):
  // a deliberately-set `threat` or `relationship` keeps its kind even when an
  // objective attaches (a hostage standoff is a threat the player works, not a
  // quest). New threads spawned by an objective reference open as quests.
  if (options.preferQuest) {
    const existing = storyThreadByTitleStmt.get(worldId, threadTitle) as
      | StoryThreadRow
      | undefined
    if (!existing || existing.kind === 'mystery' || existing.kind === 'background') {
      return upsertStoryThread(worldId, narratorTurnId, {
        title: threadTitle,
        kind: 'quest',
        status: 'active',
      })
    }
  }
  return upsertStoryThread(worldId, narratorTurnId, { title: threadTitle, status: 'active' })
}

function upsertStoryClue(
  worldId: number,
  narratorTurnId: number,
  patch: StoryCluePatch,
): void {
  const threadId = resolveStoryThreadId(worldId, narratorTurnId, patch.thread_title)
  const existing = storyClueByTitleStmt.get(worldId, patch.title) as { id: number } | undefined
  const status = patch.status ?? 'open'
  if (existing) {
    updateStoryClueStmt.run(
      threadId,
      patch.detail ?? null,
      patch.implication ?? null,
      status,
      existing.id,
    )
    return
  }
  insertStoryClueStmt.run(
    worldId,
    threadId,
    patch.title,
    patch.detail ?? null,
    patch.implication ?? null,
    status,
    narratorTurnId,
  )
}

function upsertStoryObjective(
  worldId: number,
  narratorTurnId: number,
  patch: StoryObjectivePatch,
): void {
  const threadId = resolveStoryThreadId(worldId, narratorTurnId, patch.thread_title, {
    preferQuest: true,
  })
  const existing = storyObjectiveByTitleStmt.get(worldId, patch.title) as { id: number } | undefined
  const status = patch.status ?? 'active'
  const completedTurnId =
    status === 'completed' || status === 'failed' ? narratorTurnId : null
  if (existing) {
    updateStoryObjectiveStmt.run(
      threadId,
      status,
      patch.detail ?? null,
      patch.blocker ?? null,
      completedTurnId,
      existing.id,
    )
    return
  }
  insertStoryObjectiveStmt.run(
    worldId,
    threadId,
    patch.title,
    status,
    patch.detail ?? null,
    patch.blocker ?? null,
    narratorTurnId,
  )
}

function upsertStoryResource(
  worldId: number,
  narratorTurnId: number,
  patch: StoryResourcePatch,
): void {
  const ownerId = patch.owner_name ? resolveCharacter(worldId, patch.owner_name)?.id ?? null : null
  const existing = storyResourceByNameStmt.get(worldId, patch.name) as { id: number } | undefined
  if (existing) {
    updateStoryResourceStmt.run(
      ownerId,
      patch.kind ?? null,
      patch.status ?? null,
      patch.detail ?? null,
      existing.id,
    )
    return
  }
  insertStoryResourceStmt.run(
    worldId,
    ownerId,
    patch.name,
    patch.kind ?? null,
    patch.status ?? null,
    patch.detail ?? null,
    narratorTurnId,
  )
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
    // v0.6.10 scene-transition invariant state, populated in the character loop
    // (step 2) and consumed after the scene-action step (step 3b). Keyed off
    // which NPCs the patch RELOCATES this turn — the reliable signal that the
    // protagonist travelled even when the archivist drops the player's own
    // `current_place_name` (the exact Call-In Case failure).
    const relocatedNpcByPlace = new Map<number, string[]>()
    let playerPlaceFromPatch: number | null = null

    // 1. Places first, so character.current_place_name and scene.open.place_name
    //    can resolve to ids in the same patch.
    if (patch.places) {
      for (const p of patch.places) {
        const placeId = upsertPlace(worldId, p.name, p.description, p.kind)
        // player_notes_append is the correction-channel field: a single short
        // sentence appended on its own line to existing player_notes. The
        // narrator-extraction prompt is told never to set this; if it leaks
        // through anyway, the result is just a player_notes line — not
        // catastrophic, but worth tightening the prompt rather than gating it
        // in code (we'd need a per-call flag, which couples concerns).
        if (p.player_notes_append) {
          const line = p.player_notes_append.trim()
          if (line) appendPlacePlayerNotesStmt.run(line, line, placeId)
        }
      }
    }

    // 2. Characters. Look up by lowercased name; upsert with COALESCE so an
    //    omitted field doesn't overwrite an existing value with NULL.
    if (patch.characters) {
      for (const c of patch.characters) {
        // Alias-driven merges run BEFORE resolveCharacter so the canonical
        // name from the patch wins. Otherwise resolveCharacter's own soft-
        // match auto-merges the rows first and keeps the older row's name
        // (e.g. "Jordana" instead of "Jordana Osborne").
        // `reveals_name_of` is a clearer, safe-framed alias for the name-reveal
        // case; fold it into the same tested merge machinery as `aliases`.
        const aliasMergeNames = [
          ...(c.aliases ?? []),
          ...(c.reveals_name_of ? [c.reveals_name_of] : []),
        ]
        if (aliasMergeNames.length > 0) {
          runAliasMerges(worldId, c.name, aliasMergeNames)
        }
        const placeId =
          c.current_place_name !== undefined
            ? upsertPlace(worldId, c.current_place_name, undefined, undefined)
            : null
        const existing = resolveCharacter(worldId, c.name)

        // v0.6.10: tally NPC relocations for the scene-transition invariant.
        // A relocation = a non-player row whose patch sets a place resolving to
        // a different place_id than the row currently sits at. No-op
        // restatements (placeId === existing place, e.g. "Jordana still at
        // home") are excluded so the invariant fires on the first real travel
        // turn rather than lagging a beat. The player's own place move is
        // recorded separately to drive the backward-direction guard.
        if (placeId !== null) {
          const isPlayerRow = c.is_player === true || existing?.is_player === 1
          if (isPlayerRow) {
            playerPlaceFromPatch = placeId
          } else if (placeId !== (existing?.current_place_id ?? null)) {
            const names = relocatedNpcByPlace.get(placeId) ?? []
            names.push(c.name)
            relocatedNpcByPlace.set(placeId, names)
          }
        }

        const characterId: number = existing
          ? existing.id
          : (() => {
              const isPlayer = c.is_player ? 1 : 0
              const row = insertCharacterStmt.get(
                worldId,
                c.name,
                c.description ?? null,
                isPlayer,
                placeId,
                appendFactWithProvenance(null, c.memorable_facts_append, narratorTurnId),
                c.status ?? 'active',
                c.active_goal ?? null,
                c.current_attitude ?? null,
                isPlayer === 1
                  ? null
                  : appendFactWithProvenance(null, c.observations_append, narratorTurnId),
              ) as { id: number }
              return row.id
            })()
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
          // Observations are NPC-only and append-only. Drop silently if the
          // model tries to attach one to the player — that's a prompt failure
          // we don't want to persist.
          if (c.observations_append && existing.is_player === 0) {
            const nextObs = appendFactWithProvenance(
              existing.observations,
              c.observations_append,
              narratorTurnId,
            )
            setObservationsStmt.run(nextObs, existing.id)
          }
        }

        // player_notes_append is correction-channel only and append-only.
        if (c.player_notes_append) {
          const line = c.player_notes_append.trim()
          if (line) appendCharacterPlayerNotesStmt.run(line, line, characterId)
        }

        // Persist aliases on the canonical row so subsequent turns'
        // resolveCharacter() can match descriptor variants to this same
        // character. runAliasMerges above has already collapsed any
        // alias rows that already existed; here we just record the
        // (possibly new) descriptors as alternate names on the kept row.
        // Existing aliases are preserved; new ones are appended; the
        // canonical name itself is filtered out of the list.
        if ((c.aliases && c.aliases.length > 0) || c.reveals_name_of) {
          const existingAliases = (existing?.aliases ?? null)
          const incomingNames = [
            ...(c.aliases ?? []),
            ...(c.reveals_name_of ? [c.reveals_name_of] : []),
          ]
          const incoming = incomingNames.map((a) => a.trim()).filter((a) => a.length > 0).join('\n')
          const combined = mergeLineBlocks(existingAliases, incoming.length > 0 ? incoming : null)
          const filtered = filterAliasesAgainstName(combined, c.name)
          setCharacterAliasesStmt.run(filtered, characterId)
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
        setPlayersPlaceStmt.run(placeId, worldId)
      }
    }

    // 3b. Deterministic scene-transition invariant (v0.6.10). The archivist
    //     agent reliably moves NPCs across a travel boundary but frequently
    //     drops the protagonist's own location, leaving the scene cursor pinned
    //     at the origin while recent prose has the cast somewhere else — the
    //     narrator then snaps the player back to the stale anchor (the Call-In
    //     Case, world 6 turns 389-403). We can't key off the player's
    //     `current_place_name` (empty on every travel turn), so we infer the
    //     move from the NPC cluster the patch relocated this turn. Only runs
    //     when the patch did NOT itself open/close a scene. This is a logged
    //     best-guess, not a clean floor — see the false-positive tradeoff in
    //     docs/plans/milestones/v0.6.10.md (a lone NPC stepping out can drag the
    //     cursor); recovery is the console.warn + inspector edit, and the
    //     auto-opened scene is cheaply reversible (synthesised title, no
    //     summary, prior scene auto-closed not deleted).
    if ((!patch.scene || patch.scene.action === 'keep_open') && relocatedNpcByPlace.size > 0) {
      let inferredPlaceId: number | null = null
      let topCount = 0
      let totalRelocated = 0
      for (const [pid, names] of relocatedNpcByPlace) {
        totalRelocated += names.length
        if (names.length > topCount) {
          topCount = names.length
          inferredPlaceId = pid
        }
      }
      // Clear majority = strictly more than half land at one place. A single
      // relocated NPC trivially satisfies this (majority-of-one) — intended:
      // it lets the cursor advance on the first travel turn.
      const clearMajority = inferredPlaceId !== null && topCount * 2 > totalRelocated
      const scenePlaceId =
        (currentScenePlaceIdStmt.get(worldId) as { place_id: number | null } | undefined)?.place_id ??
        null
      const playerPlaceId =
        (playerPlaceIdStmt.get(worldId) as { current_place_id: number | null } | undefined)
          ?.current_place_id ?? null
      // Direction guard: never fire when the patch is moving the protagonist
      // AWAY from the NPC cluster (the turn-403 home snap-back). On the common
      // travel turn the player row is omitted entirely, so this is a no-op
      // there; it only suppresses the explicit backward flip.
      const movingPlayerAway =
        playerPlaceFromPatch !== null && playerPlaceFromPatch !== inferredPlaceId

      if (
        clearMajority &&
        inferredPlaceId !== scenePlaceId &&
        inferredPlaceId !== playerPlaceId &&
        !movingPlayerAway
      ) {
        const placeName =
          (placeNameByIdStmt.get(inferredPlaceId!) as { name: string } | undefined)?.name ??
          'destination'
        const cursor = currentSceneIdStmt.get(worldId) as
          | { current_scene_id: number | null }
          | undefined
        if (cursor?.current_scene_id) {
          autoCloseSceneStmt.run(narratorTurnId, cursor.current_scene_id)
        }
        const { n } = maxSceneNumberStmt.get(worldId) as { n: number }
        const newScene = insertSceneStmt.get(
          worldId,
          inferredPlaceId!,
          `Arriving at ${placeName}`,
          n + 1,
          narratorTurnId,
        ) as { id: number }
        setCurrentSceneStmt.run(newScene.id, worldId)
        setPlayersPlaceStmt.run(inferredPlaceId!, worldId)
        console.warn('[archivist] scene-transition invariant fired', {
          world_id: worldId,
          turn_id: narratorTurnId,
          prior_scene_place_id: scenePlaceId,
          inferred_place_id: inferredPlaceId,
          npcs: relocatedNpcByPlace.get(inferredPlaceId!) ?? [],
        })
      }
    }

    // 4. Scene pacing context. Applied after scene open/close so an opening
    //    scene receives the latest mood/pace/focus dial.
    if (patch.scene_context) {
      const cursor = currentSceneIdStmt.get(worldId) as
        | { current_scene_id: number | null }
        | undefined
      if (cursor?.current_scene_id) {
        updateSceneContextStmt.run(
          patch.scene_context.scene_mood ?? null,
          patch.scene_context.pace ?? null,
          patch.scene_context.focus ?? null,
          cursor.current_scene_id,
        )
      }
    }

    // 5. World clock.
    if (patch.current_time) {
      setWorldTimeStmt.run(patch.current_time, worldId)
    }

    // 6. Story dossier. These are story-shaped memory rows: playable
    //    pressure, clues, objectives, resources, and concise timeline beats.
    if (patch.story_threads) {
      for (const thread of patch.story_threads) {
        upsertStoryThread(worldId, narratorTurnId, thread)
      }
    }
    if (patch.story_clues) {
      for (const clue of patch.story_clues) {
        upsertStoryClue(worldId, narratorTurnId, clue)
      }
    }
    if (patch.story_objectives) {
      for (const objective of patch.story_objectives) {
        upsertStoryObjective(worldId, narratorTurnId, objective)
      }
    }
    if (patch.story_resources) {
      for (const resource of patch.story_resources) {
        upsertStoryResource(worldId, narratorTurnId, resource)
      }
    }
    if (patch.timeline_events) {
      const worldTime =
        patch.current_time ??
        ((db.prepare('SELECT world_time FROM worlds WHERE id = ?').get(worldId) as
          | { world_time: string | null }
          | undefined)?.world_time ?? null)
      for (const event of patch.timeline_events) {
        const threadId = resolveStoryThreadId(worldId, narratorTurnId, event.thread_title)
        insertTimelineEventStmt.run(
          worldId,
          narratorTurnId,
          threadId,
          worldTime,
          event.title,
          event.summary,
          event.importance ?? 3,
        )
      }
    }
  })
  tx()
}

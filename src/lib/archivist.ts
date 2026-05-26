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
type CharacterPatch = NonNullable<ArchivistPatch['characters']>[number]

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
  if (!normalize(narratorText).includes(destinationKey)) return null

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
        status: c.status,
        observations: c.is_player === 1 ? undefined : lastNLines(stripFactProvenance(c.observations), 2),
      })),
      known_characters: prior.knownCharacters.map((c) => ({
        name: c.name,
        is_player: c.is_player === 1,
        status: c.status,
        description: limit(c.description, 120),
      })),
      known_places: prior.knownPlaces.map((p) => ({
        name: p.name,
        kind: p.kind,
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

  return { patch: sanitizeArchivistPatch(prior, recent, object), usage }
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
    c.observations_append !== undefined
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
    /\byou (?:go|goes|walk|walks|run|runs|drive|drives|head|heads|travel|travels|return|returns|enter|enters|arrive|arrives|follow|follows|leave|leaves|step|steps|cross|crosses|climb|climbs|move|moves|land|lands|wake|wakes)\b/.test(value) ||
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
  appearance_count: number
  last_seen_turn_id: number | null
  last_agent_tick_turn_id: number | null
}

const listPlacesForWorldStmt = db.prepare<[number]>(
  'SELECT id, name, description, kind FROM places WHERE world_id = ? ORDER BY id ASC',
)
const currentPlaceForWorldStmt = db.prepare<[number]>(
  `SELECT p.id, p.name, p.description, p.kind
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
          personal_goals, current_focus, recent_activity, appearance_count,
          last_seen_turn_id, last_agent_tick_turn_id
   FROM characters
   WHERE world_id = ?
   ORDER BY id ASC`,
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
    number,
    number | null,
    number | null,
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
     appearance_count        = ?,
     last_seen_turn_id       = ?,
     last_agent_tick_turn_id = ?,
     updated_at              = datetime('now')
   WHERE id = ?`,
)
const deleteCharacterStmt = db.prepare<[number]>('DELETE FROM characters WHERE id = ?')
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

function mergeCharacters(target: CharacterRow, source: CharacterRow): void {
  if (target.id === source.id) return
  const merged = {
    name: target.name,
    description: chooseLonger(target.description, source.description),
    current_place_id: target.current_place_id ?? source.current_place_id,
    memorable_facts: mergeLineBlocks(target.memorable_facts, source.memorable_facts),
    status: strongestStatus(target.status, source.status),
    active_goal: target.active_goal ?? source.active_goal,
    current_attitude: target.current_attitude ?? source.current_attitude,
    observations: mergeLineBlocks(target.observations, source.observations),
    agency_level: strongestAgencyLevel(target.agency_level, source.agency_level),
    personal_goals: mergeLineBlocks(target.personal_goals, source.personal_goals),
    current_focus: target.current_focus ?? source.current_focus,
    recent_activity: mergeLineBlocks(target.recent_activity, source.recent_activity),
    appearance_count: Math.max(target.appearance_count, source.appearance_count),
    last_seen_turn_id: maxNullable(target.last_seen_turn_id, source.last_seen_turn_id),
    last_agent_tick_turn_id: maxNullable(
      target.last_agent_tick_turn_id,
      source.last_agent_tick_turn_id,
    ),
  }
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
    merged.appearance_count,
    merged.last_seen_turn_id,
    merged.last_agent_tick_turn_id,
    target.id,
  )
  Object.assign(target, merged)
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
        const existing = resolveCharacter(worldId, c.name)
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
        } else {
          const isPlayer = c.is_player ? 1 : 0
          insertCharacterStmt.run(
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
        setPlayersPlaceStmt.run(placeId, worldId)
      }
    }

    // 4. World clock.
    if (patch.current_time) {
      setWorldTimeStmt.run(patch.current_time, worldId)
    }
  })
  tx()
}

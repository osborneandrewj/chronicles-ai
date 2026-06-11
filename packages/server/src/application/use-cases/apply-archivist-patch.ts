import type { Character } from '@/domain/entities'
import type {
  CharacterRepository,
  DossierWriter,
  PlaceRepository,
  ReverieRepository,
  SceneRepository,
  TimelineWriter,
  UnitOfWork,
  WorldRepository,
} from '@/domain/ports'
import type { ArchivistPatch } from '@/lib/archivist'
import type { Place } from '@/lib/world-state'
import {
  canonicalCharacterKey,
  charactersMatch,
  chooseLonger,
  filterAliasesAgainstName,
  findCharacterByNameOrAlias,
  freshest,
  isAmbiguousCharacterMatch,
  maxNullable,
  mergeLineBlocks,
  placesMatch,
  strongestAgencyLevel,
  strongestStatus,
} from '@/domain/services/name-resolution'
import {
  appendFactWithProvenance,
} from '@/domain/services/memorable-fact-provenance'
import { resolvePossession } from '@/domain/services/inventory-resolution'
import { normalizeTransitPlacesInPatch } from '@/domain/services/patch-sanitizer'
import { decideSceneTransition } from '@/domain/services/scene-transition'

// ApplyArchivistPatch (Phase 4) — the structural world-state update that follows
// a narrator turn, carved out of `lib/archivist.applyArchivistPatch` onto the P4a
// port surface. PRESERVES EXACTLY the legacy control flow, ordering, COALESCE /
// append semantics, name-resolution / dedup / scene-transition decisions (same
// pure domain services), and turn-id / world-time bookkeeping. The whole apply
// runs inside `unitOfWork.run` (atomic; SQLite + Mongo both implement it). Under
// SQLite every port write executes against the same byte-identical SQL the lib
// statements held, so the frozen oracle tests stay green.

type StoryThreadPatch = NonNullable<ArchivistPatch['story_threads']>[number]
type StoryCluePatch = NonNullable<ArchivistPatch['story_clues']>[number]
type StoryObjectivePatch = NonNullable<ArchivistPatch['story_objectives']>[number]
type StoryResourcePatch = NonNullable<ArchivistPatch['story_resources']>[number]

// Labels that denote the single is_player=1 row rather than a named NPC. Used
// when resolving a tracked object's current holder (A4) — the archivist may say
// "protagonist" rather than the player's chosen name.
const PROTAGONIST_ALIASES = new Set(['protagonist', 'player', 'you', 'the player', 'me'])

export type ApplyArchivistPatchInput = {
  worldId: number
  turnId: number
  patch: ArchivistPatch
}

export type ApplyArchivistPatchDeps = {
  places: PlaceRepository
  characters: CharacterRepository
  scenes: SceneRepository
  worlds: WorldRepository
  dossierWriter: DossierWriter
  timeline: TimelineWriter
  reveries: ReverieRepository
  unitOfWork: UnitOfWork
}

// Apply a validated patch to the world. Wrapped in a single transaction so a
// partial failure leaves no half-applied state (e.g. a new place row with no
// scene pointing at it). The narrator turn itself was committed earlier; this
// is the structural update that follows.
export async function applyArchivistPatch(
  { worldId, turnId: narratorTurnId, patch: inputPatch }: ApplyArchivistPatchInput,
  deps: ApplyArchivistPatchDeps,
): Promise<void> {
  const { places, characters, scenes, worlds, dossierWriter, timeline, reveries, unitOfWork } =
    deps

  // List characters in the same order the legacy `listCharactersForWorldStmt`
  // returned them (id ASC) so resolveCharacter's match selection is byte-
  // identical — the port's `forWorld` orders is_player DESC first.
  async function listCharacters(): Promise<Character[]> {
    const rows = await characters.forWorld(worldId)
    return [...rows].sort((a, b) => a.id - b.id)
  }

  async function listPlaces(): Promise<Place[]> {
    return places.forWorld(worldId)
  }

  async function upsertPlace(
    name: string,
    description: string | undefined,
    kind: string | undefined,
  ): Promise<number> {
    const existing = await resolvePlace(name)
    if (existing) {
      if (description !== undefined || kind !== undefined) {
        await places.update({ id: existing.id, description: description ?? null, kind: kind ?? null })
      }
      return existing.id
    }
    const row = await places.insert({
      world_id: worldId,
      name,
      description: description ?? null,
      kind: kind ?? null,
    })
    return row.id
  }

  async function resolvePlace(requestedName: string): Promise<Place | undefined> {
    const rows = await listPlaces()
    const currentPlace = (await places.currentPlaceForWorld(worldId)) ?? undefined
    const matches = rows.filter((row) => placesMatch(requestedName, row.name, currentPlace))
    if (matches.length === 0) return undefined
    const target = matches[0]
    for (const duplicate of matches.slice(1)) {
      await mergePlaces(target, duplicate)
    }
    return target
  }

  async function mergePlaces(target: Place, source: Place): Promise<void> {
    if (target.id === source.id) return
    const description = chooseLonger(target.description, source.description)
    const kind = target.kind ?? source.kind
    await places.moveCharactersToPlace(target.id, source.id)
    await places.moveScenesToPlace(target.id, source.id)
    await places.delete(source.id)
    await places.merge({ id: target.id, description, kind })
    target.description = description
    target.kind = kind
  }

  async function resolveCharacter(requestedName: string): Promise<Character | undefined> {
    const rows = await listCharacters()
    // Aliases beat fuzzy match: if any row claims this descriptor as an
    // alias, treat that row as canonical regardless of fuzzy-token rules.
    // This is what lets the archivist deduplicate descriptor-only figures
    // ("the man at the gyro van" → existing "Man in the Canvas Vest" row).
    // rows are full Character entities; the helper is typed over the narrower
    // CharacterRow it shares with name-resolution, so the returned element is
    // still a Character — cast back to the precise entity type.
    const aliasHit = findCharacterByNameOrAlias(rows, requestedName) as Character | null
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
      await mergeCharacters(target, duplicate)
    }
    return target
  }

  // Run before resolveCharacter so the canonical name from the player's
  // correction wins. Looks up canonical + each alias by exact (lower)case name
  // — never via soft-match, because the player has *explicitly* asserted these
  // rows are the same person and the names may not overlap (Bob / Robert) or
  // may overlap-but-with-different-canonical-name (Jordana / Jordana Osborne).
  // If canonical doesn't exist yet but an alias does, the alias row is renamed
  // and promoted to be the canonical for subsequent iterations — cheaper than
  // inserting a new row and losing the alias's history.
  async function runAliasMerges(canonicalName: string, aliases: string[]): Promise<void> {
    let canonical = (await characters.findByExactLowerName(worldId, canonicalName)) ?? undefined
    for (const aliasRaw of aliases) {
      const alias = aliasRaw.trim()
      if (!alias) continue
      if (canonicalCharacterKey(alias) === canonicalCharacterKey(canonicalName)) continue
      const aliasRow = (await characters.findByExactLowerName(worldId, alias)) ?? undefined
      if (!aliasRow) continue
      if (canonical) {
        if (canonical.id === aliasRow.id) continue
        // Never merge across the player/NPC boundary: a player-asserted alias
        // must not silently rewrite the protagonist row, and the protagonist's
        // identity is not editable through this channel.
        if (canonical.is_player !== aliasRow.is_player) continue
        await mergeCharacters(canonical, aliasRow, canonicalName)
      } else {
        // No canonical row yet. Promote the alias by renaming it.
        await characters.rename(canonicalName, aliasRow.id)
        aliasRow.name = canonicalName
        canonical = aliasRow
      }
    }
  }

  async function mergeCharacters(
    target: Character,
    source: Character,
    canonicalName?: string,
  ): Promise<void> {
    if (target.id === source.id) {
      if (canonicalName && canonicalName !== target.name) {
        await characters.rename(canonicalName, target.id)
        target.name = canonicalName
      }
      return
    }
    const finalName = canonicalName ?? target.name
    // The losing row's display name and any aliases it had become aliases on
    // the kept row. Skip the name we're keeping as canonical (no self-aliases).
    const mergedAliasesRaw = mergeLineBlocks(target.aliases, source.aliases)
    const inferredAlias = source.name && source.name !== finalName ? source.name : null
    const carriedAlias = target.name && target.name !== finalName ? target.name : null
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
    await reveries.repoint(source.id, target.id)
    await characters.delete(source.id)
    await characters.merge(target.id, merged)
    Object.assign(target, merged)
    // updated_at is bumped server-side by the merge; refresh the in-memory
    // copy so subsequent comparisons in this transaction stay correct.
    target.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19)
  }

  async function upsertStoryThread(patch: StoryThreadPatch): Promise<number> {
    const existing = await dossierWriter.threadByTitle(worldId, patch.title)
    const kind = patch.kind ?? existing?.kind ?? 'mystery'
    const status = patch.status ?? existing?.status ?? 'active'
    const resolvedTurnId = status === 'resolved' || status === 'failed' ? narratorTurnId : null
    const relevanceTagsJson = patch.relevance_tags
      ? JSON.stringify(patch.relevance_tags)
      : (existing?.relevance_tags_json ?? '[]')

    if (existing) {
      await dossierWriter.updateThread({
        id: existing.id,
        kind,
        status,
        summary: patch.summary ?? null,
        stakes: patch.stakes ?? null,
        rewards: patch.rewards ?? null,
        consequences: patch.consequences ?? null,
        hidden: patch.hidden ?? null,
        relevance_tags_json: relevanceTagsJson,
        resolved_turn_id: resolvedTurnId,
      })
      return existing.id
    }

    const row = await dossierWriter.insertThread({
      world_id: worldId,
      title: patch.title,
      kind,
      status,
      summary: patch.summary ?? null,
      stakes: patch.stakes ?? null,
      rewards: patch.rewards ?? null,
      consequences: patch.consequences ?? null,
      hidden: patch.hidden ?? null,
      relevance_tags_json: relevanceTagsJson,
      source_turn_id: narratorTurnId,
    })
    return row.id
  }

  async function resolveStoryThreadId(
    threadTitle: string | undefined,
    options: { preferQuest?: boolean } = {},
  ): Promise<number | null> {
    if (!threadTitle) return null
    // A thread that carries playable objectives is a mission — surface it as a
    // `quest` rather than leaving it under the catch-all `mystery` default the
    // model reaches for. We only upgrade the soft kinds (`mystery`/`background`):
    // a deliberately-set `threat` or `relationship` keeps its kind even when an
    // objective attaches (a hostage standoff is a threat the player works, not a
    // quest). New threads spawned by an objective reference open as quests.
    if (options.preferQuest) {
      const existing = await dossierWriter.threadByTitle(worldId, threadTitle)
      if (!existing || existing.kind === 'mystery' || existing.kind === 'background') {
        return upsertStoryThread({ title: threadTitle, kind: 'quest', status: 'active' })
      }
    }
    return upsertStoryThread({ title: threadTitle, status: 'active' })
  }

  async function upsertStoryClue(patch: StoryCluePatch): Promise<void> {
    const threadId = await resolveStoryThreadId(patch.thread_title)
    const existing = await dossierWriter.clueByTitle(worldId, patch.title)
    const status = patch.status ?? 'open'
    if (existing) {
      await dossierWriter.updateClue({
        id: existing.id,
        thread_id: threadId,
        detail: patch.detail ?? null,
        implication: patch.implication ?? null,
        status,
      })
      return
    }
    await dossierWriter.insertClue({
      world_id: worldId,
      thread_id: threadId,
      title: patch.title,
      detail: patch.detail ?? null,
      implication: patch.implication ?? null,
      status,
      source_turn_id: narratorTurnId,
    })
  }

  async function upsertStoryObjective(patch: StoryObjectivePatch): Promise<void> {
    const threadId = await resolveStoryThreadId(patch.thread_title, { preferQuest: true })
    const existing = await dossierWriter.objectiveByTitle(worldId, patch.title)
    const status = patch.status ?? 'active'
    const completedTurnId = status === 'completed' || status === 'failed' ? narratorTurnId : null
    if (existing) {
      await dossierWriter.updateObjective({
        id: existing.id,
        thread_id: threadId,
        status,
        detail: patch.detail ?? null,
        blocker: patch.blocker ?? null,
        completed_turn_id: completedTurnId,
      })
      return
    }
    await dossierWriter.insertObjective({
      world_id: worldId,
      thread_id: threadId,
      title: patch.title,
      status,
      detail: patch.detail ?? null,
      blocker: patch.blocker ?? null,
      source_turn_id: narratorTurnId,
    })
  }

  // "protagonist" / "player" / "you" all denote the single is_player=1 row,
  // which resolveCharacter (name-based fuzzy match) cannot find by these labels.
  async function resolveHolderId(name: string | undefined): Promise<number | null> {
    if (!name) return null
    if (PROTAGONIST_ALIASES.has(name.trim().toLowerCase())) {
      return (await listCharacters()).find((c) => c.is_player === 1)?.id ?? null
    }
    return (await resolveCharacter(name))?.id ?? null
  }

  async function upsertStoryResource(patch: StoryResourcePatch): Promise<void> {
    const ownerId = patch.owner_name
      ? (await resolveCharacter(patch.owner_name))?.id ?? null
      : null
    // Resolve possession names → ids, then let the pure service decide the
    // column writes (set / clear / unchanged) and enforce mutual exclusion: an
    // object is either held by a character OR resting at a place, never both.
    const heldById =
      typeof patch.held_by_name === 'string' && patch.held_by_name.trim()
        ? await resolveHolderId(patch.held_by_name)
        : null
    const locationId =
      typeof patch.location_name === 'string' && patch.location_name.trim()
        ? (await resolvePlace(patch.location_name))?.id ?? null
        : null
    const possession = resolvePossession({
      heldByName: patch.held_by_name,
      locationName: patch.location_name,
      heldById,
      locationId,
    })
    const existing = await dossierWriter.resourceByName(worldId, patch.name)
    if (existing) {
      await dossierWriter.updateResource({
        id: existing.id,
        owner_character_id: ownerId,
        kind: patch.kind ?? null,
        status: patch.status ?? null,
        detail: patch.detail ?? null,
        held_by_character_id: possession.held_by_character_id,
        clear_held_by: possession.clear_held_by,
        location_place_id: possession.location_place_id,
        clear_location: possession.clear_location,
        salient: patch.salient ?? null,
      })
      return
    }
    await dossierWriter.insertResource({
      world_id: worldId,
      owner_character_id: ownerId,
      name: patch.name,
      kind: patch.kind ?? null,
      status: patch.status ?? null,
      detail: patch.detail ?? null,
      // On insert there is no prior value to preserve; clear and unchanged both
      // mean "no id". The resolved values already reflect mutual exclusion.
      held_by_character_id: possession.held_by_character_id,
      location_place_id: possession.location_place_id,
      salient: patch.salient ?? false,
      source_turn_id: narratorTurnId,
    })
  }

  // v0.6.19 (A1): normalize transit pseudo-places before anything resolves an
  // id, so the scene anchor and player location land on real destinations.
  const patch = normalizeTransitPlacesInPatch(inputPatch)

  await unitOfWork.run(async () => {
    // v0.6.10 scene-transition invariant state, populated in the character loop
    // (step 2) and consumed after the scene-action step (step 3b). Keyed off
    // which NPCs the patch RELOCATES this turn — the reliable signal that the
    // protagonist travelled even when the archivist drops the player's own
    // `current_place_name` (the exact Call-In Case failure).
    const relocatedNpcByPlace = new Map<number, string[]>()
    let playerPlaceFromPatch: number | null = null
    // v0.6.19 (A1-i): track ALL place ids that NPCs were explicitly assigned to
    // in this patch (both relocations and no-op restatements). Used at step 3b
    // to detect the backward "home flip" signature: the patch pins NPCs to the
    // old scene place while the player heads elsewhere.
    const npcPlacesInPatch = new Set<number>()

    // 1. Places first, so character.current_place_name and scene.open.place_name
    //    can resolve to ids in the same patch.
    if (patch.places) {
      for (const p of patch.places) {
        const placeId = await upsertPlace(p.name, p.description, p.kind)
        // player_notes_append is the correction-channel field: a single short
        // sentence appended on its own line to existing player_notes. The
        // narrator-extraction prompt is told never to set this; if it leaks
        // through anyway, the result is just a player_notes line — not
        // catastrophic, but worth tightening the prompt rather than gating it
        // in code (we'd need a per-call flag, which couples concerns).
        if (p.player_notes_append) {
          const line = p.player_notes_append.trim()
          if (line) await places.appendPlayerNotes(placeId, line)
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
          await runAliasMerges(c.name, aliasMergeNames)
        }
        const placeId =
          c.current_place_name !== undefined
            ? await upsertPlace(c.current_place_name, undefined, undefined)
            : null
        let existing = await resolveCharacter(c.name)

        // Single-player invariant (A9): a patch marking a character as the
        // player must land on the one is_player=1 row and rename it in place —
        // never insert a second protagonist. This prevents the duplicate-player
        // split seen in the playthrough (a stray "Player" row holding the real
        // protagonist's notes alongside the named player row).
        if (c.is_player === true) {
          const canonicalPlayer = (await listCharacters()).find((row) => row.is_player === 1)
          if (canonicalPlayer) {
            if (existing && existing.id !== canonicalPlayer.id) {
              // The new name matched a different row (a stray pseudo-player or a
              // second is_player row) — fold it into the one protagonist.
              await mergeCharacters(canonicalPlayer, existing, c.name)
            } else if (
              canonicalCharacterKey(canonicalPlayer.name) !== canonicalCharacterKey(c.name)
            ) {
              await characters.rename(c.name, canonicalPlayer.id)
            }
            existing =
              (await listCharacters()).find((row) => row.id === canonicalPlayer.id) ?? canonicalPlayer
          }
        }

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
            npcPlacesInPatch.add(placeId)
          } else {
            // No-op restatement: NPC explicitly named in patch but already at this place.
            npcPlacesInPatch.add(placeId)
          }
        }

        let characterId: number
        if (existing) {
          characterId = existing.id
        } else {
          const isPlayer = c.is_player ? 1 : 0
          const row = await characters.insert({
            world_id: worldId,
            name: c.name,
            description: c.description ?? null,
            is_player: isPlayer,
            current_place_id: placeId,
            memorable_facts: appendFactWithProvenance(null, c.memorable_facts_append, narratorTurnId),
            status: c.status ?? 'active',
            active_goal: c.active_goal ?? null,
            current_attitude: c.current_attitude ?? null,
            observations:
              isPlayer === 1
                ? null
                : appendFactWithProvenance(null, c.observations_append, narratorTurnId),
          })
          characterId = row.id
        }
        if (existing) {
          const nextFacts = appendFactWithProvenance(
            existing.memorable_facts,
            c.memorable_facts_append,
            narratorTurnId,
          )
          await characters.update(existing.id, {
            description: c.description ?? null,
            current_place_id: placeId,
            is_player: c.is_player === undefined ? null : c.is_player ? 1 : 0,
            memorable_facts: nextFacts,
            status: c.status ?? null,
          })
          // Goal / attitude are three-state: omitted (undefined) = unchanged;
          // explicit null = clear; string = set.
          if (c.active_goal !== undefined) {
            await characters.setActiveGoal(existing.id, c.active_goal)
          }
          if (c.current_attitude !== undefined) {
            await characters.setCurrentAttitude(existing.id, c.current_attitude)
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
            await characters.setObservations(existing.id, nextObs)
          }
        }

        // player_notes_append is correction-channel only and append-only.
        if (c.player_notes_append) {
          const line = c.player_notes_append.trim()
          if (line) await characters.appendPlayerNotes(characterId, line)
        }

        // Persist aliases on the canonical row so subsequent turns'
        // resolveCharacter() can match descriptor variants to this same
        // character. runAliasMerges above has already collapsed any
        // alias rows that already existed; here we just record the
        // (possibly new) descriptors as alternate names on the kept row.
        // Existing aliases are preserved; new ones are appended; the
        // canonical name itself is filtered out of the list.
        if ((c.aliases && c.aliases.length > 0) || c.reveals_name_of) {
          const existingAliases = existing?.aliases ?? null
          const incomingNames = [
            ...(c.aliases ?? []),
            ...(c.reveals_name_of ? [c.reveals_name_of] : []),
          ]
          const incoming = incomingNames.map((a) => a.trim()).filter((a) => a.length > 0).join('\n')
          const combined = mergeLineBlocks(existingAliases, incoming.length > 0 ? incoming : null)
          const filtered = filterAliasesAgainstName(combined, c.name)
          await characters.setAliases(characterId, filtered)
        }
      }
    }

    // 3. Scene action. close must complete before open so scene_number sequencing
    //    works without juggling.
    if (patch.scene && patch.scene.action !== 'keep_open') {
      if (patch.scene.action === 'close') {
        const currentSceneId = await scenes.currentSceneId(worldId)
        if (currentSceneId) {
          await scenes.close({
            summary: patch.scene.summary,
            closedAtTurn: narratorTurnId,
            id: currentSceneId,
          })
        }
      } else {
        // action === 'open' — auto-close the prior active scene if one exists,
        // then create the new scene. Auto-close has no summary; v0.6's CRUD UI
        // can backfill if it matters.
        const currentSceneId = await scenes.currentSceneId(worldId)
        if (currentSceneId) {
          await scenes.autoClose(narratorTurnId, currentSceneId)
        }
        const placeId = await upsertPlace(patch.scene.place_name, undefined, undefined)
        const n = await scenes.maxSceneNumber(worldId)
        const row = await scenes.insert({
          world_id: worldId,
          place_id: placeId,
          title: patch.scene.title,
          scene_number: n + 1,
          opened_at_turn: narratorTurnId,
        })
        await worlds.setCurrentScene(row.id, worldId)
        await characters.setPlayersPlace(placeId, worldId)
      }
    }

    // 3b. Deterministic scene-transition invariant. The pure decision lives in
    // domain/services/scene-transition.ts (it weighs the player's own move
    // first, then the relocated-NPC cluster, with the backward "home flip"
    // guard). Here we read the current scene/player place ids inside the
    // transaction, ask the pure service for an intent, and apply it — the same
    // write sequence (auto-close prior scene → open "Arriving at …" → drag the
    // player along) both branches always shared.
    const sceneUnchangedForInvariant = !patch.scene || patch.scene.action === 'keep_open'
    const playerRow = (await listCharacters()).find((c) => c.is_player === 1)
    const sceneTransition = decideSceneTransition({
      sceneUnchanged: sceneUnchangedForInvariant,
      playerPlaceFromPatch,
      relocatedNpcByPlace,
      npcPlacesInPatch,
      scenePlaceId: await scenes.currentScenePlaceId(worldId),
      playerPlaceId: playerRow?.current_place_id ?? null,
    })
    if (sceneTransition) {
      const { placeId, reason, priorScenePlaceId } = sceneTransition
      const currentSceneId = await scenes.currentSceneId(worldId)
      if (currentSceneId) {
        await scenes.autoClose(narratorTurnId, currentSceneId)
      }
      const n = await scenes.maxSceneNumber(worldId)
      const placeName = (await places.nameById(placeId)) ?? 'destination'
      const newScene = await scenes.insert({
        world_id: worldId,
        place_id: placeId,
        title: `Arriving at ${placeName}`,
        scene_number: n + 1,
        opened_at_turn: narratorTurnId,
      })
      await worlds.setCurrentScene(newScene.id, worldId)
      await characters.setPlayersPlace(placeId, worldId)
      if (reason === 'player-move') {
        console.warn('[archivist] player-move scene invariant fired', {
          world_id: worldId,
          turn_id: narratorTurnId,
          prior_scene_place_id: priorScenePlaceId,
          player_place_id: placeId,
        })
      } else {
        console.warn('[archivist] scene-transition invariant fired', {
          world_id: worldId,
          turn_id: narratorTurnId,
          prior_scene_place_id: priorScenePlaceId,
          inferred_place_id: placeId,
          npcs: relocatedNpcByPlace.get(placeId) ?? [],
        })
      }
    }

    // 4. Scene pacing context. Applied after scene open/close so an opening
    //    scene receives the latest mood/pace/focus dial.
    if (patch.scene_context) {
      const currentSceneId = await scenes.currentSceneId(worldId)
      if (currentSceneId) {
        await scenes.updateContext({
          scene_mood: patch.scene_context.scene_mood ?? null,
          pace: patch.scene_context.pace ?? null,
          focus: patch.scene_context.focus ?? null,
          id: currentSceneId,
        })
      }
    }

    // 5. World clock.
    if (patch.current_time) {
      await worlds.setWorldTime(worldId, patch.current_time)
    }

    // 6. Story dossier. These are story-shaped memory rows: playable
    //    pressure, clues, objectives, resources, and concise timeline beats.
    if (patch.story_threads) {
      for (const thread of patch.story_threads) {
        await upsertStoryThread(thread)
      }
    }
    if (patch.story_clues) {
      for (const clue of patch.story_clues) {
        await upsertStoryClue(clue)
      }
    }
    if (patch.story_objectives) {
      for (const objective of patch.story_objectives) {
        await upsertStoryObjective(objective)
      }
    }
    if (patch.story_resources) {
      for (const resource of patch.story_resources) {
        await upsertStoryResource(resource)
      }
    }
    if (patch.timeline_events) {
      const worldTime = patch.current_time ?? (await worlds.cursor(worldId)).world_time
      for (const event of patch.timeline_events) {
        const threadId = await resolveStoryThreadId(event.thread_title)
        await timeline.append({
          world_id: worldId,
          turn_id: narratorTurnId,
          thread_id: threadId,
          world_time: worldTime,
          title: event.title,
          summary: event.summary,
          importance: event.importance ?? 3,
          sim_tick: null,
          provenance: 'turn',
        })
      }
    }
  })
}

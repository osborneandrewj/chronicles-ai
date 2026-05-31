import { findLikelyDuplicateCharacters, type DuplicatePair } from '@/lib/character-dedup'
import {
  getActiveSceneForWorld,
  getCharactersForWorld,
  getCharactersInPlace,
  getLatestOccupancySnapshotRow,
  getPlace,
  getPlacesForWorld,
  getScenesForWorld,
  getStoryDossierForWorld,
  getTurnTimestampsForWorld,
  getWorldCursor,
  type OccupancySnapshotRow,
  type StoryDossier,
} from '@/lib/db'
import { stripFactProvenance } from '@/lib/memorable-facts'
import type { PlaceOccupancy } from '@/lib/place-population'
import { buildTurnNumberMap } from '@/lib/turn-numbers'

export type CharacterAgencyLevel = 'npc' | 'local' | 'nearby' | 'distant' | 'dormant'

export type Character = {
  id: number
  world_id: number
  name: string
  description: string | null
  is_player: number
  current_place_id: number | null
  memorable_facts: string | null
  status: 'active' | 'inactive' | 'dead'
  active_goal: string | null
  current_attitude: string | null
  observations: string | null
  agency_level: CharacterAgencyLevel
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
  in_transit_to_place_id: number | null
  arrival_world_time: string | null
  last_known_situation: string | null
  aliases: string | null
  created_at: string
  updated_at: string
}

export type Place = {
  id: number
  world_id: number
  name: string
  description: string | null
  kind: string | null
  player_notes: string | null
  osm_display_name: string | null
  osm_street: string | null
  osm_neighborhood: string | null
  osm_lat: number | null
  osm_lng: number | null
  geo_status: 'unresolved' | 'ok' | 'not_found' | 'unavailable'
  geo_resolved_at: string | null
  created_at: string
  updated_at: string
}

export type Scene = {
  id: number
  world_id: number
  place_id: number | null
  title: string
  summary: string | null
  scene_number: number
  status: 'active' | 'completed'
  scene_mood: 'atmospheric' | 'tense' | 'violent' | 'intimate' | 'wondrous' | null
  pace: 'slow' | 'medium' | 'fast' | null
  focus: 'environment' | 'characters' | 'action' | 'internal' | null
  opened_at_turn: number | null
  closed_at_turn: number | null
  created_at: string
  updated_at: string
}

// What the narrator's prompt actually needs each turn. The inspector reads
// the broader shape via getFullWorldState() — keep the two paths separate so
// the narrator doesn't get accidentally fattened with off-scene NPCs.
export type NarratorWorldState = {
  worldTime: string | null
  currentScene: Scene | null
  currentPlace: Place | null
  presentCharacters: Character[]
  knownCharacters: Character[]
  knownPlaces: Place[]
  dossier: StoryDossier
  occupancy: PlaceOccupancy | null
}

export type FullWorldState = {
  worldTime: string | null
  currentSceneId: number | null
  characters: Character[]
  places: Place[]
  scenes: Scene[]
  dossier: StoryDossier
  turnTimestamps: Record<number, string>
  turnNumbers: Record<number, number>
  potentialDuplicates: DuplicatePair[]
}

export function getNarratorWorldState(worldId: number): NarratorWorldState {
  const cursor = getWorldCursor(worldId)
  const activeScene = getActiveSceneForWorld(worldId)
  const currentPlace = activeScene?.place_id ? getPlace(activeScene.place_id) : null

  const knownCharacters = getCharactersForWorld(worldId)
  const knownPlaces = getPlacesForWorld(worldId)
  const player = knownCharacters.filter((c) => c.is_player === 1)
  const npcsInPlace = currentPlace
    ? getCharactersInPlace(worldId, currentPlace.id).filter((c) => c.is_player === 0)
    : []

  const occupancyRow = currentPlace ? getLatestOccupancySnapshotRow(worldId, currentPlace.id) : null
  const occupancy =
    occupancyRow && occupancyRow.scene_id === (activeScene?.id ?? null)
      ? parseOccupancyRow(occupancyRow)
      : null

  return {
    worldTime: cursor.world_time,
    currentScene: activeScene,
    currentPlace,
    presentCharacters: [...player, ...npcsInPlace],
    knownCharacters,
    knownPlaces,
    dossier: getStoryDossierForWorld(worldId),
    occupancy,
  }
}

export function getFullWorldState(worldId: number): FullWorldState {
  const cursor = getWorldCursor(worldId)
  const orderedTurns = getTurnTimestampsForWorld(worldId)
  const turnTimestamps = Object.fromEntries(
    orderedTurns.map((turn) => [turn.id, turn.created_at]),
  )
  const turnNumbers = buildTurnNumberMap(orderedTurns.map((turn) => turn.id))
  const characters = getCharactersForWorld(worldId)
  return {
    worldTime: cursor.world_time,
    currentSceneId: cursor.current_scene_id,
    characters,
    places: getPlacesForWorld(worldId),
    scenes: getScenesForWorld(worldId),
    dossier: getStoryDossierForWorld(worldId),
    turnTimestamps,
    turnNumbers,
    potentialDuplicates: findLikelyDuplicateCharacters(characters),
  }
}

// Minimal scene context for the classifier. The classifier doesn't need the
// full FIXED/OPEN framing or memorable_facts; it just needs to know whether
// the protagonist is in a scene with someone they could plausibly be
// addressing. "Where is the farmstead?" should classify as `say` +
// `in-character` when Armitage is present, and lean OOC when the protagonist
// is alone.
export function formatSceneDigestForClassifier(state: NarratorWorldState): string {
  const lines: string[] = []
  if (state.currentPlace) {
    lines.push(`PLACE: ${state.currentPlace.name}`)
  }
  const npcs = state.presentCharacters.filter((c) => c.is_player !== 1)
  if (npcs.length > 0) {
    lines.push(`PRESENT NPCS: ${npcs.map((c) => c.name).join(', ')}`)
  } else {
    lines.push('PRESENT NPCS: (none — the protagonist is alone)')
  }
  return lines.join('\n')
}

// v0.6.9 — plans carry an `intent_id` so the post-narrator reconciler can
// match the narrator prose back to the durable npc_intents row. The narrator
// prompt is forbidden from putting intent IDs on the page (mechanics talk);
// they exist only as a routing key.
export type NpcPlannedAction = {
  npc_name: string
  intent: string
  planned_action?: string
  intent_id?: number
}

export function formatStateBlock(
  state: NarratorWorldState,
  plannedActions: NpcPlannedAction[] = [],
  recentNarratorProse: string[] = [],
): string {
  const lines: string[] = [
    '## STATE',
    'Listed facts are fixed. Unlisted small, genre-consistent details are open canvas.',
    'The Place line is the protagonist\'s physical location; hold it unless the player or world physically moves them.',
    'The Time line is the authoritative world clock; ordinary watches, phones, computers, and clocks display it unless state says otherwise.',
    `- Time: ${state.worldTime ?? '(unset)'}`,
  ]

  if (state.currentScene) {
    lines.push(`- Scene: ${state.currentScene.title} (scene ${state.currentScene.scene_number})`)
    const pacing = formatScenePacing(state.currentScene)
    if (pacing) lines.push(`  - pacing: ${pacing}`)
  }
  // v0.6.10 belt-and-suspenders: if the active scene's place disagrees with
  // recent prose (the last 2 narrator turns clearly depicted travel/arrival to
  // a different named place), omit the Place line rather than assert a stale
  // anchor. The narrator reads location from recent prose well; a wrong
  // authoritative Place line is what produced the Call-In snap-back. This is a
  // thin fallback — the archivist invariant fixing the cursor early is the
  // primary fix; this only catches transitions the invariant cannot (e.g. an
  // unpopulated destination with no NPC cluster to vote on).
  const placeContradicted =
    state.currentPlace !== null &&
    recentProseDepictsTravelElsewhere(recentNarratorProse, state.currentPlace, state.knownPlaces)
  if (state.currentPlace && !placeContradicted) {
    lines.push(`- Place: ${state.currentPlace.name}`)
    if (state.currentPlace.description) {
      lines.push(`  ${state.currentPlace.description}`)
    }
    const geo = formatPlaceGeo(state.currentPlace)
    if (geo) {
      lines.push(`  - real-world geo: ${geo}`)
    }
  }

  if (state.presentCharacters.length > 0) {
    lines.push('', '### Present')
    for (const c of state.presentCharacters) {
      const role = c.is_player === 1 ? 'player' : c.status
      lines.push(`- ${c.name} (${role})${c.description ? ` — ${limit(c.description, 180)}` : ''}`)
      if (c.is_player === 1) {
        if (c.status !== 'active') lines.push(`  - status: ${c.status}`)
        lines.push('  - continuity: this row is the protagonist; preserve location, carried items, injuries, notable discoveries, obligations, and relationship facts unless narration clearly changes them.')
      }
      const facts = stripFactProvenance(c.memorable_facts)
      if (facts) {
        const factLines = facts.split('\n').filter((f) => f.trim().length > 0).slice(-3)
        for (const fact of factLines) {
          lines.push(`  - ${fact}`)
        }
      }
      // NPC-only social/agency fields, in order of arc-width: personal_goals
      // (long arc) → focus (current preoccupation) → active_goal (scene-
      // immediate) → attitude (right now) → recent_activity (off-scene
      // gap-fill) → behavior cue (what they've noticed about the protagonist).
      // Each is omitted when null to keep state-block tokens bounded.
      if (c.is_player !== 1) {
        if (c.personal_goals) {
          const goals = c.personal_goals.split('\n').filter((s) => s.trim().length > 0)
          if (goals.length === 1) {
            lines.push(`  - personal goal: ${limit(goals[0], 160)}`)
          } else {
            lines.push('  - personal goals:')
            for (const g of goals.slice(0, 3)) lines.push(`    - ${limit(g, 160)}`)
          }
        }
        if (c.long_term_agenda) {
          const agenda = c.long_term_agenda.split('\n').filter((s) => s.trim().length > 0)
          if (agenda.length === 1) {
            lines.push(`  - agenda: ${limit(agenda[0], 160)}`)
          } else {
            lines.push('  - agenda:')
            for (const item of agenda.slice(0, 3)) lines.push(`    - ${limit(item, 160)}`)
          }
        }
        if (c.relationship_to_player) {
          lines.push(`  - relationship to protagonist: ${limit(c.relationship_to_player, 180)}`)
        }
        if (c.private_beliefs) {
          const beliefs = c.private_beliefs.split('\n').filter((s) => s.trim().length > 0)
          if (beliefs.length === 1) {
            lines.push(`  - private belief: ${limit(beliefs[0], 170)}`)
          } else {
            lines.push('  - private beliefs:')
            for (const b of beliefs.slice(0, 3)) lines.push(`    - ${limit(b, 170)}`)
          }
        }
        if (c.reveries) {
          const reveries = c.reveries.split('\n').filter((s) => s.trim().length > 0)
          if (reveries.length === 1) {
            lines.push(`  - reverie: ${limit(reveries[0], 180)}`)
          } else {
            lines.push('  - reveries:')
            for (const r of reveries.slice(0, 3)) lines.push(`    - ${limit(r, 180)}`)
          }
        }
        if (c.tool_access) {
          lines.push(`  - diegetic tools: ${limit(c.tool_access, 180)}`)
        }
        if (c.current_focus) lines.push(`  - focus: ${limit(c.current_focus, 160)}`)
        if (c.active_goal) lines.push(`  - goal: ${limit(c.active_goal, 160)}`)
        if (c.current_attitude) lines.push(`  - attitude: ${limit(c.current_attitude, 160)}`)
        const activity = stripFactProvenance(c.recent_activity)
        if (activity) {
          for (const line of activity.split('\n').filter((s) => s.trim().length > 0).slice(-2)) {
            lines.push(`  - activity: ${limit(line, 160)}`)
          }
        }
        const obs = stripFactProvenance(c.observations)
        if (obs) {
          for (const line of obs.split('\n').filter((s) => s.trim().length > 0).slice(-2)) {
            lines.push(`  - behavior cue: ${limit(line, 160)}`)
          }
        }
      }
    }
  }

  const occupancyBlock = formatOccupancyBlock(state.occupancy)
  if (occupancyBlock) {
    lines.push('', occupancyBlock)
  }

  // Real-world geographic anchors for known places. These come from a one-time
  // Nominatim resolve per place and are authoritative: the narrator (and the
  // NPC agent, which sees a parallel block) must not contradict the street or
  // neighborhood listed here. Omitted when nothing in the world has resolved
  // (fantasy settings, fresh world before first resolution call).
  const placesWithGeo = state.knownPlaces.filter((p) => p.geo_status === 'ok')
  if (placesWithGeo.length > 0) {
    lines.push('', '### KNOWN PLACES (real-world geography — authoritative)')
    for (const p of placesWithGeo) {
      const geo = formatPlaceGeo(p)
      if (geo) lines.push(`- ${p.name} — ${geo}`)
    }
  }

  // Off-scene NPCs the narrator might reference this turn (phone calls,
  // messages, recollections, sudden arrivals). The NPC agent ticks them in
  // the background and writes last_known_situation + journey state. The
  // narrator must ground any off-scene NPC line in these facts and must
  // not teleport an NPC ahead of arrival_world_time.
  const presentIds = new Set(state.presentCharacters.map((c) => c.id))
  const offScene = state.knownCharacters
    .filter(
      (c) =>
        c.is_player !== 1 &&
        c.status !== 'dead' &&
        !presentIds.has(c.id) &&
        (c.agency_level === 'local' ||
          c.agency_level === 'nearby' ||
          c.agency_level === 'distant'),
    )
    .filter(
      (c) =>
        c.last_known_situation !== null ||
        c.current_place_id !== null ||
        c.in_transit_to_place_id !== null,
    )
    .sort((a, b) => (b.last_seen_turn_id ?? 0) - (a.last_seen_turn_id ?? 0))
    .slice(0, 5)
  if (offScene.length > 0) {
    const placeNameById = new Map(state.knownPlaces.map((p) => [p.id, p.name]))
    lines.push('', '### OFF-SCENE NPCs (tracked — do not contradict)')
    for (const c of offScene) {
      const where = c.current_place_id ? placeNameById.get(c.current_place_id) ?? null : null
      const dest = c.in_transit_to_place_id
        ? placeNameById.get(c.in_transit_to_place_id) ?? null
        : null
      const head = where ? `${c.name} at ${where}` : c.name
      const journey =
        dest !== null
          ? ` → ${dest}${c.arrival_world_time ? ` (ETA ${c.arrival_world_time})` : ''}`
          : ''
      lines.push(`- ${head}${journey}`)
      if (c.last_known_situation) {
        lines.push(`  - situation: ${limit(c.last_known_situation, 200)}`)
      }
      const activity = stripFactProvenance(c.recent_activity)
      if (activity) {
        const last = activity.split('\n').filter((l) => l.trim().length > 0).slice(-1)[0]
        if (last) lines.push(`  - last activity: ${limit(last, 180)}`)
      }
    }
  }

  // Agent NPCs' planned moves for THIS turn. Decided by the NPC agent before
  // the narrator runs; the narrator stages them as the actual scene rather
  // than improvising those characters' choices. Omitted when there are no
  // present agent NPCs or the agent returned no plans.
  //
  // The concrete planned_action is what the narrator stages; the upstream
  // intent_text is shown alongside so the narrator can pick a faithful
  // realization. Intent IDs are deliberately NOT printed — narration must
  // never mention mechanics.
  if (plannedActions.length > 0) {
    lines.push('', '### PLANNED MOVES THIS TURN (agent NPCs)')
    for (const p of plannedActions) {
      const action = p.planned_action ?? p.intent
      lines.push(`- **${p.npc_name}** — ${action}`)
      if (p.planned_action && p.intent && p.intent !== p.planned_action) {
        lines.push(`  - intent: ${limit(p.intent, 180)}`)
      }
    }
  }

  const canonBlock = formatPlayerCanonBlock(state.knownCharacters, state.knownPlaces)
  if (canonBlock) {
    lines.push('', canonBlock)
  }

  const dossierBlock = formatDossierBlock(state.dossier)
  if (dossierBlock) {
    lines.push('', dossierBlock)
  }

  return lines.join('\n')
}

// True when the last 2 narrator turns clearly depict travel/arrival/entry to a
// known place other than the active scene's place. Deliberately a simple
// keyword + substring check, not LLM-based: a travel verb plus the name of a
// *different* known place in the recent window. Conservative by design — when
// the check is unsure it does not fire, and even a missed-but-correct
// suppression is harmless because the narrator can still read place from prose.
const TRAVEL_VERB =
  /\b(?:arrive|arrives|arrived|arriving|enter|enters|entered|entering|walk(?:s|ed)? into|step(?:s|ped)? into|reach(?:es|ed)?|pull(?:s|ed)? into|drive(?:s)? to|drove to|head(?:s|ed)? to|made (?:your|their|his|her) way to|cross(?:es|ed)? into)\b/
function recentProseDepictsTravelElsewhere(
  recentNarratorProse: string[],
  currentPlace: Place,
  knownPlaces: Place[],
): boolean {
  const window = recentNarratorProse
    .slice(-2)
    .join('\n')
    .toLowerCase()
  if (!window || !TRAVEL_VERB.test(window)) return false

  const currentKey = currentPlace.name.toLowerCase()
  return knownPlaces.some((p) => {
    if (p.id === currentPlace.id) return false
    const name = p.name.toLowerCase()
    if (name.length < 4 || name === currentKey) return false
    return window.includes(name)
  })
}

function formatScenePacing(scene: Scene): string | null {
  const parts = [
    scene.scene_mood ? `mood ${scene.scene_mood}` : null,
    scene.pace ? `pace ${scene.pace}` : null,
    scene.focus ? `focus ${scene.focus}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join('; ') : null
}

// Player-asserted canon. Written only via the v0.6.6 archivist correction
// channel — never by the narrator-extraction archivist. Treat these as ground
// truth: if prior narration contradicts a line here, retcon gracefully or
// quietly move forward with the corrected version. Never call attention to a
// retcon ("you were never driving a Suburban after all") — fix the word and
// keep going.
function formatPlayerCanonBlock(
  knownCharacters: Character[],
  knownPlaces: Place[],
): string {
  const charactersWithNotes = knownCharacters.filter((c) => c.player_notes?.trim())
  const placesWithNotes = knownPlaces.filter((p) => p.player_notes?.trim())
  if (charactersWithNotes.length === 0 && placesWithNotes.length === 0) return ''

  const lines: string[] = ['## PLAYER CANON', 'Player-asserted ground truth. Respect these without restating them as discoveries.']

  if (charactersWithNotes.length > 0) {
    const sorted = [...charactersWithNotes].sort((a, b) => {
      if (a.is_player !== b.is_player) return a.is_player === 1 ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const c of sorted) {
      for (const line of (c.player_notes ?? '').split('\n').filter((l) => l.trim().length > 0)) {
        lines.push(`- ${c.name}: ${limit(line, 200)}`)
      }
    }
  }

  if (placesWithNotes.length > 0) {
    for (const p of [...placesWithNotes].sort((a, b) => a.name.localeCompare(b.name))) {
      for (const line of (p.player_notes ?? '').split('\n').filter((l) => l.trim().length > 0)) {
        lines.push(`- ${p.name}: ${limit(line, 200)}`)
      }
    }
  }

  return lines.join('\n')
}

function parseOccupancyRow(row: OccupancySnapshotRow | null): PlaceOccupancy | null {
  if (!row) return null
  try {
    return JSON.parse(row.occupancy_json) as PlaceOccupancy
  } catch {
    return null
  }
}

export function formatOccupancyBlock(occupancy: PlaceOccupancy | null): string {
  if (!occupancy || (occupancy.groups.length === 0 && !occupancy.traffic)) return ''
  const lines: string[] = []
  lines.push('### NEARBY (ambient — not durable characters)')
  lines.push(
    'Texture, witnesses, obstacles, and service — use naturally; do not name every person. These are not tracked NPCs unless the protagonist engages them.',
  )
  lines.push(`- density: ${occupancy.density}`)
  for (const g of occupancy.groups) {
    const avail = g.promotable ? ' (could become someone)' : ''
    lines.push(`- ${limit(g.label, 80)} — ${limit(g.behavior, 80)}${avail}`)
  }
  if (occupancy.traffic) {
    const t = occupancy.traffic
    const motion = t.notable_motion ? `; ${t.notable_motion}` : ''
    lines.push(`- traffic: vehicles ${t.vehicles}, pedestrians ${t.pedestrians}${motion}`)
  }
  if (occupancy.encounter_hooks.length > 0) {
    lines.push('- possible encounters (latent — surface only if the protagonist engages; never as a quest marker):')
    for (const h of occupancy.encounter_hooks) {
      lines.push(`  - ${limit(h.narrator_cue, 160)}`)
    }
  }
  return lines.join('\n')
}

export function formatDossierBlock(dossier: StoryDossier): string {
  const lines: string[] = []
  const activeQuests = dossier.threads
    .filter((t) => t.status === 'active' && t.kind === 'quest')
    .slice(0, 4)
  const activeThreads = dossier.threads
    .filter((t) => t.status === 'active' && t.kind !== 'quest')
    .slice(0, 4)
  const activeObjectives = dossier.objectives
    .filter((o) => o.status === 'active' || o.status === 'blocked')
    .slice(0, 5)
  const openClues = dossier.clues
    .filter((c) => c.status === 'open' || c.status === 'interpreted')
    .slice(0, 6)
  const resources = dossier.resources.slice(0, 6)
  const timeline = dossier.timeline.filter((e) => e.importance >= 3).slice(0, 5)

  if (
    activeQuests.length === 0 &&
    activeThreads.length === 0 &&
    activeObjectives.length === 0 &&
    openClues.length === 0 &&
    resources.length === 0 &&
    timeline.length === 0
  ) {
    return ''
  }

  lines.push('## STORY DOSSIER')
  lines.push('Use this as playable pressure, not exposition. Hidden pressure can move the world but must not be blurted out.')

  if (activeQuests.length > 0) {
    lines.push('', '### ACTIVE QUESTS')
    for (const q of activeQuests) {
      const details = [
        q.summary,
        q.stakes ? `stakes: ${q.stakes}` : null,
        q.rewards ? `rewards: ${q.rewards}` : null,
        q.consequences ? `consequences: ${q.consequences}` : null,
      ]
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${q.title}${details ? ` — ${limit(details, 260)}` : ''}`)
      if (q.hidden) lines.push(`  - hidden pressure: ${limit(q.hidden, 180)}`)
    }
  }

  if (activeThreads.length > 0) {
    lines.push('', '### ACTIVE THREADS')
    for (const t of activeThreads) {
      const details = [
        `${t.kind}:`,
        t.summary,
        t.stakes ? `stakes: ${t.stakes}` : null,
        t.consequences ? `consequences: ${t.consequences}` : null,
      ]
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${t.title}${details ? ` — ${limit(details, 220)}` : ''}`)
      if (t.hidden) lines.push(`  - hidden pressure: ${limit(t.hidden, 180)}`)
    }
  }

  if (activeObjectives.length > 0) {
    lines.push('', '### CURRENT OBJECTIVES')
    for (const o of activeObjectives) {
      const detail = [o.detail, o.blocker ? `blocker: ${o.blocker}` : null]
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${o.title}${o.status === 'blocked' ? ' (blocked)' : ''}${detail ? ` — ${limit(detail, 200)}` : ''}`)
    }
  }

  if (openClues.length > 0) {
    lines.push('', '### CLUES')
    for (const c of openClues) {
      const detail = [c.detail, c.implication ? `implies: ${c.implication}` : null]
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${c.title}${c.thread_title ? ` [${c.thread_title}]` : ''}${detail ? ` — ${limit(detail, 220)}` : ''}`)
    }
  }

  if (resources.length > 0) {
    lines.push('', '### RESOURCES')
    for (const r of resources) {
      const owner = r.owner_name ? `${r.owner_name}: ` : ''
      const detail = [r.kind, r.status, r.detail].filter(Boolean).join('; ')
      lines.push(`- ${owner}${r.name}${detail ? ` — ${limit(detail, 180)}` : ''}`)
    }
  }

  if (timeline.length > 0) {
    lines.push('', '### RECENT TIMELINE')
    for (const e of timeline) {
      lines.push(
        `- ${e.thread_title ? `[${e.thread_title}] ` : ''}${e.world_time ? `${e.world_time}: ` : ''}${e.title} — ${limit(e.summary, 180)}`,
      )
    }
  }

  return lines.join('\n')
}

function limit(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1).trimEnd()}...`
}

export function formatPlaceGeo(place: Place): string | null {
  if (place.geo_status !== 'ok') return null
  const parts: string[] = []
  if (place.osm_street) parts.push(place.osm_street)
  if (place.osm_neighborhood && place.osm_neighborhood !== place.osm_street) {
    parts.push(place.osm_neighborhood)
  }
  if (parts.length === 0 && place.osm_display_name) {
    return limit(place.osm_display_name, 160)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

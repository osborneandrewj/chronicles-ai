import {
  getActiveSceneForWorld,
  getCharactersForWorld,
  getCharactersInPlace,
  getPlace,
  getPlacesForWorld,
  getScenesForWorld,
  getStoryDossierForWorld,
  getTurnTimestampsForWorld,
  getWorldCursor,
  type StoryDossier,
} from '@/lib/db'
import { stripFactProvenance } from '@/lib/memorable-facts'

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
  appearance_count: number
  last_seen_turn_id: number | null
  last_agent_tick_turn_id: number | null
  player_notes: string | null
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
}

export type FullWorldState = {
  worldTime: string | null
  currentSceneId: number | null
  characters: Character[]
  places: Place[]
  scenes: Scene[]
  dossier: StoryDossier
  turnTimestamps: Record<number, string>
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

  return {
    worldTime: cursor.world_time,
    currentScene: activeScene,
    currentPlace,
    presentCharacters: [...player, ...npcsInPlace],
    knownCharacters,
    knownPlaces,
    dossier: getStoryDossierForWorld(worldId),
  }
}

export function getFullWorldState(worldId: number): FullWorldState {
  const cursor = getWorldCursor(worldId)
  const turnTimestamps = Object.fromEntries(
    getTurnTimestampsForWorld(worldId).map((turn) => [turn.id, turn.created_at]),
  )
  return {
    worldTime: cursor.world_time,
    currentSceneId: cursor.current_scene_id,
    characters: getCharactersForWorld(worldId),
    places: getPlacesForWorld(worldId),
    scenes: getScenesForWorld(worldId),
    dossier: getStoryDossierForWorld(worldId),
    turnTimestamps,
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

export type NpcPlannedAction = { npc_name: string; intent: string }

export function formatStateBlock(
  state: NarratorWorldState,
  plannedActions: NpcPlannedAction[] = [],
): string {
  const lines: string[] = [
    '## STATE',
    'Listed facts are fixed. Unlisted small, genre-consistent details are open canvas.',
    'The Place line is the protagonist\'s physical location; hold it unless the player or world physically moves them.',
    `- Time: ${state.worldTime ?? '(unset)'}`,
  ]

  if (state.currentScene) {
    lines.push(`- Scene: ${state.currentScene.title} (scene ${state.currentScene.scene_number})`)
  }
  if (state.currentPlace) {
    lines.push(`- Place: ${state.currentPlace.name}`)
    if (state.currentPlace.description) {
      lines.push(`  ${state.currentPlace.description}`)
    }
  }

  if (state.presentCharacters.length > 0) {
    lines.push('', '### Present')
    for (const c of state.presentCharacters) {
      const role = c.is_player === 1 ? 'player' : c.status
      lines.push(`- ${c.name} (${role})${c.description ? ` — ${limit(c.description, 180)}` : ''}`)
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
      // gap-fill) → observed (what they've noticed about the protagonist).
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
            lines.push(`  - observed: ${limit(line, 160)}`)
          }
        }
      }
    }
  }

  // Agent NPCs' planned moves for THIS turn. Decided by the NPC agent before
  // the narrator runs; the narrator stages them as the actual scene rather
  // than improvising those characters' choices. Omitted when there are no
  // present agent NPCs or the agent returned no plans.
  if (plannedActions.length > 0) {
    lines.push('', '### PLANNED MOVES THIS TURN (agent NPCs)')
    for (const p of plannedActions) {
      lines.push(`- **${p.npc_name}** — ${p.intent}`)
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

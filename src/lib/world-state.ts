import {
  getActiveSceneForWorld,
  getCharactersForWorld,
  getCharactersInPlace,
  getPlace,
  getPlacesForWorld,
  getScenesForWorld,
  getWorldCursor,
} from '@/lib/db'
import { stripFactProvenance } from '@/lib/memorable-facts'

export type CharacterAgencyLevel = 'npc' | 'agent'

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
}

export type Place = {
  id: number
  world_id: number
  name: string
  description: string | null
  kind: string | null
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
}

// What the narrator's prompt actually needs each turn. The inspector reads
// the broader shape via getFullWorldState() — keep the two paths separate so
// the narrator doesn't get accidentally fattened with off-scene NPCs.
export type NarratorWorldState = {
  worldTime: string | null
  currentScene: Scene | null
  currentPlace: Place | null
  presentCharacters: Character[]
}

export type FullWorldState = {
  worldTime: string | null
  currentSceneId: number | null
  characters: Character[]
  places: Place[]
  scenes: Scene[]
}

export function getNarratorWorldState(worldId: number): NarratorWorldState {
  const cursor = getWorldCursor(worldId)
  const activeScene = getActiveSceneForWorld(worldId)
  const currentPlace = activeScene?.place_id ? getPlace(activeScene.place_id) : null

  const player = getCharactersForWorld(worldId).filter((c) => c.is_player === 1)
  const npcsInPlace = currentPlace
    ? getCharactersInPlace(worldId, currentPlace.id).filter((c) => c.is_player === 0)
    : []

  return {
    worldTime: cursor.world_time,
    currentScene: activeScene,
    currentPlace,
    presentCharacters: [...player, ...npcsInPlace],
  }
}

export function getFullWorldState(worldId: number): FullWorldState {
  const cursor = getWorldCursor(worldId)
  return {
    worldTime: cursor.world_time,
    currentSceneId: cursor.current_scene_id,
    characters: getCharactersForWorld(worldId),
    places: getPlacesForWorld(worldId),
    scenes: getScenesForWorld(worldId),
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
    '## AUTHORITATIVE STATE',
    'Two layers: FIXED FACTS are ground truth — never silently rewrite them. OPEN CANVAS is',
    'everything the state does not pin down (unspecified equipment, untold history, off-scene',
    'detail) — the player may paint into it with small, fiction-consistent additions, and you',
    'may weave those in. Reserve in-fiction deflection for additions that would shift the power',
    'balance, retcon an established fact, or contradict the premise.',
    '',
    '### FIXED FACTS',
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
      lines.push(`- **${c.name}** (${role})${c.description ? ` — ${c.description}` : ''}`)
      const facts = stripFactProvenance(c.memorable_facts)
      if (facts) {
        for (const fact of facts.split('\n').filter((f) => f.trim().length > 0)) {
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
            lines.push(`  - personal goal: ${goals[0]}`)
          } else {
            lines.push('  - personal goals:')
            for (const g of goals) lines.push(`    - ${g}`)
          }
        }
        if (c.current_focus) lines.push(`  - focus: ${c.current_focus}`)
        if (c.active_goal) lines.push(`  - goal: ${c.active_goal}`)
        if (c.current_attitude) lines.push(`  - attitude: ${c.current_attitude}`)
        const activity = stripFactProvenance(c.recent_activity)
        if (activity) {
          for (const line of activity.split('\n').filter((s) => s.trim().length > 0)) {
            lines.push(`  - activity: ${line}`)
          }
        }
        const obs = stripFactProvenance(c.observations)
        if (obs) {
          for (const line of obs.split('\n').filter((s) => s.trim().length > 0)) {
            lines.push(`  - observed: ${line}`)
          }
        }
      }
    }
  }

  lines.push(
    '',
    '### OPEN CANVAS',
    "Anything not listed above is open. If the player names a small, genre-consistent detail",
    'about themselves or their equipment, weave it into the fiction. Deflect grand additions',
    'inside the story — never out-of-character.',
  )

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

  return lines.join('\n')
}

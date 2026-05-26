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

export function formatStateBlock(state: NarratorWorldState): string {
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
      // Goal / attitude shown only for present NPCs, only when non-null. The
      // narrator may act on these to put pressure on the scene; they are not
      // visible to the player.
      if (c.is_player !== 1) {
        if (c.active_goal) lines.push(`  - goal: ${c.active_goal}`)
        if (c.current_attitude) lines.push(`  - attitude: ${c.current_attitude}`)
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

  return lines.join('\n')
}

import type { MetaStoryBible } from '@/domain/entities'
import type { CharacterRepository, PlaceRepository, WorldRepository } from '@/domain/ports'
import { linkAntagonistCharacter } from '@/domain/services/link-antagonist'

// Ensure hub antagonist is linked after hub seed / meta-story write.
// Idempotent; safe to call on every hub create.

export type EnsureHubAntagonistDeps = {
  worlds: WorldRepository
  characters: CharacterRepository
  places: PlaceRepository
}

function parseMetaStory(raw: string | null): MetaStoryBible | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as MetaStoryBible
  } catch {
    return null
  }
}

export async function ensureHubAntagonist(
  hubWorldId: number,
  deps: EnsureHubAntagonistDeps,
): Promise<number | null> {
  const hub = await deps.worlds.getWorld(hubWorldId)
  if (!hub || hub.world_layer !== 'hub') return null

  const bible = parseMetaStory(hub.meta_story_json)
  const cast = await deps.characters.forWorld(hubWorldId)
  const decision = linkAntagonistCharacter({
    bible,
    hubCharacters: cast,
    existingAntagonistId: hub.antagonist_character_id,
  })

  if (decision.action === 'already_linked') {
    await deps.characters.setClearanceLevel(decision.characterId, 'antagonist')
    return decision.characterId
  }
  if (decision.action === 'match_existing') {
    await deps.characters.setClearanceLevel(decision.characterId, 'antagonist')
    await deps.worlds.setAntagonistCharacterId(hubWorldId, decision.characterId)
    return decision.characterId
  }
  if (decision.action === 'create') {
    const places = await deps.places.forWorld(hubWorldId)
    const home = places[0]?.id ?? null
    const { id } = await deps.characters.add({
      world_id: hubWorldId,
      name: decision.name,
      description: decision.description,
      is_player: 0,
      current_place_id: home,
      role: 'program leadership',
      active_goal: 'Maintain control of the simulation program',
      daily_loop: null,
    })
    await deps.characters.setClearanceLevel(id, 'antagonist')
    await deps.worlds.setAntagonistCharacterId(hubWorldId, id)
    return id
  }
  return null
}

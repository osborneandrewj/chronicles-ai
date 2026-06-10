import type { SimulationSession } from '@/domain/entities'
import type {
  SceneRepository,
  SessionRepository,
  WorldArchetypeProvider,
  WorldRepository,
} from '@/domain/ports'
import type { CharacterRepository } from '@/domain/ports/character-repository'
import type { PlaceRepository } from '@/domain/ports/place-repository'

// ReturnToHub (Phase C, C6) — the awakening. When a subworld exit is detected
// (detectSubworldExit, C5), surface the player into the hub's authored
// simulation room: move the hub's player there, open a fresh scene, point the
// cursor at it, flip the session to in_hub, and set has_awoken=true. That flag is
// the moment the concealment relaxes — the codename and the hidden architecture
// suddenly make sense. Pure orchestration over the ports; the drop-in mirrors
// the createBoundedWorld recipe, re-run against the hub on exit.

export type ReturnToHubInput = {
  session: SimulationSession
}

export type ReturnToHubResult = {
  hubWorldId: number
  sceneId: number
} | null

export type ReturnToHubDeps = {
  worlds: WorldRepository
  places: PlaceRepository
  scenes: SceneRepository
  characters: CharacterRepository
  sessions: SessionRepository
  decks: WorldArchetypeProvider
}

export async function returnToHub(
  { session }: ReturnToHubInput,
  deps: ReturnToHubDeps,
): Promise<ReturnToHubResult> {
  const { characters, decks, places, scenes, sessions, worlds } = deps
  const hubWorldId = session.hub_world_id

  const hub = await worlds.getWorld(hubWorldId)
  if (!hub) return null

  // Resolve the simulation room: the archetype's simulationRoomKey -> that
  // room's display name -> the seeded place with that name. Fall back to the
  // first place so an awakening always has somewhere to land.
  const archetype = hub.template_id ? await decks.getTemplate(hub.template_id) : null
  const simRoomName = archetype?.rooms.find((r) => r.key === archetype.simulationRoomKey)?.name
  const hubPlaces = await places.forWorld(hubWorldId)
  const simPlace = (simRoomName && hubPlaces.find((p) => p.name === simRoomName)) || hubPlaces[0]
  if (!simPlace) return null

  await characters.setPlayersPlace(simPlace.id, hubWorldId)

  const sceneNumber = (await scenes.maxSceneNumber(hubWorldId)) + 1
  const scene = await scenes.add({
    world_id: hubWorldId,
    place_id: simPlace.id,
    title: 'Awakening',
    scene_number: sceneNumber,
    status: 'active',
  })
  await worlds.setCursor(hubWorldId, scene.id)

  await sessions.flip(session.id, 'in_hub')
  await sessions.setAwoken(session.id, true)

  return { hubWorldId, sceneId: scene.id }
}

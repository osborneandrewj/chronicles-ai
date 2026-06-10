import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

// Pure domain service (Phase B, B2) — randomly designate the concealed hub.
//
// The home base must NOT always be a starship: like Assassin's Creed (an Animus
// in an Abstergo lab, a hidden-order chapterhouse, a research compound), the hub
// is one of several authored fixed-geometry archetypes, chosen at world
// creation. Because the hub is concealed until the awakening, the random type is
// also a replay/variety lever — two players awaken into different "real worlds".
//
// Pure + deterministic: the candidate list and the selection seed are injected
// (Math.random is banned in the domain), so tests are reproducible.

export function pickHubArchetype(hubs: WorldArchetype[], seed: number): WorldArchetype {
  if (hubs.length === 0) {
    throw new Error('pickHubArchetype: no hub archetypes available')
  }
  const index = Math.abs(Math.trunc(seed)) % hubs.length
  return hubs[index]
}

import { describe, expect, it } from 'vitest'

import type { PlaceConnection } from '@/domain/entities'
import { buildDeckGraph, isConnected, orphanRooms } from '@/domain/services/deck-graph'
import { pickHubArchetype } from '@/domain/services/pick-hub-archetype'
import {
  WORLD_ARCHETYPES,
  hubArchetypes,
  listWorldArchetypes,
} from '@/infrastructure/world-gen/archetypes'

describe('world archetype registry', () => {
  it('registers multiple archetypes, the ship being one of several', () => {
    expect(listWorldArchetypes().length).toBeGreaterThanOrEqual(4)
    expect(WORLD_ARCHETYPES.has('scout-vessel')).toBe(true)
    expect(WORLD_ARCHETYPES.has('research-facility')).toBe(true)
    expect(WORLD_ARCHETYPES.has('monastery')).toBe(true)
    expect(WORLD_ARCHETYPES.has('bunker')).toBe(true)
  })

  it('every hub archetype has a connected topology and a valid simulation room', () => {
    for (const a of hubArchetypes()) {
      const roomKeys = new Set(a.rooms.map((r) => r.key))
      // Map room keys -> numeric place ids and build PlaceConnection rows, then
      // assert the topology is fully connected (deck-graph traversal check).
      const idByKey = new Map(a.rooms.map((r, i) => [r.key, i]))
      const placeIds = a.rooms.map((_, i) => i)
      const connections = a.edges.map(
        (e) =>
          ({
            world_id: 0,
            from_place_id: idByKey.get(e.from) as number,
            to_place_id: idByKey.get(e.to) as number,
            kind: e.kind,
            bidirectional: e.bidirectional ? 1 : 0,
          }) as PlaceConnection,
      )
      const graph = buildDeckGraph(connections)
      expect(orphanRooms(graph, placeIds)).toEqual([])
      expect(isConnected(graph, placeIds)).toBe(true)
      // The simulation room and entry room reference real rooms.
      expect(a.simulationRoomKey && roomKeys.has(a.simulationRoomKey)).toBe(true)
      if (a.entryLocationKey) expect(roomKeys.has(a.entryLocationKey)).toBe(true)
      // Every crew slot anchors to a real room.
      for (const slot of a.crew) expect(roomKeys.has(slot.homeRoomKey)).toBe(true)
    }
  })
})

describe('pickHubArchetype', () => {
  it('is deterministic under a seed', () => {
    const hubs = hubArchetypes()
    expect(pickHubArchetype(hubs, 7).id).toBe(pickHubArchetype(hubs, 7).id)
  })

  it('selects different hubs for different seeds across the pool', () => {
    const hubs = hubArchetypes()
    const picked = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((s) => pickHubArchetype(hubs, s).id))
    expect(picked.size).toBeGreaterThan(1)
  })

  it('always returns a hub from the pool', () => {
    const hubs = hubArchetypes()
    for (let s = 0; s < 20; s++) {
      expect(hubs.some((h) => h.id === pickHubArchetype(hubs, s).id)).toBe(true)
    }
  })

  it('throws when there are no hub archetypes', () => {
    expect(() => pickHubArchetype([], 1)).toThrow()
  })
})

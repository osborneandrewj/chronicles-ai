import { describe, expect, it } from 'vitest'

import type { PlaceConnection } from '@/domain/entities'
import type { WorldTimeBand } from '@/domain/services/world-clock'
import { buildDeckGraph, isConnected, orphanRooms } from '@/domain/services/deck-graph'
import { AuthoredDeckPlanProvider } from '@/infrastructure/world-gen/deck-plan-provider'
import { SCOUT_TEMPLATE_ID } from '@/infrastructure/world-gen/scout-template'
import { StubCrewGenerator } from '@/infrastructure/world-gen/stub-crew-generator'

// Unit tests for the starship P1 world-gen seam: the authored DeckPlanProvider
// (returns a single connected scout template) and the deterministic
// StubCrewGenerator (3–5 crew with valid room-key references), neither of which
// touches the LLM or the DB.

const BANDS: WorldTimeBand[] = ['morning', 'midday', 'evening', 'night']

// Build PlaceConnection rows from the template edges by assigning each room key
// a synthetic place id, so the pure deck-graph services can validate topology.
function connectionsFromTemplate(
  rooms: { key: string }[],
  edges: { from: string; to: string; bidirectional: boolean }[],
): { connections: PlaceConnection[]; placeIds: number[]; idOf: Map<string, number> } {
  const idOf = new Map<string, number>()
  rooms.forEach((r, i) => idOf.set(r.key, i + 1))
  const connections: PlaceConnection[] = edges.map((e, i) => ({
    id: i + 1,
    world_id: 1,
    from_place_id: idOf.get(e.from) as number,
    to_place_id: idOf.get(e.to) as number,
    kind: 'corridor',
    bidirectional: e.bidirectional ? 1 : 0,
    created_at: null,
  }))
  return { connections, placeIds: [...idOf.values()], idOf }
}

describe('AuthoredDeckPlanProvider', () => {
  const provider = new AuthoredDeckPlanProvider()

  it('returns the scout template for its id', async () => {
    const template = await provider.getTemplate(SCOUT_TEMPLATE_ID)
    expect(template).not.toBeNull()
    expect(template?.id).toBe(SCOUT_TEMPLATE_ID)
    expect(template?.rooms.length).toBeGreaterThanOrEqual(6)
  })

  it('returns null for an unknown template id', async () => {
    expect(await provider.getTemplate('no-such-ship')).toBeNull()
  })

  it('returns a single connected component (no orphan rooms)', async () => {
    const template = await provider.getTemplate(SCOUT_TEMPLATE_ID)
    const { connections, placeIds } = connectionsFromTemplate(
      template!.rooms,
      template!.edges,
    )
    const graph = buildDeckGraph(connections)
    expect(orphanRooms(graph, placeIds)).toEqual([])
    expect(isConnected(graph, placeIds)).toBe(true)
  })

  it('anchors every crew slot to a real room key', async () => {
    const template = await provider.getTemplate(SCOUT_TEMPLATE_ID)
    const roomKeys = new Set(template!.rooms.map((r) => r.key))
    expect(template!.crew.length).toBeGreaterThanOrEqual(3)
    expect(template!.crew.length).toBeLessThanOrEqual(5)
    for (const slot of template!.crew) {
      expect(roomKeys.has(slot.homeRoomKey)).toBe(true)
    }
  })
})

describe('StubCrewGenerator', () => {
  const provider = new AuthoredDeckPlanProvider()
  const stub = new StubCrewGenerator()

  it('produces 3–5 crew, one per template slot', async () => {
    const template = await provider.getTemplate(SCOUT_TEMPLATE_ID)
    const result = await stub.generate({ template: template!, premise: 'A deep-space scouting run.' })
    expect(result.crew.length).toBe(template!.crew.length)
    expect(result.crew.length).toBeGreaterThanOrEqual(3)
    expect(result.crew.length).toBeLessThanOrEqual(5)
  })

  it('references only real room keys for home rooms and daily loops', async () => {
    const template = await provider.getTemplate(SCOUT_TEMPLATE_ID)
    const result = await stub.generate({ template: template!, premise: 'A deep-space scouting run.' })
    const roomKeys = new Set(template!.rooms.map((r) => r.key))
    const roomNames = new Set(template!.rooms.map((r) => r.name))
    for (const member of result.crew) {
      expect(roomKeys.has(member.homeRoomKey)).toBe(true)
      for (const band of BANDS) {
        const entry = member.dailyLoop[band]
        expect(entry).toBeDefined()
        expect(roomKeys.has(entry.place) || roomNames.has(entry.place)).toBe(true)
      }
    }
  })

  it('emits relationships within −1..1 valence between real crew roles', async () => {
    const template = await provider.getTemplate(SCOUT_TEMPLATE_ID)
    const result = await stub.generate({ template: template!, premise: 'A deep-space scouting run.' })
    const roles = new Set(result.crew.map((c) => c.role))
    for (const rel of result.relationships) {
      expect(roles.has(rel.fromRole)).toBe(true)
      expect(roles.has(rel.toRole)).toBe(true)
      expect(rel.valence).toBeGreaterThanOrEqual(-1)
      expect(rel.valence).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic for the same template', async () => {
    const template = await provider.getTemplate(SCOUT_TEMPLATE_ID)
    const a = await stub.generate({ template: template!, premise: 'Run A.' })
    const b = await stub.generate({ template: template!, premise: 'Run A.' })
    expect(a.crew.map((c) => c.name)).toEqual(b.crew.map((c) => c.name))
  })
})

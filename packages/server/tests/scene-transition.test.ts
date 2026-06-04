import { describe, expect, it } from 'vitest'

import { decideSceneTransition } from '@/domain/services/scene-transition'

// Characterization tests for the pure scene-transition INVARIANT extracted from
// the applyArchivistPatch transaction (P4). Seeded directly from the known
// prod-bug scenarios: the world-13 teleport (player-authored arrival, no NPC
// cluster) and the Call-In Case turn 403 (NPC cluster relocates; the backward
// "home flip" must NOT fire). The same branches are also covered end-to-end
// through applyArchivistPatch in archivist.test.ts; this freezes the decision.

const NONE = { relocatedNpcByPlace: new Map<number, string[]>(), npcPlacesInPatch: new Set<number>() }

describe('decideSceneTransition — player-move branch (world-13 teleport fix)', () => {
  it('opens at the player new place when the patch moves the player and no scene action', () => {
    const intent = decideSceneTransition({
      sceneUnchanged: true,
      playerPlaceFromPatch: 99, // safe house
      scenePlaceId: 12, // transit anchor
      playerPlaceId: 12,
      ...NONE,
    })
    expect(intent).toEqual({ placeId: 99, reason: 'player-move', priorScenePlaceId: 12 })
  })

  it('does not fire when the player place equals the current scene place', () => {
    expect(
      decideSceneTransition({
        sceneUnchanged: true,
        playerPlaceFromPatch: 12,
        scenePlaceId: 12,
        playerPlaceId: 12,
        ...NONE,
      }),
    ).toBeNull()
  })

  it('suppresses the move when an NPC is pinned to the old scene place (backward home-flip guard)', () => {
    // Call-In turn 403: player sent home (place 5) while a hospital NPC is
    // explicitly restated at the hospital (the old scene place 12).
    const intent = decideSceneTransition({
      sceneUnchanged: true,
      playerPlaceFromPatch: 5, // home
      scenePlaceId: 12, // hospital
      playerPlaceId: 12,
      relocatedNpcByPlace: new Map(),
      npcPlacesInPatch: new Set([12]), // NPC pinned to the old scene place
    })
    expect(intent).toBeNull()
  })
})

describe('decideSceneTransition — NPC-cluster fallback (Call-In Case)', () => {
  it('infers the move from a clear NPC cluster when the player location was dropped', () => {
    const intent = decideSceneTransition({
      sceneUnchanged: true,
      playerPlaceFromPatch: null,
      scenePlaceId: 3, // harbour
      playerPlaceId: 3,
      relocatedNpcByPlace: new Map([[7, ['Micha', 'Karen']]]), // hospital
      npcPlacesInPatch: new Set([7]),
    })
    expect(intent).toEqual({ placeId: 7, reason: 'npc-cluster', priorScenePlaceId: 3 })
  })

  it('does not fire without a clear majority cluster', () => {
    expect(
      decideSceneTransition({
        sceneUnchanged: true,
        playerPlaceFromPatch: null,
        scenePlaceId: 3,
        playerPlaceId: 3,
        relocatedNpcByPlace: new Map([
          [7, ['Micha']],
          [8, ['Karen']],
        ]),
        npcPlacesInPatch: new Set([7, 8]),
      }),
    ).toBeNull()
  })

  it('does not fire when the player is moving AWAY from the cluster (turn-403 shape)', () => {
    expect(
      decideSceneTransition({
        sceneUnchanged: true,
        playerPlaceFromPatch: 3, // player stays at harbour
        scenePlaceId: 3,
        playerPlaceId: 3,
        relocatedNpcByPlace: new Map([[7, ['Micha', 'Karen']]]),
        npcPlacesInPatch: new Set([7]),
      }),
    ).toBeNull()
  })

  it('does not fire when the inferred place is already the scene place', () => {
    expect(
      decideSceneTransition({
        sceneUnchanged: true,
        playerPlaceFromPatch: null,
        scenePlaceId: 7,
        playerPlaceId: 7,
        relocatedNpcByPlace: new Map([[7, ['Micha', 'Karen']]]),
        npcPlacesInPatch: new Set([7]),
      }),
    ).toBeNull()
  })
})

describe('decideSceneTransition — gating', () => {
  it('never fires when the patch already changed the scene', () => {
    expect(
      decideSceneTransition({
        sceneUnchanged: false,
        playerPlaceFromPatch: 99,
        scenePlaceId: 12,
        playerPlaceId: 12,
        ...NONE,
      }),
    ).toBeNull()
  })
})

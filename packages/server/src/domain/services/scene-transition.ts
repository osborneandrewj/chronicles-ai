// Pure domain service (P4, spec §5.1-P4 item 2, §5.4): the deterministic
// scene-transition INVARIANT. Given the travel signals gathered while applying
// a patch (the player's own place move, the relocated-NPC cluster, the set of
// places NPCs were pinned to) plus the current scene/player place ids, it
// DECIDES whether a new scene must auto-open and at which place — and returns
// that decision as an INTENT. It issues no I/O: the caller reads the ids
// (inside its transaction) and applies the returned intent (auto-close prior
// scene → open a new "Arriving at …" scene → drag the player along).
//
// This is the load-bearing fix for the Call-In Case (world 6, turn 403:
// hospital NPCs explicitly pinned to the hospital while the player is sent home
// — the backward "home flip" the guard suppresses) and the world-13 teleport
// (player authored arrival with no NPC cluster, so the v0.6.10 branch never
// fired and the cursor stayed pinned to the transit anchor). Extracted verbatim
// from the applyArchivistPatch transaction (no behavior change); the
// archivist.test.ts scene-invariant tests cover all four branches.

export type SceneTransitionIntent = {
  // The place id a new scene must open at, dragging the player along.
  placeId: number
  // Which signal fired — preserved so the caller can emit the same warn payload.
  reason: 'player-move' | 'npc-cluster'
  // The scene place id observed before firing (for the warn payload / audit).
  priorScenePlaceId: number | null
}

export type SceneTransitionInputs = {
  // True when the patch did NOT itself open/close a scene (only then does the
  // invariant get to infer a transition).
  sceneUnchanged: boolean
  // The place id the player row was moved to by this patch, or null.
  playerPlaceFromPatch: number | null
  // place_id -> names of non-player NPCs RELOCATED to it this patch.
  relocatedNpcByPlace: Map<number, string[]>
  // All place ids any NPC was pinned to this patch (relocations + no-op
  // restatements) — the backward "home flip" signal.
  npcPlacesInPatch: Set<number>
  // The active scene's place id (read inside the caller's transaction).
  scenePlaceId: number | null
  // The player row's persisted place id (read inside the caller's transaction).
  playerPlaceId: number | null
}

// Returns the scene-open intent to apply, or null to leave the cursor alone.
// Mirrors the original two-branch order exactly: the player's OWN move is
// checked first (most reliable), then the NPC-cluster fallback.
export function decideSceneTransition(inputs: SceneTransitionInputs): SceneTransitionIntent | null {
  const {
    sceneUnchanged,
    playerPlaceFromPatch,
    relocatedNpcByPlace,
    npcPlacesInPatch,
    scenePlaceId,
    playerPlaceId,
  } = inputs

  if (!sceneUnchanged) return null

  // v0.6.19 (A1-i): the protagonist's OWN place change is the most reliable
  // travel signal. Do not auto-open at the player's new place if it would
  // abandon the present cast — the patch explicitly assigns non-player NPCs to
  // the OLD scene place (the backward "home flip" signature). Residual NPCs not
  // mentioned in this patch are not a signal — that is forward travel.
  if (playerPlaceFromPatch !== null) {
    const presentNpcsLeftBehind = scenePlaceId !== null && npcPlacesInPatch.has(scenePlaceId)
    if (playerPlaceFromPatch !== scenePlaceId && !presentNpcsLeftBehind) {
      return { placeId: playerPlaceFromPatch, reason: 'player-move', priorScenePlaceId: scenePlaceId }
    }
  }

  // v0.6.10: NPC-cluster fallback — infer the move from the relocated NPC
  // cluster when the player's own location was dropped.
  if (relocatedNpcByPlace.size > 0) {
    let inferredPlaceId: number | null = null
    let topCount = 0
    let totalRelocated = 0
    for (const [pid, names] of relocatedNpcByPlace) {
      totalRelocated += names.length
      if (names.length > topCount) {
        topCount = names.length
        inferredPlaceId = pid
      }
    }
    const clearMajority = inferredPlaceId !== null && topCount * 2 > totalRelocated
    const movingPlayerAway =
      playerPlaceFromPatch !== null && playerPlaceFromPatch !== inferredPlaceId

    if (
      clearMajority &&
      inferredPlaceId !== scenePlaceId &&
      inferredPlaceId !== playerPlaceId &&
      !movingPlayerAway
    ) {
      return { placeId: inferredPlaceId!, reason: 'npc-cluster', priorScenePlaceId: scenePlaceId }
    }
  }

  return null
}

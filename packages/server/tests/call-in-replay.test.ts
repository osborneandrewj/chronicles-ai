import { existsSync } from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { applyArchivistPatch, type ArchivistPatch } from '@/lib/archivist'
import { getActiveSceneForWorld, getWorldCursor, insertTurn } from '@/lib/db'
import { createWorld } from '@/lib/worlds'

// v0.6.10 exit-criterion 5: replay the real stored archivist patches from the
// "Call-In Case" (world 6, turns 389-403) through the new applyArchivistPatch
// and confirm the scene-transition invariant fires once on the first NPC
// relocation (389), stays put through the hospital turns (391-401), and does
// NOT fire on the backward home flip (403).
//
// The backup lives under backups/ (git-ignored), so this is a local-only
// confidence check that skips cleanly in CI. It reads the patches via its own
// read-only better-sqlite3 handle — like migrations.test.ts, it bypasses the
// app db singleton for reads — and replays them against the in-memory
// singleton used by every other test. The synthetic forward/backward cases in
// archivist.test.ts are the permanent regression guard; this exercises the
// real, messy patch shapes (sub-room place names that canonicalise to one
// hospital, NPC renames, no-op restatements like "Jordana still at home").
const BACKUP = path.join(
  process.cwd(),
  'backups',
  'chronicles.sqlite.pre-call-in-fix-20260528-122419',
)
// Odd ids are the narrator turns; the archivist patch is stored on each.
const NARRATOR_TURNS = [389, 391, 393, 395, 397, 399, 401, 403]

function loadStoredPatches(): Map<number, ArchivistPatch> {
  const src = new Database(BACKUP, { readonly: true })
  try {
    const stmt = src.prepare(
      "SELECT id, json_extract(metadata, '$.archivist.patch') AS patch FROM turns WHERE id = ?",
    )
    const patches = new Map<number, ArchivistPatch>()
    for (const id of NARRATOR_TURNS) {
      const row = stmt.get(id) as { id: number; patch: string | null } | undefined
      if (row?.patch) patches.set(id, JSON.parse(row.patch) as ArchivistPatch)
    }
    return patches
  } finally {
    src.close()
  }
}

describe.skipIf(!existsSync(BACKUP))('Call-In Case replay (v0.6.10 invariant)', () => {
  it('fires on the first NPC relocation (389), holds through 391-401, and not on the 403 home flip', () => {
    const patches = loadStoredPatches()
    expect(patches.size).toBe(NARRATOR_TURNS.length)

    // Reconstruct the turn-388 starting state: protagonist at home, scene at
    // home, no hospital place yet. (createWorld trims the place name at the
    // first comma; this name has none.)
    const world = createWorld({
      name: 'Call-In replay',
      premise: 'A radiologist takes an off-hours call.',
      initialState: {
        time: 'Late evening',
        location: 'Andrew and Jordana Osborne home',
        identity: 'On-call interventional radiologist.',
        playerName: 'Andrew Osborne',
      },
    })
    const originScene = getActiveSceneForWorld(world.id)!

    // Complete the turn-388 reconstruction: the family NPCs already exist at
    // home. Without this, turn 389's "Jordana still at home" line is read as a
    // NEW row relocating to home, which splits the relocation vote against
    // Micha→hospital and the invariant silently no-ops (criterion 5's warned
    // failure mode). With them pre-placed, the restatement is correctly a
    // no-op and the lone hospital relocation wins the vote.
    const seedTurn = insertTurn(world.id, 'assistant', 'turn-388 home state', null)
    applyArchivistPatch(world.id, seedTurn.id, {
      characters: [
        'Jordana Osborne',
        'James Osborne',
        'Desiree Osborne',
        'Jacqueline Osborne',
        'Carlie Osborne',
      ].map((name) => ({
        name,
        description: 'Family member at home.',
        current_place_name: 'Andrew and Jordana Osborne home',
      })),
    })

    const cursorAfter = new Map<number, number | null>()
    for (const turnNumber of NARRATOR_TURNS) {
      const turn = insertTurn(world.id, 'assistant', `replay narrator turn ${turnNumber}`, null)
      applyArchivistPatch(world.id, turn.id, patches.get(turnNumber)!)
      cursorAfter.set(turnNumber, getWorldCursor(world.id).current_scene_id)
    }

    // 389: the cursor advanced off the origin scene (invariant fired) to a
    // hospital scene the protagonist was dragged into.
    const sceneAfter389 = cursorAfter.get(389)!
    expect(sceneAfter389).not.toBe(originScene.id)

    // 391-401: every hospital sub-room canonicalises to the same place, so no
    // further relocation is detected — the cursor holds steady.
    for (const t of [391, 393, 395, 397, 399, 401]) {
      expect(cursorAfter.get(t)).toBe(sceneAfter389)
    }

    // 403: the patch flips the player home while the (already-placed) hospital
    // NPCs are restated, not relocated — the invariant must not advance the
    // cursor again.
    expect(cursorAfter.get(403)).toBe(sceneAfter389)
  })
})

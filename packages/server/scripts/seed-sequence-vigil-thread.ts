// One-off, IDEMPOTENT data seed: author a starter story_thread (+ objectives +
// clue) for the world named "Sequence Vigil", which has played 25 turns with an
// empty dossier because the Haiku archivist never emitted a thread under the
// bootstrap mandate (see docs/plans/thread-bootstrap-and-npc-plans.md, item A).
//
// Runs through the REAL DossierWriter port so the integer id is allocated by the
// same nextSeq('storyThreadId') counter the runtime uses (no id collision),
// titleKey/timestamps/unique-index are all handled, and the write surfaces in
// the dossier read path immediately.
//
// Run (local Mongo, the dev store):
//   PERSISTENCE=mongo \
//   DATABASE_URL='mongodb://localhost:27017/chronicles?replicaSet=rs0' \
//   npx tsx --conditions=react-server packages/server/scripts/seed-sequence-vigil-thread.ts
//
// Back up first (CLAUDE.md data-repair rule). Idempotent: re-running detects the
// existing thread by title and skips.

import { initContainer } from '@/composition/container'

const WORLD_NAME = 'Sequence Vigil'
const THREAD_TITLE = 'The Sealed Papyrus'

async function main(): Promise<void> {
  console.log(`[seed] PERSISTENCE=${process.env.PERSISTENCE ?? '(default sqlite)'}`)
  const container = await initContainer()
  const { worlds, dossiers, dossierWriter } = container

  const summaries = await worlds.listWorlds()
  const target = summaries.find((w) => w.name === WORLD_NAME)
  if (!target) {
    console.error(
      `[seed] No world named "${WORLD_NAME}" in this store. Worlds seen: ` +
        summaries.map((w) => `${w.id}:${w.name}`).join(', '),
    )
    process.exit(1)
  }
  const worldId = target.id
  console.log(`[seed] Resolved "${WORLD_NAME}" → world id ${worldId}`)

  const existing = await dossierWriter.threadByTitle(worldId, THREAD_TITLE)
  if (existing) {
    console.log(`[seed] Thread "${THREAD_TITLE}" already exists (id ${existing.id}) — nothing to do.`)
    process.exit(0)
  }

  const { id: threadId } = await dossierWriter.insertThread({
    world_id: worldId,
    title: THREAD_TITLE,
    kind: 'threat',
    status: 'active',
    summary:
      'As a House-of-Life scribe in Thebes under an ailing Ramesses III, you carry a sealed ' +
      'papyrus that implicates a court conspiracy — a contested cartouche, a heretic successor, ' +
      'and a harem plot. Merely holding it is a death sentence; reading, delivering, or destroying ' +
      'it each commits you to a side.',
    stakes:
      'Discovery of the letter means execution for treason; its contents could topple a successor ' +
      'or expose a plot reaching the throne while the pharaoh weakens.',
    rewards: null,
    consequences: 'The conspiracy escalates while Pharaoh weakens — inaction is not neutral.',
    hidden: null,
    relevance_tags_json: JSON.stringify([
      'thebes',
      'temple',
      'conspiracy',
      'courier',
      'papyrus',
      'succession',
    ]),
    source_turn_id: null,
  })
  console.log(`[seed] Inserted thread "${THREAD_TITLE}" → id ${threadId}`)

  const objectives = [
    {
      title: "Reach the vizier's scribes",
      detail:
        "Setnakht the fish vendor pointed to the vizier's scribes in the outer court, east of the " +
        'temple of Amun — they handle sealed state correspondence and could read or route the letter.',
    },
    {
      title: 'Seek the old priests of the western tombs',
      detail:
        'Old priests among the western tombs remember past harem conspiracies and may decode whose ' +
        'plot this is.',
    },
    {
      title: 'Destroy the letter and flee Thebes',
      detail:
        "Setnakht's third counsel: burn the papyrus and leave the city before the seal is ever " +
        'traced to you.',
    },
  ]
  for (const o of objectives) {
    const { id } = await dossierWriter.insertObjective({
      world_id: worldId,
      thread_id: threadId,
      title: o.title,
      status: 'active',
      detail: o.detail,
      blocker: null,
      source_turn_id: null,
    })
    console.log(`[seed]   objective "${o.title}" → id ${id}`)
  }

  const { id: clueId } = await dossierWriter.insertClue({
    world_id: worldId,
    thread_id: threadId,
    title: 'The intact official seal',
    detail: 'The papyrus is still sealed with an official cartouche-stamp.',
    implication: 'Breaking it is irreversible and marks you as having read state correspondence.',
    status: 'open',
    source_turn_id: null,
  })
  console.log(`[seed]   clue "The intact official seal" → id ${clueId}`)

  // Read back through the dossier read path to verify it surfaces.
  const dossier = await dossiers.forWorld(worldId)
  const active = dossier.threads.filter((t) => t.status === 'active')
  console.log(
    `[seed] Read-back: ${dossier.threads.length} thread(s), ${active.length} active; ` +
      `objectives=${dossier.objectives.length}, clues=${dossier.clues.length}`,
  )
  console.log('[seed] Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[seed] FAILED:', err)
  process.exit(1)
})

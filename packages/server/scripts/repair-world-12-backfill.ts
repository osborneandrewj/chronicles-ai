// scripts/repair-world-12-backfill.ts
// Usage: DATABASE_PATH=./local-copy.sqlite ANTHROPIC_API_KEY=... npx tsx scripts/repair-world-12-backfill.ts
//
// Re-runs the hardened archivist over world 12's recent transcript with the
// dossier bootstrap forced on, seeding the ambush threat / map clue / warn-
// command objective / timeline. DATABASE_PATH must point at the SQLite file the
// app's db module opens (default is cwd/chronicles.sqlite).
import { applyArchivistPatch, extractPatch } from '@/lib/archivist'
import { recentTurns, latestTurn } from '@/lib/db'
import { getNarratorWorldState } from '@/lib/world-state'
import { getWorld } from '@/lib/worlds'

const WORLD_ID = 12

async function main() {
  const world = getWorld(WORLD_ID)
  if (!world) throw new Error('world 12 not found at DATABASE_PATH')
  const prior = getNarratorWorldState(WORLD_ID)
  const recent = recentTurns(WORLD_ID, 8).map((t) => ({ role: t.role, content: t.content }))
  const narratorTurnId = latestTurn(WORLD_ID)?.id ?? 0
  const { patch } = await extractPatch(
    world.premise,
    prior,
    recent,
    null,
    false,
    true, // bootstrapDossier — force at least one thread
  )
  console.log('PATCH:', JSON.stringify(patch, null, 2))
  applyArchivistPatch(WORLD_ID, narratorTurnId, patch)
  console.log('Applied. Re-open the Story tab for world 12 to verify.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

import { db } from '@/lib/db'
import type { Character } from '@/lib/world-state'

// An NPC becomes agent-tier after this many distinct turns in scene with the
// protagonist. Three is enough to filter out one-shot walk-ons (the bartender
// who pours one drink) while catching recurring characters. Counted
// deterministically by code, not the LLM — predictable and free.
const AUTO_PROMOTE_THRESHOLD = 3

const bumpAppearanceStmt = db.prepare<[number]>(
  `UPDATE characters
      SET appearance_count = appearance_count + 1,
          updated_at = datetime('now')
    WHERE id = ?`,
)
const promoteToAgentStmt = db.prepare<[number]>(
  `UPDATE characters
      SET agency_level = 'agent',
          updated_at = datetime('now')
    WHERE id = ?
      AND agency_level = 'npc'
      AND is_player = 0`,
)

// Bumps appearance_count for each present NPC and auto-promotes any that
// cross the threshold. Returns the names of NPCs newly promoted on this call,
// for metadata / logging. Called between the archivist apply and the NPC
// agent tick so newly-promoted NPCs immediately get their first agent pass.
export function recordAppearancesAndAutoPromote(
  presentCharacters: Character[],
): { promoted: string[]; counted: number } {
  // Player and dead characters don't count toward promotion.
  const eligible = presentCharacters.filter(
    (c) => c.is_player === 0 && c.status !== 'dead',
  )
  if (eligible.length === 0) return { promoted: [], counted: 0 }

  const promoted: string[] = []
  const tx = db.transaction(() => {
    for (const c of eligible) {
      bumpAppearanceStmt.run(c.id)
      // appearance_count on the in-memory row is stale; the row was read
      // before the bump. New count = c.appearance_count + 1.
      const newCount = c.appearance_count + 1
      if (newCount >= AUTO_PROMOTE_THRESHOLD && c.agency_level === 'npc') {
        const res = promoteToAgentStmt.run(c.id)
        if (res.changes > 0) promoted.push(c.name)
      }
    }
  })
  tx()

  return { promoted, counted: eligible.length }
}

export const NPC_AUTO_PROMOTE_THRESHOLD = AUTO_PROMOTE_THRESHOLD

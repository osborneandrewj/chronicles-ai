import { db } from '@/lib/db'
import type { Character, CharacterAgencyLevel } from '@/lib/world-state'

// An NPC becomes agent-tier after this many distinct turns in scene with the
// protagonist. Three is enough to filter out one-shot walk-ons (the bartender
// who pours one drink) while catching recurring characters. Counted
// deterministically by code, not the LLM — predictable and free.
const AUTO_PROMOTE_THRESHOLD = 3

const bumpAppearanceStmt = db.prepare<[number, number]>(
  `UPDATE characters
      SET appearance_count = appearance_count + 1,
          last_seen_turn_id = ?,
          updated_at = datetime('now')
    WHERE id = ?`,
)
const promoteToLocalStmt = db.prepare<[number, number]>(
  `UPDATE characters
      SET agency_level = 'local',
          last_seen_turn_id = ?,
          updated_at = datetime('now')
    WHERE id = ?
      AND agency_level = 'npc'
      AND is_player = 0`,
)
const setAgencyLevelStmt = db.prepare<[CharacterAgencyLevel, number]>(
  `UPDATE characters SET agency_level = ?, updated_at = datetime('now') WHERE id = ?`,
)
const demoteTransientServiceNpcStmt = db.prepare<[number]>(
  `UPDATE characters
      SET agency_level = 'npc',
          active_goal = NULL,
          current_focus = NULL,
          updated_at = datetime('now')
    WHERE id = ?`,
)
const allNonPlayerCharactersStmt = db.prepare<[number]>(
  `SELECT id, name, description, agency_level, active_goal, personal_goals, current_focus, last_seen_turn_id
   FROM characters
   WHERE world_id = ? AND is_player = 0 AND status != 'dead'`,
)

// Bumps appearance_count for each present NPC and auto-promotes any that
// cross the threshold. Returns the names of NPCs newly promoted on this call,
// for metadata / logging. Called between the archivist apply and the NPC
// agent tick so newly-promoted NPCs immediately get their first agent pass.
export function recordAppearancesAndAutoPromote(
  worldId: number,
  presentCharacters: Character[],
  turnId: number,
): {
  promoted: string[]
  counted: number
  tiers: Record<'local' | 'nearby' | 'distant' | 'dormant' | 'demoted', string[]>
} {
  // Player and dead characters don't count toward promotion.
  const eligible = presentCharacters.filter(
    (c) => c.is_player === 0 && c.status !== 'dead' && !isTransientServiceNpc(c),
  )
  const transientPresent = presentCharacters.filter(
    (c) => c.is_player === 0 && c.status !== 'dead' && isTransientServiceNpc(c),
  )
  const promoted: string[] = []
  const tiers = {
    local: [] as string[],
    nearby: [] as string[],
    distant: [] as string[],
    dormant: [] as string[],
    demoted: [] as string[],
  }
  const presentIds = new Set(eligible.map((c) => c.id))
  const transientPresentIds = new Set(transientPresent.map((c) => c.id))

  const tx = db.transaction(() => {
    for (const c of eligible) {
      bumpAppearanceStmt.run(turnId, c.id)
      // appearance_count on the in-memory row is stale; the row was read
      // before the bump. New count = c.appearance_count + 1.
      const newCount = c.appearance_count + 1
      if (newCount >= AUTO_PROMOTE_THRESHOLD && c.agency_level === 'npc') {
        const res = promoteToLocalStmt.run(turnId, c.id)
        if (res.changes > 0) promoted.push(c.name)
      } else if (c.agency_level !== 'npc' && c.agency_level !== 'local') {
        setAgencyLevelStmt.run('local', c.id)
        tiers.local.push(c.name)
      }
    }

    for (const c of transientPresent) {
      if (c.agency_level !== 'npc' || c.active_goal || c.current_focus) {
        demoteTransientServiceNpcStmt.run(c.id)
        tiers.demoted.push(c.name)
      }
    }

    const rows = allNonPlayerCharactersStmt.all(worldId) as Array<{
      id: number
      name: string
      description: string | null
      agency_level: CharacterAgencyLevel | 'agent'
      active_goal: string | null
      personal_goals: string | null
      current_focus: string | null
      last_seen_turn_id: number | null
    }>

    for (const c of rows) {
      if (isTransientServiceNpc(c)) {
        if (transientPresentIds.has(c.id)) continue
        if (c.agency_level !== 'npc' || c.active_goal || c.current_focus) {
          demoteTransientServiceNpcStmt.run(c.id)
          tiers.demoted.push(c.name)
        }
        continue
      }
      if (presentIds.has(c.id) || c.agency_level === 'npc') continue

      const lastSeen = c.last_seen_turn_id
      const turnsAway = lastSeen === null ? Number.POSITIVE_INFINITY : turnId - lastSeen
      const hasOpenThread = !!(c.active_goal || c.personal_goals || c.current_focus)
      let next: CharacterAgencyLevel

      if (turnsAway <= 3) next = 'nearby'
      else if (turnsAway <= 10) next = 'distant'
      else if (turnsAway <= 20 || (hasOpenThread && turnsAway <= 40)) next = 'dormant'
      else next = 'npc'

      if (c.agency_level === next) continue
      setAgencyLevelStmt.run(next, c.id)
      if (next === 'npc') tiers.demoted.push(c.name)
      else tiers[next].push(c.name)
    }
  })
  tx()

  return { promoted, counted: eligible.length, tiers }
}

export const NPC_AUTO_PROMOTE_THRESHOLD = AUTO_PROMOTE_THRESHOLD

function isTransientServiceNpc(c: {
  name: string
  description: string | null
  active_goal?: string | null
  personal_goals?: string | null
  current_focus?: string | null
}): boolean {
  const text = `${c.name} ${c.description ?? ''}`.toLowerCase()
  const serviceRole =
    /\b(usps|postal|mail carrier|mailman|mailwoman|courier|delivery driver|package driver|parcel carrier|fedex|ups|doordash|rideshare|taxi driver|cashier|receptionist|clerk|server|barista)\b/.test(
      text,
    )

  if (!serviceRole) return false

  const durableSignals = `${c.personal_goals ?? ''} ${c.current_focus ?? ''} ${c.active_goal ?? ''}`.toLowerCase()
  return !/\b(minerva|black cloak|caesar|threat|follow|stalk|watch|spy|warn|secret|conspiracy|murder|missing|romance|debt|promise|protect|investigate)\b/.test(
    durableSignals,
  )
}

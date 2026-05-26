import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, type LanguageModelUsage } from 'ai'
import { z } from 'zod'

import { db } from '@/lib/db'
import { appendFactWithProvenance, stripFactProvenance } from '@/lib/memorable-facts'
import { loadPrompt } from '@/lib/prompt-files'

// Per-NPC update emitted by the NPC agent. Each field is independently
// optional; only fields named in the patch are touched. Names are matched
// case-insensitively against existing characters in the same world.
const NpcUpdateSchema = z.object({
  name: z
    .string()
    .describe('Existing agent-tier NPC name. Case-insensitive match. The player is never a valid target.'),
  current_focus: z
    .string()
    .optional()
    .describe(
      "What the NPC is currently doing or thinking about — short, present-tense. Overwrites prior value.",
    ),
  activity_append: z
    .string()
    .optional()
    .describe(
      'A single short past-tense sentence describing what this NPC did during this turn (off-scene gap-fill). ' +
        'Append-only — do not duplicate prior lines. Only for NPCs not present with the protagonist.',
    ),
  current_place_name: z
    .string()
    .optional()
    .describe(
      'Move the NPC to this existing place. Must match a known place name (case-insensitive). ' +
        'Unknown names are silently dropped — the archivist owns place creation.',
    ),
  personal_goals: z
    .string()
    .optional()
    .describe(
      'Replace personal_goals (newline-separated, multi-line). Include any prior goals you want to keep. ' +
        'Most patches omit this — only update when narration revealed something genuinely new.',
    ),
})

const PlannedActionSchema = z.object({
  npc_name: z
    .string()
    .describe('Name of a PRESENT agent-tier NPC. The plan will be staged by the narrator this turn.'),
  intent: z
    .string()
    .describe(
      'One short present-tense sentence describing what this NPC will actually do or say this turn ' +
        '(e.g. "picks up the phone, dials Jordana", "stays at his monitor, headphones on, doesn\'t look up"). ' +
        'The narrator stages this as the actual scene.',
    ),
})

export type PlannedAction = z.infer<typeof PlannedActionSchema>

export const NpcAgentPatchSchema = z.object({
  npc_updates: z
    .array(NpcUpdateSchema)
    .optional()
    .describe(
      'NPCs whose persistent state changed (focus, activity, place, personal goals). ' +
        'Reflects what happened in the prior narration. Empty/omitted on quiet turns.',
    ),
  planned_actions: z
    .array(PlannedActionSchema)
    .optional()
    .describe(
      "Plans for present agent NPCs to be staged by the narrator THIS turn. Every present agent NPC " +
        'should have one — if you omit them, the narrator improvises and the NPC loses agency.',
    ),
})

export type NpcAgentPatch = z.infer<typeof NpcAgentPatchSchema>

export const NPC_AGENT_MODEL = 'claude-haiku-4-5-20251001'

type AgentNpcRow = {
  id: number
  name: string
  description: string | null
  personal_goals: string | null
  current_focus: string | null
  recent_activity: string | null
  active_goal: string | null
  current_attitude: string | null
  current_place_id: number | null
  current_place_name: string | null
  agency_level: string
  last_agent_tick_turn_id: number | null
}

const agentNpcsStmt = db.prepare<[number, number, number, number]>(`
  SELECT c.id, c.name, c.description, c.personal_goals, c.current_focus, c.recent_activity,
         c.active_goal, c.current_attitude, c.current_place_id, c.agency_level,
         c.last_agent_tick_turn_id,
         (SELECT name FROM places WHERE id = c.current_place_id) AS current_place_name
    FROM characters c
   WHERE c.world_id = ?
     AND c.agency_level IN ('local', 'nearby', 'distant', 'agent')
     AND c.is_player = 0
     AND c.status != 'dead'
     AND (
       c.agency_level IN ('local', 'agent')
       OR c.last_agent_tick_turn_id IS NULL
       OR (c.agency_level = 'nearby' AND ? - c.last_agent_tick_turn_id >= 2)
       OR (c.agency_level = 'distant' AND ? - c.last_agent_tick_turn_id >= 5)
       OR (? - c.last_agent_tick_turn_id >= 5)
     )
`)

const playerLocationStmt = db.prepare<[number]>(`
  SELECT c.current_place_id,
         (SELECT name FROM places WHERE id = c.current_place_id) AS current_place_name
    FROM characters c
   WHERE c.world_id = ? AND c.is_player = 1
   LIMIT 1
`)

const worldTimeStmt = db.prepare<[number]>('SELECT world_time FROM worlds WHERE id = ?')
const placesForWorldStmt = db.prepare<[number]>(
  'SELECT id, name FROM places WHERE world_id = ? ORDER BY id ASC',
)
const setLastAgentTickStmt = db.prepare<[number, number]>(
  `UPDATE characters SET last_agent_tick_turn_id = ?, updated_at = datetime('now') WHERE id = ?`,
)

// Runs BEFORE the narrator each turn. Reflects on what just happened (the
// prior narration) to update each agent NPC's state, and plans what each
// present agent NPC will do *this* turn. The narrator stages the plans.
// `tickTurnId` is the player-turn id used for [t:N] provenance on activity
// log entries — the narrator turn doesn't exist yet.
export async function runNpcAgentTick(
  worldId: number,
  tickTurnId: number,
  premise: string,
  playerInput: string,
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<{
  patch: NpcAgentPatch
  plans: PlannedAction[]
  usage: LanguageModelUsage
} | null> {
  const agents = agentNpcsStmt.all(worldId, tickTurnId, tickTurnId, tickTurnId) as AgentNpcRow[]
  if (agents.length === 0) return null

  const player = playerLocationStmt.get(worldId) as
    | { current_place_id: number | null; current_place_name: string | null }
    | undefined
  const { world_time: worldTime } = (worldTimeStmt.get(worldId) as { world_time: string | null }) ?? {
    world_time: null,
  }
  const knownPlaces = placesForWorldStmt.all(worldId) as Array<{ id: number; name: string }>

  // Shape the per-NPC context. recent_activity is truncated to the last 3 lines
  // so the prompt stays bounded as activity logs grow over a long session.
  const npcContext = agents.map((a) => ({
    name: a.name,
    description: a.description,
    personal_goals: a.personal_goals,
    agency_level: a.agency_level,
    tick_rate:
      a.agency_level === 'local' || a.agency_level === 'agent'
        ? 'every turn'
        : a.agency_level === 'nearby'
          ? 'every 2 turns'
          : 'every 5 turns',
    current_focus: a.current_focus,
    active_goal: a.active_goal,
    current_attitude: a.current_attitude,
    current_place: a.current_place_name,
    present_with_protagonist:
      a.current_place_id !== null && a.current_place_id === player?.current_place_id,
    recent_activity: lastNLines(stripFactProvenance(a.recent_activity), 3),
  }))

  const priorNarration = recentTurns
    .filter((t) => t.role === 'assistant')
    .slice(-1)
    .map((t) => t.content)
    .join('\n\n')

  const { object, usage } = await generateObject({
    model: anthropic(NPC_AGENT_MODEL),
    schema: NpcAgentPatchSchema,
    system: `${loadPrompt('npc-agent-system')}\n\nPREMISE (context, do not extract from):\n${premise}`,
    prompt: [
      `WORLD TIME: ${worldTime ?? '(unset)'}`,
      `PROTAGONIST IS AT: ${player?.current_place_name ?? '(unknown)'}`,
      '',
      'AGENT NPCs:',
      JSON.stringify(npcContext, null, 2),
      '',
      'KNOWN PLACES:',
      knownPlaces.map((p) => `- ${p.name}`).join('\n'),
      '',
      priorNarration ? `PRIOR NARRATION (what just happened — base your updates on this):\n${priorNarration}` : 'PRIOR NARRATION: (none — this is the first turn)',
      '',
      `PLAYER IS ABOUT TO (this turn): ${playerInput}`,
      '',
      'Return state updates for what just happened AND planned actions for present agent NPCs this turn.',
    ].join('\n'),
  })

  applyNpcAgentPatch(worldId, tickTurnId, object)
  for (const agent of agents) {
    setLastAgentTickStmt.run(tickTurnId, agent.id)
  }
  return { patch: object, plans: object.planned_actions ?? [], usage }
}

// ---- Patch application ------------------------------------------------------

const findAgentNpcByNameStmt = db.prepare<[number, string]>(
  `SELECT id, recent_activity FROM characters
    WHERE world_id = ?
      AND lower(name) = lower(?)
      AND agency_level IN ('local', 'nearby', 'distant', 'agent')
      AND is_player = 0`,
)
const findPlaceByNameStmt = db.prepare<[number, string]>(
  'SELECT id FROM places WHERE world_id = ? AND lower(name) = lower(?)',
)
const setFocusStmt = db.prepare<[string, number]>(
  `UPDATE characters SET current_focus = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setActivityStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET recent_activity = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setPlaceStmt = db.prepare<[number, number]>(
  `UPDATE characters SET current_place_id = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setPersonalGoalsStmt = db.prepare<[string, number]>(
  `UPDATE characters SET personal_goals = ?, updated_at = datetime('now') WHERE id = ?`,
)

export function applyNpcAgentPatch(
  worldId: number,
  narratorTurnId: number,
  patch: NpcAgentPatch,
): void {
  const updates = patch.npc_updates ?? []
  if (updates.length === 0) return

  const tx = db.transaction(() => {
    for (const u of updates) {
      const existing = findAgentNpcByNameStmt.get(worldId, u.name) as
        | { id: number; recent_activity: string | null }
        | undefined
      // Silently drop updates targeting non-agent NPCs, missing NPCs, or the
      // protagonist. This is a prompt-failure safety net, not data corruption.
      if (!existing) continue

      if (u.current_focus !== undefined) {
        setFocusStmt.run(u.current_focus, existing.id)
      }
      if (u.activity_append !== undefined) {
        const next = appendFactWithProvenance(
          existing.recent_activity,
          u.activity_append,
          narratorTurnId,
        )
        // appendFactWithProvenance returns null when the append is empty;
        // null would clobber existing activity to "no change" semantics —
        // skip the write entirely in that case.
        if (next !== null) setActivityStmt.run(next, existing.id)
      }
      if (u.current_place_name !== undefined) {
        const place = findPlaceByNameStmt.get(worldId, u.current_place_name) as
          | { id: number }
          | undefined
        if (place) setPlaceStmt.run(place.id, existing.id)
        // Unknown place: silently drop. Archivist owns place creation; the
        // NPC agent only relocates within the known set.
      }
      if (u.personal_goals !== undefined) {
        setPersonalGoalsStmt.run(u.personal_goals, existing.id)
      }
    }
  })
  tx()
}

function lastNLines(value: string | null, n: number): string | null {
  if (!value) return null
  const lines = value.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length <= n) return lines.join('\n')
  return lines.slice(-n).join('\n')
}

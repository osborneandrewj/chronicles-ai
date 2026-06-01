import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, type LanguageModelUsage } from 'ai'
import { z } from 'zod'

import { DailyLoopSchema } from '@/lib/daily-loop'
import { db } from '@/lib/db'
import { tolerateNulls } from '@/lib/llm-schema'
import { appendFactWithProvenance, stripFactProvenance } from '@/lib/memorable-facts'
import {
  getRecentIntentOutcomesForCharacter,
  insertNpcIntent,
  type IntentVisibility,
} from '@/lib/npc-intents'
import { loadPrompt } from '@/lib/prompt-files'
import { addReveriesForCharacter, getReveriesForCharacters } from '@/lib/reveries'
import { worldTimeBand } from '@/lib/world-time'

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
  private_beliefs: z
    .string()
    .optional()
    .describe(
      'Replace private_beliefs (newline-separated). What this NPC personally believes, suspects, ' +
        'misunderstands, or knows privately. Include prior beliefs you want to keep. Use only when a belief changes.',
    ),
  reveries_add: z
    .array(
      z.object({
        text: z.string(),
        match_tags: z.array(z.string()).default([]),
        intensity: z.number().min(0).max(1).optional(),
      }),
    )
    .optional()
    .describe(
      'Add NET-NEW reveries only — never repeat existing ones, they persist on their own. ' +
        'A reverie is a charged sensory/emotional memory; tag each with concrete anchors ' +
        '(a smell, an object, a place, a phrase, a failure). Add one rarely, only when something lodges.',
    ),
  daily_loop: DailyLoopSchema.optional().describe(
    'Author this NPC\'s time-banded daily routine ONCE if they do not have one yet. ' +
      'Ignored if a loop already exists.',
  ),
  relationship_to_player: z
    .string()
    .optional()
    .describe(
      'Replace the compact relationship anchor to the protagonist: trust, fear, debt, resentment, ' +
        'promises, leverage, shared secrets, or open tension. Use only when it meaningfully changes.',
    ),
  long_term_agenda: z
    .string()
    .optional()
    .describe(
      'Replace long_term_agenda (newline-separated). Durable wants, pressure, deadline, secret, ' +
        'fallback plan, or line they will not cross. Include prior agenda items you want to keep.',
    ),
  tool_access: z
    .string()
    .optional()
    .describe(
      'Replace diegetic tool access: in-world resources this NPC can plausibly use, such as records, ' +
        'contacts, devices, institutional authority, spells, scanners, or the public web in modern settings.',
    ),
  in_transit_to: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Destination this NPC is currently traveling toward. Must match a known place name (case-insensitive). ' +
        'Set when an off-scene NPC starts a journey; the narrator will not arrive them at the destination ' +
        'until the world clock catches up to arrival_world_time. Pass null to clear (journey complete or aborted). ' +
        'Unknown destinations are silently dropped.',
    ),
  arrival_world_time: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Free-text world-clock string for expected arrival at in_transit_to (e.g. "11:36 AM", "Day 2, 2pm"). ' +
        'Estimate honestly from realistic travel time given the world clock + the route distance. ' +
        'Do not arrive an NPC before this time. Pass null to clear when the journey ends.',
    ),
  last_known_situation: z
    .string()
    .optional()
    .describe(
      'A short present-tense snapshot of this NPC\'s physical state RIGHT NOW (e.g. "in her sedan, ' +
        'southbound on Government Way, two minutes from the office", "at her desk on a call with HR"). ' +
        'Distinct from current_focus (mental). The narrator reads this when staging off-scene dialogue, ' +
        'phone calls, messages, or references. Overwrites prior value. Update every turn for off-scene NPCs.',
    ),
})

const PlannedActionSchema = z.object({
  npc_name: z
    .string()
    .describe('Name of a PRESENT agent-tier NPC. The plan will be staged by the narrator this turn.'),
  intent: z
    .string()
    .describe(
      'One short present-tense compact statement of intent — what this NPC wants to happen ' +
        '(e.g. "find out what Andrew did last night", "deflect Marcus until Jordana arrives"). ' +
        'Pair with planned_action for the concrete move.',
    ),
  planned_action: z
    .string()
    .describe(
      'One short present-tense sentence describing the concrete action the NPC takes this turn ' +
        '(e.g. "picks up the phone, dials Jordana", "stays at his monitor, headphones on, doesn\'t look up"). ' +
        'The narrator stages this as the actual scene.',
    ),
  intent_type: z
    .string()
    .optional()
    .describe(
      'Optional short tag for this kind of intent (e.g. "confront", "evade", "support", "withhold", ' +
        '"investigate", "leave", "phone"). Used for later audit, not narration.',
    ),
  target_npc_name: z
    .string()
    .optional()
    .describe(
      'Optional name of the NPC this plan targets (case-insensitive match against known characters). ' +
        'Use when the action is aimed at a specific person — calling, confronting, comforting, lying to.',
    ),
  target_place_name: z
    .string()
    .optional()
    .describe(
      'Optional known place the plan targets (case-insensitive). Use when the move heads toward a ' +
        'specific location. Unknown names are silently dropped.',
    ),
  private_rationale: z
    .string()
    .optional()
    .describe(
      'Optional compact one-sentence private reason for the plan, stored for developer audit only. ' +
        'Do NOT use this as a hidden chain-of-thought transcript — keep it to motive or constraint.',
    ),
})

export type PlannedAction = z.infer<typeof PlannedActionSchema>

export const NpcAgentPatchSchema = z.object({
  npc_updates: z
    .array(tolerateNulls(NpcUpdateSchema))
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

// Haiku occasionally serializes the whole patch wrong: instead of two arrays it
// returns the object body crammed into a single stringified `npc_updates`
// field (e.g. `{"npc_updates":"[…],\n\"planned_actions\": […]\n"}`), or returns
// an array field as a JSON string. The content is intact — only the shape is
// broken — so we rebuild the valid object before Zod sees it. Wired as
// generateObject's experimental_repairText; returns null when it can't help (so
// the SDK throws and the route's graceful skip kicks in). Pure + unit-tested.
export function repairNpcAgentText(text: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>

  // Shape 1: the model opened a string after `"npc_updates":` and dumped the
  // rest of the body into it, so `planned_actions` never made it to the top
  // level. Re-wrap the stringified body with its key and re-parse.
  if (typeof obj.npc_updates === 'string' && !('planned_actions' in obj)) {
    try {
      return JSON.stringify(JSON.parse(`{"npc_updates":${obj.npc_updates}}`))
    } catch {
      // fall through to per-field repair
    }
  }

  // Shape 2: one or both array fields came back as JSON strings.
  let changed = false
  for (const key of ['npc_updates', 'planned_actions'] as const) {
    if (typeof obj[key] === 'string') {
      try {
        obj[key] = JSON.parse(obj[key] as string)
        changed = true
      } catch {
        return null
      }
    }
  }
  return changed ? JSON.stringify(obj) : null
}

// An off-scene NPC with a daily loop, not in transit, and unmentioned in the
// prior narration needs no LLM tick this turn — its continuity comes from the
// deterministic loop lookup in the STATE block. Pure + unit-tested.
export function shouldSkipRoutineTick(
  npc: { name: string; present_with_protagonist: boolean; in_transit_to_place_id: number | null; daily_loop: string | null },
  priorNarration: string,
): boolean {
  if (npc.present_with_protagonist) return false
  if (npc.in_transit_to_place_id !== null) return false
  if (!npc.daily_loop || npc.daily_loop.trim().length === 0) return false
  if (priorNarration.toLowerCase().includes(npc.name.toLowerCase())) return false
  return true
}

export const NPC_AGENT_MODEL = 'claude-haiku-4-5-20251001'

type AgentNpcRow = {
  id: number
  name: string
  description: string | null
  personal_goals: string | null
  current_focus: string | null
  recent_activity: string | null
  private_beliefs: string | null
  reveries: string | null
  relationship_to_player: string | null
  long_term_agenda: string | null
  tool_access: string | null
  active_goal: string | null
  current_attitude: string | null
  current_place_id: number | null
  current_place_name: string | null
  agency_level: string
  last_agent_tick_turn_id: number | null
  in_transit_to_place_id: number | null
  in_transit_to_name: string | null
  arrival_world_time: string | null
  last_known_situation: string | null
  daily_loop: string | null
}

const agentNpcsStmt = db.prepare<[number, number, number, number]>(`
  SELECT c.id, c.name, c.description, c.personal_goals, c.current_focus, c.recent_activity,
         c.private_beliefs, c.relationship_to_player, c.long_term_agenda, c.tool_access,
         c.reveries, c.daily_loop,
         c.active_goal, c.current_attitude, c.current_place_id, c.agency_level,
         c.last_agent_tick_turn_id,
         c.in_transit_to_place_id, c.arrival_world_time, c.last_known_situation,
         (SELECT name FROM places WHERE id = c.current_place_id) AS current_place_name,
         (SELECT name FROM places WHERE id = c.in_transit_to_place_id) AS in_transit_to_name
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
const settingRegionStmt = db.prepare<[number]>(
  'SELECT setting_region FROM worlds WHERE id = ?',
)
const placesForWorldStmt = db.prepare<[number]>(
  `SELECT id, name, osm_street, osm_neighborhood, osm_display_name, geo_status
     FROM places WHERE world_id = ? ORDER BY id ASC`,
)
const setLastAgentTickStmt = db.prepare<[number, number]>(
  `UPDATE characters SET last_agent_tick_turn_id = ?, updated_at = datetime('now') WHERE id = ?`,
)

export type PlannedActionWithIntent = PlannedAction & {
  intent_id: number
  character_id: number
}

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
  plans: PlannedActionWithIntent[]
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
  const { setting_region: settingRegion } =
    (settingRegionStmt.get(worldId) as { setting_region: string | null }) ?? {
      setting_region: null,
    }
  const knownPlaces = placesForWorldStmt.all(worldId) as Array<{
    id: number
    name: string
    osm_street: string | null
    osm_neighborhood: string | null
    osm_display_name: string | null
    geo_status: string
  }>

  const priorNarration = recentTurns
    .filter((t) => t.role === 'assistant')
    .slice(-1)
    .map((t) => t.content)
    .join('\n\n')

  // Skip the LLM tick for off-scene, looped, stationary NPCs not mentioned in
  // the prior narration — their continuity comes from the deterministic loop
  // line in the STATE block. The raw `agents` fetch stays intact (used below
  // for last_agent_tick bookkeeping decisions); `tickable` is the subset we
  // actually send to the model and update this turn.
  const playerPlaceId = player?.current_place_id ?? null
  const tickable = agents.filter(
    (a) =>
      !shouldSkipRoutineTick(
        {
          name: a.name,
          present_with_protagonist: a.current_place_id !== null && a.current_place_id === playerPlaceId,
          in_transit_to_place_id: a.in_transit_to_place_id,
          daily_loop: a.daily_loop,
        },
        priorNarration,
      ),
  )
  if (tickable.length === 0) return null

  // Reveries now live in their own table (append-only). Batch-load them once so
  // each NPC's charged memories surface as plain text in the agent context.
  const reveriesByChar = getReveriesForCharacters(tickable.map((a) => a.id))

  // Shape the per-NPC context. recent_activity is truncated to the last 3 lines
  // so the prompt stays bounded as activity logs grow over a long session.
  const npcContext = tickable.map((a) => ({
    name: a.name,
    description: a.description,
    personal_goals: a.personal_goals,
    private_beliefs: lastNLines(stripFactProvenance(a.private_beliefs), 4),
    reveries: (reveriesByChar.get(a.id) ?? []).map((r) => r.text),
    daily_loop: a.daily_loop ? JSON.parse(a.daily_loop) : null,
    world_time_band: worldTimeBand(worldTime),
    relationship_to_player: a.relationship_to_player,
    long_term_agenda: lastNLines(stripFactProvenance(a.long_term_agenda), 4),
    tool_access: a.tool_access,
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
    // Journey state: where they're heading (if anywhere), when they should
    // arrive, and a short present-tense snapshot of physical state right now.
    // The agent advances last_known_situation each turn the NPC is in transit
    // and only flips current_place when the world clock catches up to ETA.
    in_transit_to: a.in_transit_to_name,
    arrival_world_time: a.arrival_world_time,
    last_known_situation: a.last_known_situation,
    // v0.6.9 — recent intent outcomes. The post-narrator reconciler labels
    // each plan staged/modified/ignored/contradicted. Surfacing the last
    // three lets the agent react to friction with the narrator (e.g. stop
    // planning a move the narrator keeps overriding) rather than pretending
    // every plan landed cleanly.
    recent_plan_outcomes: getRecentIntentOutcomesForCharacter(a.id, 3).map((row) => ({
      planned_action: row.planned_action,
      narrator_disposition: row.narrator_disposition,
      narrator_interpretation: row.narrator_interpretation,
    })),
  }))

  const { object, usage } = await generateObject({
    model: anthropic(NPC_AGENT_MODEL),
    schema: NpcAgentPatchSchema,
    // The NPC tick is best-effort (the route degrades to plan-less narration on
    // failure), so cap retries to keep a flake from stalling the turn. The
    // repair below recovers Haiku's common mis-serialization before that.
    maxRetries: 1,
    experimental_repairText: async ({ text }) => repairNpcAgentText(text),
    messages: [
      {
        role: 'system',
        content: `${loadPrompt('npc-agent-system')}\n\nPREMISE (context, do not extract from):\n${premise}`,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      },
      {
        role: 'user',
        content: [
          `WORLD TIME: ${worldTime ?? '(unset)'}`,
          `WORLD SETTING (real-world region): ${settingRegion ?? '(not a real-world setting)'}`,
          `PROTAGONIST IS AT: ${player?.current_place_name ?? '(unknown)'}`,
          '',
          'AGENT NPCs:',
          JSON.stringify(npcContext, null, 2),
          '',
          'KNOWN PLACES (real-world street/neighborhood facts are authoritative — do not contradict them):',
          knownPlaces.map((p) => `- ${formatKnownPlaceLine(p)}`).join('\n'),
          '',
          priorNarration ? `PRIOR NARRATION (what just happened — base your updates on this):\n${priorNarration}` : 'PRIOR NARRATION: (none — this is the first turn)',
          '',
          `PLAYER IS ABOUT TO (this turn): ${playerInput}`,
          '',
          'Return state updates for what just happened AND planned actions for present agent NPCs this turn.',
        ].join('\n'),
      },
    ],
  })

  applyNpcAgentPatch(worldId, tickTurnId, object)
  for (const agent of tickable) {
    setLastAgentTickStmt.run(tickTurnId, agent.id)
  }

  // Persist each planned action as an npc_intents row. Plans targeting NPCs
  // outside the agent-tier roster are dropped (the schema needs a real
  // character_id, and an unrecognized name should never be reified). The
  // narrator turn id is filled in post-stream by the reconciler.
  const agentsByLower = new Map(tickable.map((a) => [a.name.toLowerCase(), a]))
  const allCharsForResolve = db
    .prepare<[number]>(
      'SELECT id, name FROM characters WHERE world_id = ?',
    )
    .all(worldId) as Array<{ id: number; name: string }>
  const charsByLower = new Map(allCharsForResolve.map((c) => [c.name.toLowerCase(), c.id]))
  const placesByLower = new Map(
    knownPlaces.map((p) => [p.name.toLowerCase(), p.id]),
  )

  const plansOut: PlannedActionWithIntent[] = []
  for (const plan of object.planned_actions ?? []) {
    const agent = agentsByLower.get(plan.npc_name.toLowerCase())
    if (!agent) continue
    const targetCharacterId = plan.target_npc_name
      ? charsByLower.get(plan.target_npc_name.toLowerCase()) ?? null
      : null
    const targetPlaceId = plan.target_place_name
      ? placesByLower.get(plan.target_place_name.toLowerCase()) ?? null
      : null
    const intentId = insertNpcIntent({
      worldId,
      characterId: agent.id,
      playerTurnId: tickTurnId,
      agencyLevel: agent.agency_level,
      intentText: plan.intent,
      plannedAction: plan.planned_action,
      intentType: plan.intent_type ?? null,
      targetCharacterId,
      targetPlaceId,
      privateRationale: plan.private_rationale ?? null,
      expectedVisibility: 'narrator' satisfies IntentVisibility,
    })
    plansOut.push({ ...plan, intent_id: intentId, character_id: agent.id })
  }

  return { patch: object, plans: plansOut, usage }
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
const setPrivateBeliefsStmt = db.prepare<[string, number]>(
  `UPDATE characters SET private_beliefs = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setDailyLoopIfEmptyStmt = db.prepare<[string, number]>(
  `UPDATE characters SET daily_loop = ?, updated_at = datetime('now')
     WHERE id = ? AND (daily_loop IS NULL OR trim(daily_loop) = '')`,
)
const setRelationshipToPlayerStmt = db.prepare<[string, number]>(
  `UPDATE characters SET relationship_to_player = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setLongTermAgendaStmt = db.prepare<[string, number]>(
  `UPDATE characters SET long_term_agenda = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setToolAccessStmt = db.prepare<[string, number]>(
  `UPDATE characters SET tool_access = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setInTransitToStmt = db.prepare<[number | null, number]>(
  `UPDATE characters SET in_transit_to_place_id = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setArrivalWorldTimeStmt = db.prepare<[string | null, number]>(
  `UPDATE characters SET arrival_world_time = ?, updated_at = datetime('now') WHERE id = ?`,
)
const setLastKnownSituationStmt = db.prepare<[string, number]>(
  `UPDATE characters SET last_known_situation = ?, updated_at = datetime('now') WHERE id = ?`,
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
      if (u.private_beliefs !== undefined) {
        setPrivateBeliefsStmt.run(u.private_beliefs, existing.id)
      }
      if (u.reveries_add !== undefined && u.reveries_add.length > 0) {
        addReveriesForCharacter(worldId, existing.id, u.reveries_add, narratorTurnId)
      }
      if (u.daily_loop !== undefined) {
        setDailyLoopIfEmptyStmt.run(JSON.stringify(u.daily_loop), existing.id)
      }
      if (u.relationship_to_player !== undefined) {
        setRelationshipToPlayerStmt.run(u.relationship_to_player, existing.id)
      }
      if (u.long_term_agenda !== undefined) {
        setLongTermAgendaStmt.run(u.long_term_agenda, existing.id)
      }
      if (u.tool_access !== undefined) {
        setToolAccessStmt.run(u.tool_access, existing.id)
      }
      if (u.in_transit_to !== undefined) {
        if (u.in_transit_to === null) {
          setInTransitToStmt.run(null, existing.id)
        } else {
          const place = findPlaceByNameStmt.get(worldId, u.in_transit_to) as
            | { id: number }
            | undefined
          if (place) setInTransitToStmt.run(place.id, existing.id)
          // Unknown destination: silently drop, mirroring current_place_name.
        }
      }
      if (u.arrival_world_time !== undefined) {
        setArrivalWorldTimeStmt.run(u.arrival_world_time, existing.id)
      }
      if (u.last_known_situation !== undefined) {
        setLastKnownSituationStmt.run(u.last_known_situation, existing.id)
      }
    }
  })
  tx()
}

function formatKnownPlaceLine(p: {
  name: string
  osm_street: string | null
  osm_neighborhood: string | null
  geo_status: string
}): string {
  if (p.geo_status !== 'ok') return p.name
  const bits: string[] = []
  if (p.osm_street) bits.push(p.osm_street)
  if (p.osm_neighborhood && p.osm_neighborhood !== p.osm_street) bits.push(p.osm_neighborhood)
  return bits.length > 0 ? `${p.name} — ${bits.join(' · ')}` : p.name
}

function lastNLines(value: string | null, n: number): string | null {
  if (!value) return null
  const lines = value.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length <= n) return lines.join('\n')
  return lines.slice(-n).join('\n')
}

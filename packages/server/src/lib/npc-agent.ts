import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, type LanguageModelUsage } from 'ai'
import { z } from 'zod'

import type {
  CharacterRepository,
  NpcIntentRepository,
  PlaceRepository,
  ReverieRepository,
  UnitOfWork,
  WorldRepository,
} from '@/domain/ports'
import type { AgentNpcFields } from '@/domain/ports/character-repository'
import { isPlanEligible, isTransientServiceNpc, missingPlannedActions } from '@/domain/services/npc-promotion'
import { HAIKU_MODEL } from '@/infrastructure/llm/model-registry'
import { DailyLoopSchema } from '@/lib/daily-loop'
import { tolerateNulls } from '@/lib/llm-schema'
import { appendFactWithProvenance, stripFactProvenance } from '@/lib/memorable-facts'
import { type IntentVisibility } from '@/lib/npc-intents'
import { loadPrompt } from '@/lib/prompt-files'
import { canMintReverie } from '@/lib/reveries'
import { worldTimeBand } from '@/lib/world-time'

// The injected persistence ports the NPC agent reads + writes through (P5b
// strangle). The SQLite adapters delegate to the same byte-identical SQL the
// helper used to issue inline; under PERSISTENCE=mongo they hit the collections.
export type NpcAgentDeps = {
  characters: CharacterRepository
  npcIntents: NpcIntentRepository
  places: PlaceRepository
  reveries: ReverieRepository
  unitOfWork: UnitOfWork
  worlds: WorldRepository
}

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
      'Add a NET-NEW reverie only — never repeat existing ones, they persist on their own. ' +
        'A reverie is a charged sensory/emotional memory; tag each with concrete anchors ' +
        '(a smell, an object, a place, a phrase, a failure). Add one very rarely: an NPC holds at ' +
        'most 3, and the system enforces a long cooldown, so most ticks add none.',
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
  // PRIMARY output, declared FIRST: Haiku reliably fills the easy descriptive
  // array (npc_updates) and silently omits this one when it is buried second in
  // a combined schema, leaving present NPCs purely reactive. Leading with it +
  // the emphatic describe is the cheap lever; the focused planning retry in
  // runNpcAgentTick is the reliability backstop.
  planned_actions: z
    // tolerateNulls: Haiku emits `null` for optional item fields (target_npc_name,
    // target_place_name) rather than omitting them, which a bare `.optional()`
    // string rejects (invalid_type). Mirror the npc_updates handling below so the
    // whole planning array isn't dropped over a single null — present NPCs keep
    // their agency instead of going reactive.
    .array(tolerateNulls(PlannedActionSchema))
    .optional()
    .describe(
      'PRIMARY OUTPUT — emit FIRST. One concrete planned_action for EVERY present agent NPC this ' +
        'turn (at least one present NPC must target the protagonist directly). If you omit a present ' +
        'agent NPC, the narrator improvises and that NPC loses agency — never leave one without a plan.',
    ),
  npc_updates: z
    .array(tolerateNulls(NpcUpdateSchema))
    .optional()
    .describe(
      'Secondary. NPCs whose persistent state changed (focus, activity, place, personal goals). ' +
        'Reflects what happened in the prior narration. Empty/omitted on quiet turns.',
    ),
})

export type NpcAgentPatch = z.infer<typeof NpcAgentPatchSchema>

// Focused planning-only schema for the second pass: a minimal REQUIRED array is
// what the model is actually forced to populate (vs an optional array in the big
// combined patch). Used only when the first pass left a present NPC unplanned.
const PlannedActionsOnlySchema = z.object({
  planned_actions: z.array(tolerateNulls(PlannedActionSchema)).min(1),
})

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

export const NPC_AGENT_MODEL = HAIKU_MODEL

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
  deps: NpcAgentDeps,
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
  const { characters, npcIntents, places, reveries, worlds } = deps

  const knownPlaces = await places.forWorld(worldId)
  const placesByLower = new Map(knownPlaces.map((p) => [p.name.toLowerCase(), p.id]))

  const allChars = await characters.forWorld(worldId)
  const playerChar = allChars.find((c) => c.is_player === 1) ?? null
  const playerPlaceId = playerChar?.current_place_id ?? null

  const agents = await characters.agentNpcsForTick(worldId, tickTurnId, playerPlaceId)
  // The widened query admits co-located npc-tier rows for the cold-open fix;
  // drop plan-INELIGIBLE candidates (transient service walk-ons). Agent-tier
  // rows are always eligible — the eligibility decision is the pure domain rule.
  const eligible = agents.filter((a) =>
    isPlanEligible({
      agency_level: a.agency_level,
      present_with_protagonist: a.current_place_id !== null && a.current_place_id === playerPlaceId,
      is_transient_service: isTransientServiceNpc({
        name: a.name,
        description: a.description,
        active_goal: a.active_goal,
        personal_goals: a.personal_goals,
        current_focus: a.current_focus,
      }),
    }),
  )
  if (eligible.length === 0) return null

  const playerPlaceName =
    playerPlaceId != null
      ? knownPlaces.find((p) => p.id === playerPlaceId)?.name ?? null
      : null
  const player = {
    current_place_id: playerPlaceId,
    current_place_name: playerPlaceName,
  }

  const cursor = await worlds.cursor(worldId)
  const worldTime = cursor.world_time
  const settingRegion = (await worlds.getWorld(worldId))?.setting_region ?? null

  const priorNarration = recentTurns
    .filter((t) => t.role === 'assistant')
    .slice(-1)
    .map((t) => t.content)
    .join('\n\n')

  // Skip the LLM tick for off-scene, looped, stationary NPCs not mentioned in
  // the prior narration — their continuity comes from the deterministic loop
  // line in the STATE block. `tickable` is the subset of plan-eligible NPCs we
  // actually send to the model, update, and stamp last_agent_tick on this turn.
  const tickable = eligible.filter(
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
  const reveriesByChar = await reveries.forCharacters(tickable.map((a) => a.id))

  // v0.6.9 — recent reconciled intent outcomes, pre-fetched per NPC (the per-row
  // map below is sync, so the awaited reads happen here). Newest-first, capped.
  const outcomesByChar = new Map<number, Awaited<ReturnType<typeof npcIntents.recentOutcomesForCharacter>>>()
  for (const a of tickable) {
    outcomesByChar.set(a.id, await npcIntents.recentOutcomesForCharacter(a.id, 3))
  }

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
      a.current_place_id !== null && a.current_place_id === player.current_place_id,
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
    recent_plan_outcomes: (outcomesByChar.get(a.id) ?? []).map((row) => ({
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
          `PROTAGONIST IS AT: ${player.current_place_name ?? '(unknown)'}`,
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

  // Focused planning retry — guarantee a plan for every PRESENT agent NPC. Haiku
  // routinely omits planned_actions from the combined patch, so any present NPC
  // the first pass left unplanned only ever reacts. We re-ask with a minimal
  // REQUIRED schema (min 1) for just the missing names. Bounded to one extra
  // call, only when actually short; best-effort (its own failure keeps the
  // first-pass plans). Merge UPSTREAM of the single insert loop so ids allocate
  // through one code path (SQLite + Mongo parity).
  let mergedUsage = usage
  const presentNames = tickable
    .filter((a) => a.current_place_id !== null && a.current_place_id === playerPlaceId)
    .map((a) => a.name)
  const planned = [...(object.planned_actions ?? [])]
  const missing = missingPlannedActions(presentNames, planned)
  if (missing.length > 0) {
    try {
      const { object: retry, usage: retryUsage } = await generateObject({
        model: anthropic(NPC_AGENT_MODEL),
        schema: PlannedActionsOnlySchema,
        maxRetries: 1,
        experimental_repairText: async ({ text }) => repairNpcAgentText(text),
        messages: [
          {
            role: 'system',
            content: `${loadPrompt('npc-agent-system')}\n\nPREMISE (context, do not extract from):\n${premise}`,
            providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
          },
          {
            role: 'user',
            content: [
              `WORLD TIME: ${worldTime ?? '(unset)'}`,
              `PROTAGONIST IS AT: ${player.current_place_name ?? '(unknown)'}`,
              '',
              'AGENT NPCs:',
              JSON.stringify(npcContext, null, 2),
              '',
              'KNOWN PLACES (real-world facts are authoritative — do not contradict them):',
              knownPlaces.map((p) => `- ${formatKnownPlaceLine(p)}`).join('\n'),
              '',
              priorNarration
                ? `PRIOR NARRATION (what just happened):\n${priorNarration}`
                : 'PRIOR NARRATION: (none — this is the first turn)',
              '',
              `PLAYER IS ABOUT TO (this turn): ${playerInput}`,
              '',
              `These PRESENT agent NPCs have NO plan yet and EACH must get one concrete present-tense ` +
                `move this turn: ${missing.join(', ')}. At least one should target the protagonist ` +
                `directly. Return ONLY planned_actions — no npc_updates.`,
            ].join('\n'),
          },
        ],
      })
      mergedUsage = {
        inputTokens: (usage.inputTokens ?? 0) + (retryUsage.inputTokens ?? 0),
        outputTokens: (usage.outputTokens ?? 0) + (retryUsage.outputTokens ?? 0),
        totalTokens: (usage.totalTokens ?? 0) + (retryUsage.totalTokens ?? 0),
        cachedInputTokens: (usage.cachedInputTokens ?? 0) + (retryUsage.cachedInputTokens ?? 0),
      }
      planned.push(...(retry.planned_actions ?? []))
    } catch (err) {
      console.error('[npc agent planning retry failed]', err)
      // Keep the first-pass plans — the tick must never fail on the retry.
    }
  }
  // Dedup by npc_name (case-insensitive, keep first) so a double-covered NPC
  // never produces two npc_intents rows, then feed the merged set to the single
  // apply + insert path below.
  const seenNpc = new Set<string>()
  object.planned_actions = planned.filter((p) => {
    const key = p.npc_name.toLowerCase()
    if (seenNpc.has(key)) return false
    seenNpc.add(key)
    return true
  })

  await applyNpcAgentPatch(deps, worldId, tickTurnId, object)
  for (const agent of tickable) {
    await characters.setLastAgentTick(tickTurnId, agent.id)
  }

  // Persist each planned action as an npc_intents row. Plans targeting NPCs
  // outside the agent-tier roster are dropped (the schema needs a real
  // character_id, and an unrecognized name should never be reified). The
  // narrator turn id is filled in post-stream by the reconciler.
  const agentsByLower = new Map(tickable.map((a) => [a.name.toLowerCase(), a]))
  const charsByLower = new Map(allChars.map((c) => [c.name.toLowerCase(), c.id]))

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
    const intentId = await npcIntents.insert({
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

  return { patch: object, plans: plansOut, usage: mergedUsage }
}

// ---- Patch application ------------------------------------------------------

export async function applyNpcAgentPatch(
  deps: NpcAgentDeps,
  worldId: number,
  narratorTurnId: number,
  patch: NpcAgentPatch,
): Promise<void> {
  const updates = patch.npc_updates ?? []
  if (updates.length === 0) return

  const { characters, places, reveries, unitOfWork } = deps

  // Resolve place-name → id once (findPlaceByNameStmt matched ANY place in the
  // world by lower-name). The agent only relocates within the known set.
  const knownPlaces = await places.forWorld(worldId)
  const placeIdByLower = new Map(knownPlaces.map((p) => [p.name.toLowerCase(), p.id]))

  // Single transaction boundary (mirrors the SQLite db.transaction the patch
  // applier used to wrap the whole loop). The Mongo sibling threads a session.
  await unitOfWork.run(async () => {
    for (const u of updates) {
      const existing = await characters.findAgentNpcByName(worldId, u.name)
      // Silently drop updates targeting missing NPCs or the protagonist. This is
      // a prompt-failure safety net, not data corruption. (findAgentNpcByName now
      // resolves plain npc-tier rows too, so a co-located NPC the agent planned
      // for can persist its own updates — P1; the guard against stray off-scene
      // npc-tier writes is the agent's plan discipline, never a repository WHERE.)
      if (!existing) continue

      // Collect the per-field writes (each was its own UPDATE; the adapter
      // persists only the present keys). daily_loop + reveries have their own
      // conditional paths and stay out of this patch.
      const fields: AgentNpcFields = {}

      if (u.current_focus !== undefined) {
        fields.current_focus = u.current_focus
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
        if (next !== null) fields.recent_activity = next
      }
      if (u.current_place_name !== undefined) {
        const placeId = placeIdByLower.get(u.current_place_name.toLowerCase())
        if (placeId !== undefined) fields.current_place_id = placeId
        // Unknown place: silently drop. Archivist owns place creation; the
        // NPC agent only relocates within the known set.
      }
      if (u.personal_goals !== undefined) {
        fields.personal_goals = u.personal_goals
      }
      if (u.private_beliefs !== undefined) {
        fields.private_beliefs = u.private_beliefs
      }
      if (u.relationship_to_player !== undefined) {
        fields.relationship_to_player = u.relationship_to_player
      }
      if (u.long_term_agenda !== undefined) {
        fields.long_term_agenda = u.long_term_agenda
      }
      if (u.tool_access !== undefined) {
        fields.tool_access = u.tool_access
      }
      if (u.in_transit_to !== undefined) {
        if (u.in_transit_to === null) {
          fields.in_transit_to_place_id = null
        } else {
          const placeId = placeIdByLower.get(u.in_transit_to.toLowerCase())
          if (placeId !== undefined) fields.in_transit_to_place_id = placeId
          // Unknown destination: silently drop, mirroring current_place_name.
        }
      }
      if (u.arrival_world_time !== undefined) {
        fields.arrival_world_time = u.arrival_world_time
      }
      if (u.last_known_situation !== undefined) {
        fields.last_known_situation = u.last_known_situation
      }

      await characters.applyAgentNpcFields(existing.id, fields)

      if (u.reveries_add !== undefined && u.reveries_add.length > 0) {
        // v0.6.x: throttle creation — at most one new reverie per tick, and only
        // once the per-NPC cooldown has elapsed. Deterministic; the prompt's
        // "rarely" is just a nudge. reveries.add still dedups + caps.
        // NOTE: the schema allows an array, but we deliberately persist at most
        // one per tick (cooldown throttle) and silently drop extras rather than
        // failing the whole patch.
        if (canMintReverie(await reveries.mintState(worldId, existing.id))) {
          await reveries.add(worldId, existing.id, [u.reveries_add[0]], narratorTurnId)
        }
      }
      if (u.daily_loop !== undefined) {
        await characters.setDailyLoopIfEmpty(existing.id, JSON.stringify(u.daily_loop))
      }
    }
  })
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

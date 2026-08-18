// Map director / reconciler / conductor outputs onto WorldEventInput rows. Pure.

import type {
  ResolvedOutcome,
  WorldEvent,
  WorldEventInput,
  WorldEventKind,
} from '@/domain/entities'
import type { DirectorDecision } from '@/domain/services/director'
import { directorBeatToMetadata } from '@/domain/services/director'
import { isBindingOutcome, outcomeToMetadata } from '@/domain/services/outcome-resolution'

export type ReconcileDisposition = 'staged' | 'modified' | 'ignored' | 'contradicted'

/** Rows allowed on the inspector Story tab. Closure/completion stays in the
 * durable log for coordination; it is not operator-facing UI. Per-turn
 * BEAT_DIRECTED and NPC_* stay in the log only. */
export const STORY_TAB_EVENT_KINDS = [
  'OUTCOME_RESOLVED',
] as const satisfies readonly WorldEventKind[]

export function isStoryTabWorldEvent(event: Pick<WorldEvent, 'kind'>): boolean {
  return (STORY_TAB_EVENT_KINDS as readonly string[]).includes(event.kind)
}

export function beatDirectedEvent(args: {
  worldId: number
  turnId: number
  worldTime: string | null
  decision: DirectorDecision
}): WorldEventInput | null {
  const { decision } = args
  if (decision.foregroundThreadId == null && decision.mustStage.length === 0) {
    return null
  }
  return {
    world_id: args.worldId,
    turn_id: args.turnId,
    world_time: args.worldTime,
    kind: 'BEAT_DIRECTED',
    source_agent: 'director',
    actor_id: null,
    thread_id: decision.foregroundThreadId,
    payload: directorBeatToMetadata(decision),
    visibility: 'system',
  }
}

export function npcReconcileEvents(args: {
  worldId: number
  turnId: number
  worldTime: string | null
  plans: Array<{ intent_id: number; character_id: number }>
  results: Array<{
    intent_id: number
    disposition: ReconcileDisposition
    interpretation?: string
    outcome_summary?: string
  }>
}): WorldEventInput[] {
  const characterByIntent = new Map(
    args.plans.map((p) => [p.intent_id, p.character_id]),
  )
  return args.results.map((r) => ({
    world_id: args.worldId,
    turn_id: args.turnId,
    world_time: args.worldTime,
    kind: dispositionToKind(r.disposition),
    source_agent: 'reconciler' as const,
    actor_id: characterByIntent.get(r.intent_id) ?? null,
    thread_id: null,
    payload: {
      intent_id: r.intent_id,
      disposition: r.disposition,
      interpretation: r.interpretation ?? null,
      outcome_summary: r.outcome_summary ?? null,
    },
    visibility: 'system' as const,
  }))
}

export function threadClosedEvent(args: {
  worldId: number
  turnId: number
  worldTime: string | null
  threadId: number
  status: 'resolved' | 'failed'
  title: string
}): WorldEventInput {
  return {
    world_id: args.worldId,
    turn_id: args.turnId,
    world_time: args.worldTime,
    kind: 'THREAD_CLOSED',
    source_agent: 'director',
    actor_id: null,
    thread_id: args.threadId,
    payload: { status: args.status, title: args.title },
    visibility: 'system',
  }
}

export function objectiveCompletedEvent(args: {
  worldId: number
  turnId: number
  worldTime: string | null
  objectiveId: number
  status: 'completed' | 'failed'
  title: string
}): WorldEventInput {
  return {
    world_id: args.worldId,
    turn_id: args.turnId,
    world_time: args.worldTime,
    kind: 'OBJECTIVE_COMPLETED',
    source_agent: 'director',
    actor_id: null,
    thread_id: null,
    payload: { status: args.status, title: args.title, objective_id: args.objectiveId },
    visibility: 'system',
  }
}

export function outcomeResolvedEvent(args: {
  worldId: number
  turnId: number
  worldTime: string | null
  resolution: ResolvedOutcome
}): WorldEventInput | null {
  if (!isBindingOutcome(args.resolution)) return null
  return {
    world_id: args.worldId,
    turn_id: args.turnId,
    world_time: args.worldTime,
    kind: 'OUTCOME_RESOLVED',
    source_agent: 'conductor',
    actor_id: null,
    thread_id: null,
    payload: outcomeToMetadata(args.resolution),
    visibility: 'system',
  }
}

function dispositionToKind(disposition: ReconcileDisposition): WorldEventKind {
  if (disposition === 'staged') return 'NPC_STAGED'
  if (disposition === 'modified') return 'NPC_MODIFIED'
  return 'NPC_IGNORED'
}
// Map director / reconciler outputs onto WorldEventInput rows. Pure.

import type { WorldEventInput, WorldEventKind } from '@/domain/entities'
import type { DirectorDecision } from '@/domain/services/director'
import { directorBeatToMetadata } from '@/domain/services/director'

export type ReconcileDisposition = 'staged' | 'modified' | 'ignored' | 'contradicted'

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

function dispositionToKind(disposition: ReconcileDisposition): WorldEventKind {
  if (disposition === 'staged') return 'NPC_STAGED'
  if (disposition === 'modified') return 'NPC_MODIFIED'
  return 'NPC_IGNORED'
}
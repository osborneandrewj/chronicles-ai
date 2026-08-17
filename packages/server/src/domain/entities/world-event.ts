// World event — append-only coordination log (not player-facing timeline).
// Prose is the book; these rows are machine truth. No I/O.

export const WORLD_EVENT_KINDS = [
  'BEAT_DIRECTED',
  'NPC_STAGED',
  'NPC_MODIFIED',
  'NPC_IGNORED',
  'THREAD_CLOSED',
  'OBJECTIVE_COMPLETED',
] as const

export type WorldEventKind = (typeof WORLD_EVENT_KINDS)[number]

export const WORLD_EVENT_SOURCES = ['director', 'reconciler'] as const
export type WorldEventSource = (typeof WORLD_EVENT_SOURCES)[number]

export const WORLD_EVENT_VISIBILITIES = ['system', 'narrator', 'player'] as const
export type WorldEventVisibility = (typeof WORLD_EVENT_VISIBILITIES)[number]

export type WorldEvent = {
  id: number
  world_id: number
  turn_id: number | null
  world_time: string | null
  kind: WorldEventKind
  source_agent: WorldEventSource
  actor_id: number | null
  thread_id: number | null
  payload: Record<string, unknown>
  visibility: WorldEventVisibility
  created_at: string
}

export type WorldEventInput = Omit<WorldEvent, 'id' | 'created_at'>

export function isWorldEventKind(value: string): value is WorldEventKind {
  return (WORLD_EVENT_KINDS as readonly string[]).includes(value)
}
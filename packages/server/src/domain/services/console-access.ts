// Pure console / sim-room gate for injecting sim log bodies into hub context.
// No I/O.

import type { ClearanceLevel, WorldLayer } from '@/domain/entities'

export type ConsoleAccessContext = {
  worldLayer: WorldLayer
  placeId: number | null
  placeName: string | null
  /** True when active place is the hub archetype simulation room. */
  isConsoleCapablePlace: boolean
  playerText: string
  actingCharacterClearance: ClearanceLevel
  hasAwoken: boolean
}

export type InjectDecision =
  | { inject: false; reason: 'not_hub' | 'concealed' | 'no_console_intent' }
  | { inject: true; mode: 'index_only' | 'body'; reason: 'console_place' | 'log_query' }

// Precision-biased log-access language (story-signal style).
const LOG_QUERY_PATTERNS: RegExp[] = [
  /\b(pull\s+up|access|open|load|show|read|query|retrieve)\s+(the\s+)?(log|logs|report|mission\s+report|protocol|sequence)\b/i,
  /\b(mission\s+report|sim(?:ulation)?\s+log|protocol\s+log)\b/i,
  /\b(console|terminal|archive\s+terminal)\b/i,
  /\bsequence\s+\w+/i,
  /\bprotocol\s+\w+/i,
]

export function hasLogQueryIntent(playerText: string): boolean {
  const t = playerText.trim()
  if (!t) return false
  return LOG_QUERY_PATTERNS.some((p) => p.test(t))
}

/**
 * Decide whether (and how) to inject sim logs.
 * - Ambient hub post-awaken: index_only is handled by caller without body inject
 * - Body inject only with console place OR log-query intent on hub after awaken
 */
export function shouldInjectSimLogs(ctx: ConsoleAccessContext): InjectDecision {
  if (ctx.worldLayer !== 'hub') {
    return { inject: false, reason: 'not_hub' }
  }
  if (!ctx.hasAwoken) {
    return { inject: false, reason: 'concealed' }
  }

  const logQuery = hasLogQueryIntent(ctx.playerText)
  if (ctx.isConsoleCapablePlace) {
    return {
      inject: true,
      mode: logQuery || ctx.isConsoleCapablePlace ? 'body' : 'body',
      reason: logQuery ? 'log_query' : 'console_place',
    }
  }
  if (logQuery) {
    // Log query language outside console: still allow body when intent is clear
    // (player may be remote-querying from another room in fiction).
    return { inject: true, mode: 'body', reason: 'log_query' }
  }

  return { inject: false, reason: 'no_console_intent' }
}

/** Ambient index is allowed on any post-awaken hub turn. */
export function shouldShowSimIndex(ctx: Pick<ConsoleAccessContext, 'worldLayer' | 'hasAwoken'>): boolean {
  return ctx.worldLayer === 'hub' && ctx.hasAwoken
}

/**
 * v1: the entire hub simulation room is console-capable.
 * Resolve by matching current place name to the archetype simulation room name.
 */
export function isConsoleCapablePlace(args: {
  placeName: string | null
  simulationRoomName: string | null
}): boolean {
  if (!args.placeName || !args.simulationRoomName) return false
  return args.placeName.trim().toLowerCase() === args.simulationRoomName.trim().toLowerCase()
}

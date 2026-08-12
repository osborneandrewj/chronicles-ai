// Pure archivist run policy: signal gate composition + max-lag freshness.
// No I/O, no model IDs — infrastructure supplies lag inputs and stamps metadata.

/** Force an LLM extract when this many assistant turns lack a successful archivist block. */
export const MAX_ARCHIVIST_LAG_ASSISTANT_TURNS = 2

/** Cap on role rows passed to the archivist extract (not the full narrator history). */
export const ARCHIVIST_EXTRACT_WINDOW_ROLE_ROWS = 8

export type ArchivistRunReason = 'signal' | 'max_lag' | 'skip'

export type AssistantTurnForLag = {
  id: number
  /** Full turn metadata blob (may omit `archivist`). */
  metadata: Record<string, unknown>
}

export type RoleTurn = {
  id: number
  role: 'user' | 'assistant'
  content: string
}

/**
 * A successful archivist block is one that applied a patch without skip/error.
 * Deterministic and LLM applies both count; skipped / error-only do not.
 */
export function isSuccessfulArchivistMeta(meta: unknown): boolean {
  if (meta == null || typeof meta !== 'object') return false
  const m = meta as Record<string, unknown>
  if (m.skipped === true) return false
  if (m.error != null && m.error !== '') return false
  if (!('patch' in m) || m.patch == null) return false
  return true
}

/**
 * Count completed assistant turns since the most recent successful archivist
 * metadata, walking newest→oldest. Missing archivist blocks count toward lag.
 * `assistantTurns` must be oldest→newest.
 */
export function assistantTurnsSinceLastSuccessfulArchivist(
  assistantTurns: AssistantTurnForLag[],
): { lag: number; lastSuccessTurnId: number | null } {
  let lag = 0
  for (let i = assistantTurns.length - 1; i >= 0; i--) {
    const archivist = assistantTurns[i].metadata.archivist
    if (isSuccessfulArchivistMeta(archivist)) {
      return { lag, lastSuccessTurnId: assistantTurns[i].id }
    }
    lag++
  }
  return { lag, lastSuccessTurnId: null }
}

/**
 * Compose the existing pure signal gate with max-lag force.
 * Signal wins over max_lag when both would run (reason = 'signal').
 */
export function shouldRunArchivistLlmWithLag(args: {
  signal: boolean
  lag: number
  maxLag?: number
}): { run: boolean; reason: ArchivistRunReason } {
  const maxLag = args.maxLag ?? MAX_ARCHIVIST_LAG_ASSISTANT_TURNS
  if (args.signal) return { run: true, reason: 'signal' }
  if (args.lag >= maxLag) return { run: true, reason: 'max_lag' }
  return { run: false, reason: 'skip' }
}

/**
 * Select the role-row window for an archivist extract: prefer turns after the
 * last successful archivist, then take the newest `cap` rows. Truncation is
 * reported so callers can stamp diagnostics rather than silently drop prose.
 */
export function selectArchivistExtractWindow(args: {
  recentTurns: RoleTurn[]
  lastSuccessTurnId: number | null
  cap?: number
}): {
  window: Array<{ role: 'user' | 'assistant'; content: string }>
  windowTruncated: boolean
  windowStartTurnId: number | undefined
  lastSuccessTurnId: number | null
} {
  const cap = args.cap ?? ARCHIVIST_EXTRACT_WINDOW_ROLE_ROWS
  let candidates = args.recentTurns

  if (args.lastSuccessTurnId != null) {
    const after = args.recentTurns.filter((t) => t.id > args.lastSuccessTurnId!)
    if (after.length > 0) {
      candidates = after
    }
  }

  const windowTruncated = candidates.length > cap
  const windowTurns = windowTruncated ? candidates.slice(-cap) : candidates

  return {
    window: windowTurns.map((t) => ({ role: t.role, content: t.content })),
    windowTruncated,
    windowStartTurnId: windowTurns[0]?.id,
    lastSuccessTurnId: args.lastSuccessTurnId,
  }
}

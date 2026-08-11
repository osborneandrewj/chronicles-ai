// Pure open-order detect / derive / TTL / refresh (narrator-craft-freedom S2).
// v1 is durable via player-turn metadata writes in the adapter; this module
// only decides shape. No I/O. Conservative detection: named known character +
// retrieve / wait / bring / find verbs.

export const OPEN_ORDER_TTL_PLAYER_TURNS = 4 as const

export type OpenOrderKind = 'retrieve' | 'await' | 'deadline'
export type OpenOrderStatus = 'pending' | 'resolved' | 'expired'
export type OpenOrderResolution = 'arrived' | 'status' | 'refused' | 'obstacle'

export type OpenOrder = {
  targetCharacterId: number
  targetName: string
  kind: OpenOrderKind
  createdTurnId: number
  /** Player-turn TTL. Threshold script is retrieve → wait → continue → time-jump. */
  expiresAfterPlayerTurns: typeof OPEN_ORDER_TTL_PLAYER_TURNS
  status: OpenOrderStatus
  resolution?: OpenOrderResolution
  /** Last player turn id that refreshed the TTL (yield beats). */
  refreshedAtTurnId?: number
}

export type KnownCharacterForOrder = {
  id: number
  name: string
  aliases?: string | null
  is_player?: number
  status?: string
}

export type UserTurnForOrder = {
  id: number
  content: string
  /** Optional durable metadata block from a prior write. */
  openOrder?: OpenOrder | null
}

/**
 * Detect a short-lived open order from a single player utterance naming a
 * known non-player character with retrieve / summon / wait-for language.
 */
export function detectOpenOrder(
  playerText: string,
  knownCharacters: KnownCharacterForOrder[],
  createdTurnId: number,
): OpenOrder | null {
  const compact = normalize(playerText)
  if (!compact) return null

  const candidates = knownCharacters.filter(
    (c) => c.is_player !== 1 && c.status !== 'dead' && c.name.trim().length > 0,
  )
  if (candidates.length === 0) return null

  // Prefer longer names first so "Andy Osborne" beats "Andy".
  const ranked = [...candidates].sort((a, b) => b.name.length - a.name.length)

  for (const c of ranked) {
    const names = characterNameVariants(c)
    for (const name of names) {
      if (!nameMentions(compact, name)) continue

      const kind = classifyOrderKind(compact, name)
      if (!kind) continue

      return {
        targetCharacterId: c.id,
        targetName: c.name,
        kind,
        createdTurnId,
        expiresAfterPlayerTurns: OPEN_ORDER_TTL_PLAYER_TURNS,
        status: 'pending',
        refreshedAtTurnId: createdTurnId,
      }
    }
  }

  return null
}

/**
 * Derive the active open order from recent user turns (oldest→newest or any
 * order — we sort). Prefers durable metadata blocks; falls back to content
 * re-detection. Applies TTL, yield refresh, and optional resolution from
 * presence / explicit resolution hints.
 */
export function deriveActiveOpenOrder(
  recentUserTurns: UserTurnForOrder[],
  knownCharacters: KnownCharacterForOrder[],
  opts: {
    currentPlayerTurnId: number
    currentPlayerText: string
    /** Character ids currently present with the protagonist. */
    presentCharacterIds?: ReadonlySet<number>
    /** Explicit resolution from pre-stream status production. */
    forceResolution?: OpenOrderResolution | null
  },
): OpenOrder | null {
  const turns = [...recentUserTurns].sort((a, b) => a.id - b.id)
  if (turns.length === 0 && !opts.currentPlayerText) return null

  // Ensure current turn is in the list for age math.
  const hasCurrent = turns.some((t) => t.id === opts.currentPlayerTurnId)
  const allTurns = hasCurrent
    ? turns
    : [
        ...turns,
        {
          id: opts.currentPlayerTurnId,
          content: opts.currentPlayerText,
          openOrder: null,
        },
      ]

  // Newest-first scan for a durable pending order or content detection.
  let order: OpenOrder | null = null
  for (let i = allTurns.length - 1; i >= 0; i--) {
    const t = allTurns[i]
    if (t.openOrder && t.openOrder.status === 'pending') {
      order = { ...t.openOrder }
      break
    }
    if (t.openOrder && t.openOrder.status === 'resolved') {
      // A resolved order on a recent turn blocks re-opening the same target
      // from older content in this window.
      return null
    }
    const detected = detectOpenOrder(t.content, knownCharacters, t.id)
    if (detected) {
      order = detected
      break
    }
  }

  // Fresh detection on the current utterance always wins when it hits.
  const fresh = detectOpenOrder(
    opts.currentPlayerText,
    knownCharacters,
    opts.currentPlayerTurnId,
  )
  if (fresh) {
    // New target or re-issue → start fresh.
    if (!order || order.targetCharacterId !== fresh.targetCharacterId) {
      order = fresh
    } else if (order.status === 'pending') {
      // Same target re-issued — keep created id, refresh.
      order = {
        ...order,
        kind: fresh.kind,
        refreshedAtTurnId: opts.currentPlayerTurnId,
        status: 'pending',
        resolution: undefined,
      }
    }
  }

  if (!order) return null

  // Presence → arrived.
  if (opts.presentCharacterIds?.has(order.targetCharacterId)) {
    return {
      ...order,
      status: 'resolved',
      resolution: 'arrived',
    }
  }

  if (opts.forceResolution) {
    return {
      ...order,
      status: 'resolved',
      resolution: opts.forceResolution,
    }
  }

  if (order.status === 'resolved' || order.status === 'expired') return order

  // Yield refresh: idle / continue / wait / time-jump while pending.
  if (isYieldMove(opts.currentPlayerText)) {
    order = {
      ...order,
      refreshedAtTurnId: opts.currentPlayerTurnId,
      status: 'pending',
    }
  }

  // TTL from last refresh (or create).
  const anchorId = order.refreshedAtTurnId ?? order.createdTurnId
  const playerTurnsAfterAnchor = allTurns.filter((t) => t.id > anchorId).length
  if (playerTurnsAfterAnchor >= order.expiresAfterPlayerTurns) {
    return {
      ...order,
      status: 'expired',
    }
  }

  return { ...order, status: 'pending' }
}

/** Whether this player text is a yield beat that should refresh TTL. */
export function isYieldMove(text: string): boolean {
  const compact = normalize(text)
  if (!compact) return false
  if (isExplicitTimeJump(compact)) return true
  if (compact.length <= 80 && /\b(wait|waits|continue|continues|keep going|carry on|stay|stand|listen|hold|pause|rest|nothing)\b/.test(compact)) {
    return true
  }
  // "I sit down and wait for Andy" is both await-order language and a yield.
  if (/\b(wait|waits|waiting)\b/.test(compact) && compact.length <= 120) return true
  return false
}

export function isExplicitTimeJump(text: string): boolean {
  const compact = normalize(text)
  return (
    /\b(\d+\s*(minutes?|mins?|hours?|hrs?|days?|seconds?|secs?)\s+later)\b/.test(compact) ||
    /\b(an?|one|two|three|few|several)\s+(minutes?|hours?|days?)\s+later\b/.test(compact) ||
    /\b(later that|the next|next)\s+(morning|afternoon|evening|night|day|hour)\b/.test(compact) ||
    /\b(after\s+\d+\s*(minutes?|mins?|hours?))\b/.test(compact)
  )
}

/**
 * Pre-stream status line for STATE — factual only. Prefer agent-written
 * last_known_situation / transit; otherwise a conservative default from
 * known place so the narrator has something authoritative to dramatize.
 */
export function formatOpenOrderStatusLine(
  order: OpenOrder,
  target: {
    name: string
    current_place_name?: string | null
    last_known_situation?: string | null
    in_transit_to_name?: string | null
    arrival_world_time?: string | null
    present_with_protagonist?: boolean
  } | null,
): string | null {
  if (order.status === 'expired') return null
  if (order.status === 'resolved' && order.resolution === 'arrived') {
    return `${order.targetName} — present / arrived (open order resolved)`
  }

  if (!target) {
    return `${order.targetName} — status unknown; produce a concrete report or obstacle this turn (do not invent an off-scene relocation beyond STATE)`
  }

  if (target.present_with_protagonist) {
    return `${order.targetName} — present / arrived`
  }

  if (target.in_transit_to_name) {
    const eta = target.arrival_world_time ? ` (ETA ${target.arrival_world_time})` : ''
    return `${order.targetName} — in transit to ${target.in_transit_to_name}${eta}`
  }

  if (target.last_known_situation?.trim()) {
    return `${order.targetName} — ${target.last_known_situation.trim()}`
  }

  if (target.current_place_name?.trim()) {
    return `${order.targetName} — still at ${target.current_place_name.trim()}`
  }

  return `${order.targetName} — off-scene; location not yet confirmed`
}

/** Serialize for turn metadata (mergeMetadata block). */
export function openOrderToMetadata(order: OpenOrder): Record<string, unknown> {
  return {
    targetCharacterId: order.targetCharacterId,
    targetName: order.targetName,
    kind: order.kind,
    createdTurnId: order.createdTurnId,
    expiresAfterPlayerTurns: order.expiresAfterPlayerTurns,
    status: order.status,
    ...(order.resolution ? { resolution: order.resolution } : {}),
    ...(order.refreshedAtTurnId != null ? { refreshedAtTurnId: order.refreshedAtTurnId } : {}),
  }
}

/** Parse a metadata block back into OpenOrder (or null if malformed). */
export function openOrderFromMetadata(raw: unknown): OpenOrder | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const targetCharacterId = Number(o.targetCharacterId)
  const targetName = typeof o.targetName === 'string' ? o.targetName : ''
  const kind = o.kind
  const createdTurnId = Number(o.createdTurnId)
  const status = o.status
  if (!Number.isFinite(targetCharacterId) || !targetName) return null
  if (!Number.isFinite(createdTurnId)) return null
  if (kind !== 'retrieve' && kind !== 'await' && kind !== 'deadline') return null
  if (status !== 'pending' && status !== 'resolved' && status !== 'expired') return null

  const resolution =
    o.resolution === 'arrived' ||
    o.resolution === 'status' ||
    o.resolution === 'refused' ||
    o.resolution === 'obstacle'
      ? o.resolution
      : undefined

  const refreshedAtTurnId =
    o.refreshedAtTurnId != null && Number.isFinite(Number(o.refreshedAtTurnId))
      ? Number(o.refreshedAtTurnId)
      : undefined

  return {
    targetCharacterId,
    targetName,
    kind,
    createdTurnId,
    expiresAfterPlayerTurns: OPEN_ORDER_TTL_PLAYER_TURNS,
    status,
    resolution,
    refreshedAtTurnId,
  }
}

// ── internals ──────────────────────────────────────────────────────────────

function classifyOrderKind(compact: string, name: string): OpenOrderKind | null {
  const escaped = escapeRegExp(name)
  // retrieve / summon: bring X, get X, find X, send for X, fetch X, call X here
  const retrieve =
    new RegExp(
      `\\b(bring|fetch|get|find|locate|retrieve|summon|send for|call for|have .+ bring)\\b[\\s\\S]{0,40}\\b${escaped}\\b|\\b${escaped}\\b[\\s\\S]{0,30}\\b(to me|here|now|immediately)\\b`,
      'i',
    ).test(compact) ||
    new RegExp(
      `\\b(bring|fetch|get|find|locate|retrieve|summon)\\s+${escaped}\\b`,
      'i',
    ).test(compact)

  // wait / await: wait for X, waiting on X, sit and wait for X
  const awaitKind =
    new RegExp(
      `\\b(wait|waits|waiting|await|awaits|awaiting)\\b[\\s\\S]{0,40}\\b${escaped}\\b|\\b${escaped}\\b[\\s\\S]{0,20}\\b(to arrive|to show|to come)\\b`,
      'i',
    ).test(compact)

  // deadline / time-jump language with named target still outstanding
  const deadline =
    isExplicitTimeJump(compact) &&
    new RegExp(`\\b${escaped}\\b`, 'i').test(compact)

  if (retrieve) return 'retrieve'
  if (awaitKind) return 'await'
  if (deadline) return 'deadline'
  return null
}

function characterNameVariants(c: KnownCharacterForOrder): string[] {
  const names = [c.name.trim()]
  if (c.aliases) {
    for (const a of c.aliases.split(/[\n,;]/)) {
      const t = a.trim()
      if (t.length >= 2) names.push(t)
    }
  }
  // First token if multi-word (Andy from "Andy Osborne") — only when ≥ 3 chars
  // to avoid single-letter noise.
  const first = c.name.trim().split(/\s+/)[0]
  if (first && first.length >= 3 && !names.some((n) => n.toLowerCase() === first.toLowerCase())) {
    names.push(first)
  }
  return names
}

function nameMentions(compact: string, name: string): boolean {
  const n = name.trim().toLowerCase()
  if (n.length < 2) return false
  // Word-boundary-ish match for multi-word names.
  const pattern = new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i')
  return pattern.test(compact)
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

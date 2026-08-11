// Pure plan-salience summary (narrator-craft-freedom S1).
// Decides whether planned NPC moves consume the L1/L2 intrusion budget.
// Structured fields win; prose keywords are a conservative fallback only.
// Adapters pass loaded plan data in — they do not own the salience decision.

export type PlanForSalience = {
  intent?: string | null
  planned_action?: string | null
  intent_type?: string | null
  target_npc_name?: string | null
  target_place_name?: string | null
}

export type OpenOrderForSalience = {
  targetName: string
  targetCharacterId?: number
  kind?: string
  status?: string
} | null

export type PlanSalienceSummary = {
  salientCount: number
  busyworkCount: number
  advancesOpenOrder: boolean
}

// Intent types that are plot-facing (address, relocate, report, pressure).
const SALIENT_INTENT_TYPES = new Set([
  'retrieve',
  'escort',
  'arrive',
  'report',
  'confront',
  'threaten',
  'warn',
  'expose',
  'deliver',
  'summon',
  'intercept',
  'attack',
  'flee',
  'demand',
  'refuse',
  'phone',
  'call',
  'radio',
  'pursue',
  'arrest',
  'detain',
  'challenge',
  'propose',
  'recruit',
])

// Prose that advances an open retrieval / arrival / report outcome.
// Avoid bare "radio" (matches "keeps radio open" busywork) — require report verbs.
const OUTCOME_PROSE =
  /\b(enters?|arrives?|escorts?|brings?|brought|reports?|radios?\s+(?:in|a|the|status|report|that|empty)|radioed|found|fled|refuses?|refused|unavailable|in transit|on (?:his|her|their) way|eta|empty quarters|not (?:there|found)|walks? in|steps? in|presents?|delivers?)\b/i

// Ambient console / posture busywork that must NOT silence world-acts.
const BUSYWORK_PROSE =
  /\b(monitors?|types?|typing|keys?|keying|headset|console|fingers?|keeps? (?:the )?radio open|watches? (?:the )?(?:screen|feed|log)|scrolls?|sits? (?:at|quietly)|remains?|stays? (?:at|put)|glances? (?:at )?(?:the )?(?:screen|console)|taps?)\b/i

const ADDRESS_PROSE =
  /\b(asks?|demands?|presses?|confronts?|addresses?|warns?|threatens?|orders?|interrogat)\b/i

/**
 * Summarize how many plans are plot-salient vs ambient busywork.
 * A plan is salient when it addresses the protagonist with demand/pressure,
 * advances an open order, relocates a named dossier target, or raises threat.
 */
export function summarizePlanSalience(
  plans: PlanForSalience[],
  openOrder: OpenOrderForSalience = null,
): PlanSalienceSummary {
  let salientCount = 0
  let busyworkCount = 0
  let advancesOpenOrder = false

  const orderName = openOrder?.targetName?.trim().toLowerCase() ?? ''
  const orderPending = !openOrder || openOrder.status === 'pending' || openOrder.status == null

  for (const plan of plans) {
    const advances = orderPending && orderName.length > 0 && planAdvancesOpenOrder(plan, orderName)
    if (advances) advancesOpenOrder = true

    if (isSalientPlan(plan, orderName, advances)) {
      salientCount += 1
    } else {
      busyworkCount += 1
    }
  }

  return { salientCount, busyworkCount, advancesOpenOrder }
}

/** True when at least one plan should consume the L1/L2 intrusion slot. */
export function hasSalientIntrusion(summary: PlanSalienceSummary): boolean {
  return summary.salientCount > 0 || summary.advancesOpenOrder
}

function planAdvancesOpenOrder(plan: PlanForSalience, orderNameLower: string): boolean {
  const target = (plan.target_npc_name ?? '').trim().toLowerCase()
  if (target && (target === orderNameLower || orderNameLower.includes(target) || target.includes(orderNameLower))) {
    return true
  }

  const intentType = (plan.intent_type ?? '').trim().toLowerCase()
  if (
    ['retrieve', 'escort', 'arrive', 'report', 'deliver', 'summon', 'radio', 'phone', 'call'].includes(
      intentType,
    )
  ) {
    const blob = planBlob(plan).toLowerCase()
    if (blob.includes(orderNameLower) || OUTCOME_PROSE.test(blob)) return true
  }

  const blob = planBlob(plan)
  if (blob.toLowerCase().includes(orderNameLower) && OUTCOME_PROSE.test(blob)) return true

  return false
}

function isSalientPlan(
  plan: PlanForSalience,
  orderNameLower: string,
  advancesOpenOrder: boolean,
): boolean {
  if (advancesOpenOrder) return true

  const blob = planBlob(plan)
  // Pure busywork never consumes the intrusion slot (S1 invariant).
  if (blob && isPureBusywork(blob)) return false

  const intentType = (plan.intent_type ?? '').trim().toLowerCase()
  if (intentType && SALIENT_INTENT_TYPES.has(intentType)) return true

  // Relocation of a named place with a concrete go-to intent is plot-facing.
  if (plan.target_place_name?.trim() && intentType && intentType !== 'react' && intentType !== 'support') {
    return true
  }

  if (!blob) return false

  // Named open-order target in plan text with outcome language.
  if (orderNameLower && blob.toLowerCase().includes(orderNameLower) && OUTCOME_PROSE.test(blob)) {
    return true
  }

  // Addresses protagonist with demand/question/pressure.
  if (ADDRESS_PROSE.test(blob) && /\b(you|protagonist|player|sir|ma'?am|commander)\b/i.test(blob)) {
    return true
  }

  // Arrival / report / threat outcomes even without open order.
  if (OUTCOME_PROSE.test(blob)) return true

  return false
}

function isPureBusywork(blob: string): boolean {
  if (!BUSYWORK_PROSE.test(blob)) return false
  // Busywork language alone — no concrete outcome/address language.
  return !OUTCOME_PROSE.test(blob) && !ADDRESS_PROSE.test(blob)
}

function planBlob(plan: PlanForSalience): string {
  return [plan.planned_action, plan.intent].filter(Boolean).join(' ').trim()
}

// Soft turn director (narrator-craft-freedom Phase B + S1/S2).
// Risk-gated craft cues only — hard rules live in narrator-system.md.
// High-priority motion cues (open order, salient-plan-aware momentum) are never
// sparse-awayed. Pure: no I/O.

import {
  hasSalientIntrusion,
  summarizePlanSalience,
  type OpenOrderForSalience,
  type PlanForSalience,
  type PlanSalienceSummary,
} from '@/domain/services/plan-salience'
import {
  isExplicitTimeJump,
  isYieldMove,
  type OpenOrder,
} from '@/domain/services/open-order'
import type { PrivateUtterance } from '@/domain/services/private-utterance'

// Consecutive low-agency player moves before the narrator should make the world
// act on its own (escalating momentum). Tunable.
const MOMENTUM_IDLE_THRESHOLD = 2

type RecentTurn = { role: 'user' | 'assistant'; content: string }

export type GuidanceContext = {
  stance: string
  inputMode: string
  playerText: string
  recentTurns: RecentTurn[]
  presentNpcCount: number
  /** Raw plan count — used only when plannedActions/planSalience are absent. */
  plannedActionCount: number
  /** Structured plans for S1 salience (preferred over raw count). */
  plannedActions?: PlanForSalience[]
  /** Precomputed salience; when set, preferred over recomputing from plannedActions. */
  planSalience?: PlanSalienceSummary
  /** Pending open order for S2 resolve cue (never sparse-awayed). */
  openOrder?: OpenOrder | null
  /** Active private channel this turn (never sparse-awayed). */
  privateUtterance?: PrivateUtterance | null
  worldTime?: string | null
  activeObjectiveTitles?: string[]
  openClueTitles?: string[]
  activeThreatTitles?: string[]
  /** Highest-stakes active quest/objective title for idle primary pressure. */
  primaryPressureTitle?: string | null
}

/**
 * Risk-gated turn guidance. Returns null when no risk fires so the caller can
 * omit the entire ## TURN GUIDANCE section (Phase B).
 */
export function formatNarratorTurnGuidance(ctx: GuidanceContext): string | null {
  if (ctx.inputMode !== 'in-character' || ctx.stance === 'meta') {
    return [
      '## TURN GUIDANCE',
      'Brief reply in the narrator voice — keep the fiction in place; do not advance the scene.',
    ].join('\n')
  }

  const lines: string[] = []
  const salience = resolveSalience(ctx)

  // Private-channel audience pin: never sparse-away.
  const privateCue = pickPrivateUtteranceCue(ctx)
  if (privateCue) lines.push(privateCue)

  // Lethal / combat fiction: never sparse-away — blocks OOC model refusals.
  const fictionViolenceCue = pickFictionViolenceCue(ctx)
  if (fictionViolenceCue) lines.push(fictionViolenceCue)

  // S2 — open order on yield/idle/time-jump: never sparse-away.
  const openOrderCue = pickOpenOrderCue(ctx)
  if (openOrderCue) lines.push(openOrderCue)

  if (isTimeCheckMove(ctx.playerText)) {
    lines.push(
      `The time-bearing device shows the authoritative world clock exactly: ${ctx.worldTime ?? '(unset)'}.`,
    )
  }

  const continuity = pickContinuityNudge(ctx.recentTurns)
  if (continuity) lines.push(continuity)

  // L2 / L1 — S1 salient-plan gate (busywork does not suppress).
  const momentum = pickMomentumCue(ctx, salience)
  if (momentum) lines.push(momentum)
  else {
    const engagement = pickEngagementCue(ctx, salience)
    if (engagement) lines.push(engagement)
  }

  // Pressure-stall: salient confront plans can keep L2 off while the scene
  // circles on "speak / wait / judgment" without a legible next act (Sequence
  // Vigil sanctum class). High priority — not suppressed by plan salience.
  const clearHandle = pickClearHandleCue(ctx)
  if (clearHandle) lines.push(clearHandle)

  // Craft beat cues — only when a risk heuristic fires (sparse).
  const beat = pickSparseBeatCue(ctx)
  if (beat) lines.push(beat)

  // Investigative pressure only when open clues/objectives exist.
  if (isInvestigativeMove(ctx.playerText)) {
    const objHint = ctx.activeObjectiveTitles?.slice(0, 2).join('; ')
    const clueHint = ctx.openClueTitles?.slice(0, 3).join('; ')
    if (objHint || clueHint) {
      const parts: string[] = []
      if (objHint) parts.push(`objectives: ${objHint}`)
      if (clueHint) parts.push(`clues: ${clueHint}`)
      lines.push(
        `Internal pressure only — do not name these to the player; let at most one bend the scene through action or subtext if natural — ${parts.join(' | ')}.`,
      )
    }
  }

  if (lines.length === 0) return null
  return ['## TURN GUIDANCE', ...lines].join('\n')
}

function resolveSalience(ctx: GuidanceContext): PlanSalienceSummary {
  if (ctx.planSalience) return ctx.planSalience
  if (ctx.plannedActions && ctx.plannedActions.length > 0) {
    return summarizePlanSalience(
      ctx.plannedActions,
      openOrderAsSalience(ctx.openOrder),
    )
  }
  // No structured plans: treat raw count as all-busywork so S1 regression
  // stays locked (raw plannedActionCount alone must not silence L2).
  if (ctx.plannedActionCount > 0) {
    return {
      salientCount: 0,
      busyworkCount: ctx.plannedActionCount,
      advancesOpenOrder: false,
    }
  }
  return { salientCount: 0, busyworkCount: 0, advancesOpenOrder: false }
}

function openOrderAsSalience(order: OpenOrder | null | undefined): OpenOrderForSalience {
  if (!order || order.status !== 'pending') return null
  return {
    targetName: order.targetName,
    targetCharacterId: order.targetCharacterId,
    kind: order.kind,
    status: order.status,
  }
}

function pickOpenOrderCue(ctx: GuidanceContext): string | null {
  const order = ctx.openOrder
  if (!order || order.status !== 'pending') return null

  const yieldish =
    isYieldMove(ctx.playerText) ||
    isExplicitTimeJump(ctx.playerText) ||
    countTrailingIdleMoves(ctx) >= 1 ||
    isLowAgencyMove(ctx.playerText)

  if (!yieldish) return null

  const timeJump = isExplicitTimeJump(ctx.playerText)
  return (
    `OPEN ORDER outstanding (${order.kind}): ${order.targetName}. ` +
    (timeJump
      ? 'Time has jumped — land a mandatory concrete outcome for this order this turn (success, partial, failure, or new cost). '
      : '') +
    'Dramatize the authoritative open-order status this turn — arrival, concrete report, refusal, or new obstacle. ' +
    'Do not only restate the protagonist waiting. Do not invent an off-scene relocation beyond STATE.'
  )
}

function pickPrivateUtteranceCue(ctx: GuidanceContext): string | null {
  const u = ctx.privateUtterance
  if (!u || u.status !== 'active' || u.audienceNames.length === 0) return null
  const audience =
    u.audienceNames.length === 1 ? `${u.audienceNames[0]} only` : u.audienceNames.join(', ')
  return (
    `Honor PRIVATE THIS TURN audience (${u.channel}: ${audience}). ` +
    'Non-audience NPCs must not react to or know the private content; ' +
    'they may notice that a private exchange happened without hearing the words. ' +
    'Off-scene NPCs must not reference it.'
  )
}

/**
 * When the player attempts combat / lethal force, pin that this is fiction and
 * OOC policy refusals are forbidden. Does not invent weapons — STATE still wins
 * for CARRIED / ITEMS HERE.
 */
function pickFictionViolenceCue(ctx: GuidanceContext): string | null {
  if (!isLethalOrArmedCombatMove(ctx.playerText)) return null
  return (
    'This turn is fictional combat/violence inside the novel. ' +
    'Stay fully diegetic — never write an OOC refusal, disclaimer, or "I will not narrate…". ' +
    'Stage the attempt with sensory craft and immediate diegetic consequences ' +
    '(miss, hit, flight, alarm, witnesses, institutional response). ' +
    'If STATE does not list a required weapon on CARRIED / ITEMS HERE, narrate in-world absence — not a policy ban.'
  )
}

function isLethalOrArmedCombatMove(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /\b(shoot|shoots|shooting|shot|fire|fires|firing|fired)\b/.test(t) ||
    /\b(pull(?:s|ed|ing)?\s+the\s+trigger|squeeze(?:s|d)?\s+the\s+trigger)\b/.test(t) ||
    /\b(pistol|gun|rifle|revolver|handgun|firearm|shotgun|weapon)\b/.test(t) &&
      /\b(draw|draws|drew|drawing|whip|whips|whipped|raise|raises|raised|aim|aims|aimed|point|points|pointed|pull|pulls|pulled|use|uses|used|fire|fires|fired)\b/.test(
        t,
      ) ||
    /\b(kill|kills|killing|murder|murders|murdering|execute|executes|stab|stabs|stabbing|slit|slits|strangle|strangles|choke|chokes)\b/.test(
      t,
    ) ||
    /\b(slash|slashes|hack|hacks|decapitat|blow\s+(?:his|her|their)\s+brains)\b/.test(t)
  )
}

/**
 * Detect "pressure theater": recent narration ends on speak/judgment/wait demands
 * without a concrete next act (follow, leave, hand over, strike, go to a place).
 * Sequence Vigil sanctum: many turns of "Speak now… The chamber waits."
 */
function isPressureStalled(turns: RecentTurn[]): boolean {
  const recent = turns
    .filter((t) => t.role === 'assistant')
    .slice(-3)
    .map((t) => t.content)
  if (recent.length < 2) return false

  let demandOnly = 0
  for (const text of recent) {
    const tail = text.slice(-420).toLowerCase()
    const demandsSpeechOrJudgment =
      /\b(speak|answer|name|judgment|judge|choose|utter|silence|binding|waits?|waiting|render|seal holds|the stone)\b/.test(
        tail,
      )
    // Concrete handles the player can act on (paths, objects, violence, exit).
    const hasPathHandle =
      /\b(follow|run|leave|flee|hand|give|take|bring|strike|kill|open|close|descend|climb|west|east|north|south|door|gate|path|road|court|tomb|temple|palace|stairs?|step back|step forward|drop|pick up|draw|put down)\b/.test(
        tail,
      )
    if (demandsSpeechOrJudgment && !hasPathHandle) demandOnly += 1
  }
  return demandOnly >= 2
}

/**
 * When the scene circles without a legible next act, force one character demand
 * that the player can actually pursue — not a menu, one situation.
 * Fires even when salient plans already suppress L2 (those plans are often the
 * same confront loop that causes the stall).
 */
function pickClearHandleCue(ctx: GuidanceContext): string | null {
  if (ctx.presentNpcCount < 1) return null

  const stalled = isPressureStalled(ctx.recentTurns)
  const idle = countTrailingIdleMoves(ctx) >= 1
  // Multi-cast idle without stall text still often needs a handle; single idle
  // engagement cue may already fire — clear-handle is for stall or crowded idle.
  if (!stalled && !(idle && ctx.presentNpcCount >= 2)) return null

  const primary = ctx.primaryPressureTitle?.trim()
  return (
    'The scene is circling without a clear next act for the protagonist. ' +
    'Have a present character make ONE legible demand of what they want done next — ' +
    'a concrete physical or social move (follow them now, hand over the sealed object, ' +
    'leave by a named path, submit to a rite with a named first step, stand aside while they act). ' +
    'Do not only restack “speak / answer / wait / the chamber waits.” ' +
    'If the demand is refused or delayed, land a consequence this turn that changes the board ' +
    '(someone leaves, someone takes the object, a path closes, a cost is paid).' +
    (primary
      ? ` Prefer advancing the live pressure "${primary}" over inventing a new ritual loop.`
      : '')
  )
}

function pickSparseBeatCue(ctx: GuidanceContext): string | null {
  const text = ctx.playerText

  if (isChargedRecognitionMove(text)) {
    return 'This is a charged recognition beat — give it novelistic weight: body, room, the old object losing meaning, the choice that opens.'
  }
  if (isSpectacleMove(text)) {
    return 'This is spectacle — let it unfold as a sequence: anticipation, physical change, witnesses, aftermath. Repeated power should vary or escalate.'
  }
  if (isChargedConfrontationMove(text)) {
    return 'This is a charged confrontation — let spacing, witnesses, silence, and reply carry the pressure.'
  }
  if (isMediaFeedMove(text)) {
    return 'This is a public information surface — put specific diegetic content on it; at least one concrete wider-world item that could recur.'
  }
  if (isInvestigativeMove(text)) {
    return 'The player is trying to learn something — return a concrete result, partial match, contradiction, named obstacle, or new lead.'
  }
  if (isDangerMove(text) || isTransitionMove(text)) {
    // Keep a short breathe cue only for arrival/danger — not every driving move.
    return 'Let the beat breathe — arrival, danger, or consequence can reveal layout, cost, witness, texture, or choice.'
  }

  // Observe: only when recent establishing turns were short / empty — not every look.
  if (ctx.stance === 'observe' || isAttentionOnlyMove(text)) {
    if (recentEstablishingWasThin(ctx.recentTurns)) {
      return (
        'The protagonist is taking in the scene — render concrete multi-sensory specifics ' +
        'and surface at least one new handle; if the scene was already painted richly, vary focus or advance something.'
      )
    }
    return null
  }

  // Say: only if last assistant turn summarized speech rather than quoting it.
  if (ctx.stance === 'say') {
    if (lastAssistantSummarizedSpeech(ctx.recentTurns)) {
      const language = detectMarkedSpokenLanguage(text)
      if (language) {
        return `Let audible dialogue be audible — write the words someone answers with, not a summary. The player marked their speech as ${language}; a light romanized touch keeps it audible while the meaning stays clear in English.`
      }
      return 'Let audible dialogue be audible — write the words someone answers with, not a summary.'
    }
    return null
  }

  return null
}

function recentEstablishingWasThin(turns: RecentTurn[]): boolean {
  const recent = turns
    .filter((t) => t.role === 'assistant')
    .slice(-2)
    .map((t) => t.content)
  if (recent.length === 0) return true
  // Thin = short survey or empty establishing.
  return recent.every((c) => c.trim().length < 400)
}

function lastAssistantSummarizedSpeech(turns: RecentTurn[]): boolean {
  const last = [...turns].reverse().find((t) => t.role === 'assistant')
  if (!last) return true
  const hasQuotedDialogue = /["“][^"”]{2,}["”]/.test(last.content)
  const summaryShape =
    /\b(replies?|answers?|says?|tells? you|responds?|agrees?|nods?)\b/i.test(last.content) &&
    !hasQuotedDialogue
  return summaryShape || !hasQuotedDialogue
}

function isLowAgencyMove(text: string): boolean {
  const compact = normalize(text)
  if (isAttentionOnlyMove(text)) return true
  return (
    compact.length <= 40 &&
    /\b(wait|waits|continue|continues|keep going|carry on|stay|stand|listen|nothing|hold|pause|rest)\b/.test(
      compact,
    )
  )
}

function countTrailingIdleMoves(ctx: GuidanceContext): number {
  const priorPlayer = ctx.recentTurns
    .filter((t) => t.role === 'user')
    .map((t) => t.content)
    .reverse()
  let count = isLowAgencyMove(ctx.playerText) ? 1 : 0
  if (count === 0) return 0
  for (const text of priorPlayer) {
    if (isLowAgencyMove(text)) count += 1
    else break
  }
  return count
}

function pickMomentumCue(
  ctx: GuidanceContext,
  salience: PlanSalienceSummary,
): string | null {
  // S1: only plot-salient plans consume the intrusion slot. Busywork does not.
  if (hasSalientIntrusion(salience)) return null
  const idle = countTrailingIdleMoves(ctx)
  if (idle < MOMENTUM_IDLE_THRESHOLD) return null
  const threat = ctx.activeThreatTitles?.[0]
  const primary = ctx.primaryPressureTitle?.trim()
  const pressure = threat
    ? ` Draw the pressure from the active threat "${threat}".`
    : primary
      ? ` Draw the pressure from the primary objective "${primary}" (watcher, audit rumor, time bite, consequence of delay) — never list it as options to the player.`
      : ''
  return (
    'The player is marking time — the world acts: make something happen TO the protagonist this ' +
    'turn that they did not initiate (an NPC pursues its goal, a threat closes, time bites, a new ' +
    'element enters). Create a situation, not a forced choice; do not decide the protagonist’s ' +
    'actions or feelings; one intrusion only.' +
    pressure
  )
}

function pickEngagementCue(
  ctx: GuidanceContext,
  salience: PlanSalienceSummary,
): string | null {
  if (ctx.presentNpcCount < 1) return null
  if (hasSalientIntrusion(salience)) return null
  if (ctx.recentTurns.length === 0) return null
  const idle = countTrailingIdleMoves(ctx)
  if (idle < 1 || idle >= MOMENTUM_IDLE_THRESHOLD) return null
  return (
    'The protagonist is hanging back — let a present character take the initiative: one of them ' +
    'steps forward, addresses the protagonist directly, and presses for a response (a pointed ' +
    'question, a demand, a held look that needs answering). Do not decide the protagonist’s reply ' +
    'or feelings, and do not offer a menu of options.'
  )
}

function pickContinuityNudge(turns: RecentTurn[]): string | null {
  if (restatesPriorTurn(turns)) {
    return (
      'Recent narration is restating itself — the last turn reopened with the previous turn’s ' +
      'scene and cast positions almost verbatim. Do NOT re-establish the standing setting, ' +
      'restate where each character is positioned, or repeat a one-time time-transition (e.g. ' +
      '"Two hours later"). Open from the new action already in motion and advance; bring a ' +
      'character onto the page only when they do something new this turn.'
    )
  }
  const anchors = repeatedAmbientAnchors(turns)
  if (anchors.length > 0) {
    const list = joinList(anchors)
    return `Recent narration has leaned on ${list} as an ambient closer — return to ${list} only if it changes, becomes evidence, or the protagonist interacts with it.`
  }
  if (recentNarrationIsStalled(turns)) {
    return 'Recent narration is repeating its architecture. Change the shape — start in motion, lead with consequence, add dialogue, advance time, or land on a concrete new choice.'
  }
  return null
}

function isAttentionOnlyMove(text: string): boolean {
  const compact = normalize(text)
  return /\b(i )?(look|stare|glance|watch|listen)\b/.test(compact) && compact.length <= 90
}

function isInvestigativeMove(text: string): boolean {
  const compact = normalize(text)
  const hasAnalysisVerb =
    /\b(pattern match|match|scan|analy[sz]e|identify|inspect|examine|read|check|search|compare|diagnose|translate|decode|look up|trace|sample)\b/.test(
      compact,
    )
  const hasQuestion = /\b(what|who|where|when|why|how|which)\b|\?/.test(compact)
  const targetsToolOrInquiry =
    /\b(vox|auspex|cogitator|scanner|sensor|reader|servo|computer|database|archive|records?|ledgers?|manifests?|dispatch|dispatches|letters?|documents?|papers|maps?|charts?|scrolls?|tablet|inscription|registers?|registry|logbook|log|correspondence)\b/.test(
      compact,
    ) || hasQuestion

  return hasAnalysisVerb && targetsToolOrInquiry
}

function isTimeCheckMove(text: string): boolean {
  const compact = normalize(text)
  const hasCheckVerb = /\b(check|look at|look|glance at|read|consult|see|inspect)\b/.test(compact)
  const hasTimeQuestion = /\bwhat time\b|\btime is it\b|\bcurrent time\b/.test(compact)
  const hasTimeDevice =
    /\b(watch|wristwatch|phone|cell|mobile|smartphone|clock|wall clock|alarm clock|dashboard clock|car clock|computer clock|laptop|terminal|display|screen|sundial|hourglass|hour glass|water clock|candle clock|bells?|church bells?|bell tower|chimes?|the sun|position of the sun|the stars)\b/.test(
      compact,
    )
  return (
    hasTimeQuestion ||
    (hasCheckVerb &&
      hasTimeDevice &&
      /\b(time|clock|watch|phone|sundial|hourglass|bell|chime|sun|stars?|candle)\b/.test(compact))
  )
}

function isMediaFeedMove(text: string): boolean {
  const compact = normalize(text)
  const hasOpenOrCheckVerb =
    /\b(open|opens|check|checks|look at|looks at|look through|scroll|scrolls|read|reads|watch|watches|listen|listens|turn on|turns on|browse|browses|refresh|refreshes)\b/.test(
      compact,
    )
  const hasMediaSurface =
    /\b(x|twitter|feed|timeline|social media|news|headlines?|tv|television|radio|podcast|browser|web|internet|notifications?|alerts?|email|inbox|screen|phone|newspaper|broadsheets?|gazette|herald|chronicle|bulletin|notice board|placards?|proclamations?|town crier|crier|rumors?|rumours?|gossip|messengers?|dispatches?|posted notices?)\b/.test(
      compact,
    )

  return hasOpenOrCheckVerb && hasMediaSurface
}

function isTransitionMove(text: string): boolean {
  const compact = normalize(text)
  return /\b(go|goes|walk|walks|run|runs|head|heads|travel|travels|cross|crosses|enter|enters|leave|leaves|return|returns|approach|approaches|make my way|move|moves|climb|climbs|drive|drives)\b/.test(
    compact,
  )
}

function isDangerMove(text: string): boolean {
  const compact = normalize(text)
  return /\b(explosion|blast|crater|blood|corpse|dead|wound|weapon|gun|knife|attack|threat|danger|fire|smoke|scream|alarm|soldier|body|poison|venom|plague|curse|hex|necromancer|demon|beast|wolves?|bandits?|raiders?|sword|blade|dagger|spear|arrows?|axe|halberd|musket|cannon|siege|ambush|noose|gallows|pyre|assassin|plot)\b/.test(
    compact,
  )
}

function isSpectacleMove(text: string): boolean {
  const compact = normalize(text)
  const hasPowerVerb =
    /\b(crush|crumple|fold|tear|rip|burst|explode|ignite|burn|shatter|collapse|detonate|blast|throw|hurl|levitate|lift|split|peel|melt)\b/.test(
      compact,
    )
  const hasSpectacleObject =
    /\b(car|cars|cruiser|cruisers|squad car|truck|building|wall|door|bulkhead|ship|tower|bridge|body|bodies|dragon|spell|ward|reactor|engine|weapon|blade|gun|flame|fire|lightning|vacuum|ziggurat|temple|cathedral|stained.glass|statue|idol|altar|pillar|column|gate|portcullis|catapult|trebuchet|chariot|galley|mast|sail|banner|throne|obelisk|pyramid|aqueduct)\b/.test(
      compact,
    )
  const repeatsSpectacle = /\b(do the same|same thing|again|one by one)\b/.test(compact)
  return (hasPowerVerb && hasSpectacleObject) || (repeatsSpectacle && hasSpectacleObject)
}

function isChargedRecognitionMove(text: string): boolean {
  const compact = normalize(text)
  const takesStock = /\b(take stock|listen for|look around|situation)\b/.test(compact)
  const alteredCalm =
    /\b(don'?t feel|do not feel|feel great|feel calm|not alarmed|not stressed|strange|almost pleasant)\b/.test(
      compact,
    )
  const identityShift =
    /\b(i am|i'm|ive become|i have become|i don'?t need|do not need|no longer need).{0,80}\b(weapon|monster|god|blade|storm|fire|power|magic|gun|sword|tool)\b/.test(
      compact,
    ) || /\b(i am|i'm) a weapon\b/.test(compact)
  return (takesStock && alteredCalm) || identityShift
}

function isChargedConfrontationMove(text: string): boolean {
  const compact = normalize(text)
  const hasDialogue = /["“][^"”]{2,}["”]/.test(text)
  const hasPressureVerb =
    /\b(command|threaten|warn|demand|interrogate|accuse|confront|approach|smile|bring me|if you value your life|not being honest|lie|lying|answer me)\b/.test(
      compact,
    )
  return hasDialogue && hasPressureVerb
}

function detectMarkedSpokenLanguage(text: string): string | null {
  const compact = normalize(text)
  const match = compact.match(
    /\b(?:speak|say|ask|answer|reply|call|whisper|shout|tell|murmur|mutter)s?\s+(?:to\s+\w+\s+)?in\s+(russian|spanish|french|german|italian|japanese|mandarin|cantonese|korean|arabic|hindi|latin)\b/,
  )
  if (!match) return null

  const language = match[1]
  return language.charAt(0).toUpperCase() + language.slice(1)
}

function restatesPriorTurn(turns: RecentTurn[]): boolean {
  const recent = turns
    .filter((t) => t.role === 'assistant')
    .slice(-2)
    .map((t) => t.content)
  if (recent.length < 2) return false
  const [prev, last] = recent

  const openSim = jaccard(tokenize(firstSentence(prev)), tokenize(firstSentence(last)))
  const tailSim = jaccard(tokenize(prev.slice(-260)), tokenize(last.slice(-260)))
  const bodySim = jaccard(tokenize(prev), tokenize(last))

  return openSim >= 0.8 || bodySim >= 0.6 || tailSim >= 0.7
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function tokenize(text: string): Set<string> {
  return new Set(normalize(text).match(/[a-z']+/g) ?? [])
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

function firstSentence(text: string): string {
  return (text.match(/^.*?[.!?](?:\s|$)/)?.[0] ?? text).slice(0, 160)
}

function recentNarrationIsStalled(turns: RecentTurn[]): boolean {
  const recentAssistant = turns
    .filter((t) => t.role === 'assistant')
    .slice(-2)
    .map((t) => t.content)

  if (recentAssistant.length < 2) return false
  return recentAssistant.every(isReactionOnlyNarration)
}

function repeatedAmbientAnchors(turns: RecentTurn[]): string[] {
  const recentAssistantEndings = turns
    .filter((t) => t.role === 'assistant')
    .slice(-4)
    .map((t) => t.content.toLowerCase().replace(/\s+/g, ' ').slice(-260))

  if (recentAssistantEndings.length < 2) return []

  const anchors = [
    { label: 'wheat', terms: ['wheat', 'grain'] },
    { label: 'rain', terms: ['rain'] },
    { label: 'bell', terms: ['bell'] },
    { label: 'spire', terms: ['spire'] },
    { label: 'wind', terms: ['wind'] },
    { label: 'fog', terms: ['fog', 'mist'] },
    { label: 'sky', terms: ['sky'] },
    { label: 'field', terms: ['field'] },
    { label: 'mud', terms: ['mud', 'soil'] },
    { label: 'snow', terms: ['snow'] },
    { label: 'trees', terms: ['trees'] },
    { label: 'water', terms: ['water', 'sea'] },
    { label: 'streetlights', terms: ['streetlights'] },
    { label: 'fluorescents', terms: ['fluorescents'] },
    { label: 'sand', terms: ['sand', 'dune', 'dunes'] },
    { label: 'palms', terms: ['palm', 'palms'] },
    { label: 'dust', terms: ['dust'] },
    { label: 'candlelight', terms: ['candle', 'candlelight'] },
    { label: 'torchlight', terms: ['torch', 'torchlight'] },
    { label: 'incense', terms: ['incense'] },
    { label: 'smoke', terms: ['smoke'] },
    { label: 'stone', terms: ['stone', 'marble'] },
    { label: 'cobblestones', terms: ['cobbles', 'cobblestone', 'cobblestones'] },
    { label: 'gaslight', terms: ['gaslight', 'gaslamp', 'gas lamp'] },
    { label: 'lantern', terms: ['lantern', 'lanterns'] },
    { label: 'hearth', terms: ['hearth'] },
    { label: 'river', terms: ['river'] },
    { label: 'reeds', terms: ['reeds'] },
  ]

  return anchors
    .filter((anchor) => {
      const pattern = new RegExp(`\\b(?:${anchor.terms.map(escapeRegExp).join('|')})\\b`, 'i')
      return recentAssistantEndings.filter((ending) => pattern.test(ending)).length >= 2
    })
    .map((anchor) => anchor.label)
    .slice(0, 3)
}

function isReactionOnlyNarration(text: string): boolean {
  const compact = normalize(text)
  const hasMotion =
    /\b(enters?|arrives?|leaves?|walks?|runs?|calls?|phones?|texts?|offers?|asks?|demands?|warns?|reveals?|opens?|closes?|brings?|hands?|takes?|sets off|rings?|knocks?)\b/.test(
      compact,
    )
  const hasStaticReaction =
    /\b(looks?|glances?|watches?|stares?|eyes?|silent|quiet|still|pauses?|waits?|turns? (?:his|her|their) head|narrows?)\b/.test(
      compact,
    )

  return compact.length < 700 && hasStaticReaction && !hasMotion
}

function joinList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? ''
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

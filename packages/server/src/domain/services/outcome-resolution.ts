// Pure Conductor referee. Rules win; return null when a gated Haiku call
// should resolve a contested assertion. No I/O.

import type {
  AdjudicationInputMode,
  AdjudicationStance,
  OutcomeLabel,
  ResolvedOutcome,
} from '@/domain/entities/resolved-outcome'
import {
  isAdjudicationInputMode,
  isAdjudicationStance,
  isOutcomeLabel,
} from '@/domain/entities/resolved-outcome'
import type { InputMode, Stance } from '@/domain/services/action-classifier-rules'

export type OutcomeResolutionInput = {
  playerText: string
  stance: Stance
  inputMode: InputMode
}

export function isBindingOutcome(resolution: ResolvedOutcome): boolean {
  return resolution.outcome !== 'not_applicable'
}

/** Rules path. Null means the assertion is contested and needs the port. */
export function resolveOutcomeWithRules(
  input: OutcomeResolutionInput,
): ResolvedOutcome | null {
  const text = input.playerText.trim()
  if (!text) return notApplicable('unclear', 'meta_or_unclear', '')

  if (input.stance === 'meta' || input.inputMode === 'ooc') {
    return notApplicable('unclear', 'meta_or_unclear', text)
  }

  const contested = isContestedAction(text)
  if (isCinematicFraming(text) && !contested) {
    return notApplicable('unclear', 'cinematic_framing', text)
  }
  if (isEmotionalInteriority(text) && !contested) {
    return notApplicable('unclear', 'emotional_interiority', text)
  }

  if (isImpossibleClaim(text)) {
    return {
      intent: clip(text, 160),
      stance: 'asserted_outcome',
      inputMode: 'asserted_outcome',
      outcome: 'impossible',
      worldStateDelta:
        'The asserted result cannot happen under this world. Narrate in-world failure or impossibility — do not grant it.',
    }
  }

  if (contested) return null
  return notApplicable('attempt', 'tactical_intent', text)
}

/** Fail-open when the Haiku referee dies: never grant the asserted result. */
export function contestedFallback(playerText: string): ResolvedOutcome {
  return {
    intent: clip(playerText, 160),
    stance: 'asserted_outcome',
    inputMode: 'asserted_outcome',
    outcome: 'partial_success',
    worldStateDelta:
      'The attempt is contested. Narrate an uncertain attempt in progress — do not grant the asserted result.',
  }
}

export function sanitizeResolvedOutcome(
  raw: Partial<ResolvedOutcome>,
  playerText: string,
): ResolvedOutcome {
  const fallback = contestedFallback(playerText)
  const stanceRaw = raw.stance
  const modeRaw = raw.inputMode
  const outcomeRaw = raw.outcome
  const stance: AdjudicationStance =
    stanceRaw && isAdjudicationStance(stanceRaw) ? stanceRaw : fallback.stance
  const inputMode: AdjudicationInputMode =
    modeRaw && isAdjudicationInputMode(modeRaw) ? modeRaw : fallback.inputMode
  let outcome: OutcomeLabel =
    outcomeRaw && isOutcomeLabel(outcomeRaw) ? outcomeRaw : fallback.outcome
  // Contested calls must not quietly waive adjudication.
  if (outcome === 'not_applicable') outcome = fallback.outcome
  return {
    intent: clip(typeof raw.intent === 'string' && raw.intent.trim() ? raw.intent : playerText, 160),
    stance,
    inputMode,
    outcome,
    worldStateDelta: clip(
      typeof raw.worldStateDelta === 'string' && raw.worldStateDelta.trim()
        ? raw.worldStateDelta
        : fallback.worldStateDelta,
      240,
    ),
  }
}

export function outcomeToMetadata(
  resolution: ResolvedOutcome,
): Record<string, unknown> {
  return {
    intent: resolution.intent,
    stance: resolution.stance,
    inputMode: resolution.inputMode,
    outcome: resolution.outcome,
    worldStateDelta: resolution.worldStateDelta,
  }
}

function notApplicable(
  stance: AdjudicationStance,
  inputMode: AdjudicationInputMode,
  playerText: string,
): ResolvedOutcome {
  return {
    intent: clip(playerText, 160),
    stance,
    inputMode,
    outcome: 'not_applicable',
    worldStateDelta: '',
  }
}

function isContestedAction(text: string): boolean {
  return (
    ASSERTED_COMPLETION.test(text) ||
    CONTESTED_ATTEMPT.test(text) ||
    COMPLETED_RESULT.test(text)
  )
}

function isCinematicFraming(text: string): boolean {
  return /\b(cut to|smash cut|montage|in a burst of light|the camera|fade to black)\b/i.test(
    text,
  )
}

function isEmotionalInteriority(text: string): boolean {
  return /^(i(?:'m| am| feel)\s+(?:sad|devastated|angry|afraid|scared|happy|relieved|guilty|ashamed|heartbroken))\b/i.test(
    text.trim(),
  )
}

function isImpossibleClaim(text: string): boolean {
  return /\b(stop time|rewind time|become (?:a )?god|become immortal|delete the|pause the (?:game|story)|win the game|i am (?:omnipotent|invincible))\b/i.test(
    text,
  )
}

const ASSERTED_COMPLETION =
  /\b(i|we)\s+(?:just\s+)?(kill|murder|slay|execute|assassinate|destroy|obliterate|vaporize|disintegrate|decapitate|behead|cut off|sever|chop off|knock (?:him|her|them|it) (?:out|unconscious)|steal|rob|blow up|explode|defeat|conquer)\b/i

const CONTESTED_ATTEMPT =
  /\b(try|attempt|tried|attempting)\s+to\s+(kill|murder|steal|cut off|destroy|convince|force|knock|assassinate|behead)\b/i

const COMPLETED_RESULT =
  /\b((?:he|she|they|it)'s|(?:he|she|they|it) is|(?:they) are)\s+(dead|gone|unconscious)\b|\b(leg|arm|head|hand)\s+(is|are)\s+(off|severed|gone)\b/i

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`
}

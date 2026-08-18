// Conductor referee result — did the asserted outcome happen?
// Pure value. Injected as a STATE pin; never dumped into narrator history.

export const ADJUDICATION_STANCES = [
  'attempt',
  'strong_intent',
  'asserted_outcome',
  'unclear',
] as const
export type AdjudicationStance = (typeof ADJUDICATION_STANCES)[number]

export const ADJUDICATION_INPUT_MODES = [
  'tactical_intent',
  'asserted_outcome',
  'cinematic_framing',
  'emotional_interiority',
  'meta_or_unclear',
] as const
export type AdjudicationInputMode = (typeof ADJUDICATION_INPUT_MODES)[number]

export const OUTCOME_LABELS = [
  'failure',
  'partial_success',
  'success',
  'success_with_cost',
  'impossible',
  'not_applicable',
] as const
export type OutcomeLabel = (typeof OUTCOME_LABELS)[number]

export type ResolvedOutcome = {
  intent: string
  stance: AdjudicationStance
  inputMode: AdjudicationInputMode
  outcome: OutcomeLabel
  worldStateDelta: string
}

export function isAdjudicationStance(value: string): value is AdjudicationStance {
  return (ADJUDICATION_STANCES as readonly string[]).includes(value)
}

export function isAdjudicationInputMode(value: string): value is AdjudicationInputMode {
  return (ADJUDICATION_INPUT_MODES as readonly string[]).includes(value)
}

export function isOutcomeLabel(value: string): value is OutcomeLabel {
  return (OUTCOME_LABELS as readonly string[]).includes(value)
}

// Dialogue staging edges. Plans are decisions; the narrator owns spoken words.
// Pure: strip leaked lines, mark talk-shaped plans, author-once register caps.

export const SPEECH_REGISTER_MAX = 200
export const SPEECH_HINT_MAX = 160
export const PLANNED_ACTION_MAX = 200

export const DEFAULT_ANTAGONIST_SPEECH_REGISTER =
  'clipped · formal · never explains the program · default: one instruction or a counter-question · no public warmth'

const TALK_INTENT_TYPES = new Set([
  'confront',
  'warn',
  'recruit',
  'question',
  'withhold',
  'investigate',
  'inform',
  'support',
  'direct',
  'directive',
  'enforce',
  'phone',
  'ask',
  'interrogate',
])

const SPEECH_VERB =
  /\b(say|says|said|ask|asks|asked|tell|tells|told|speak|speaks|spoke|whisper|whispers|shout|shouts|reply|replies|answer|answers|question|warn|confront)\b/i

export type TalkPlanInput = {
  planned_action: string
  intent?: string | null
  intent_type?: string | null
  speech_hint?: string | null
}

export function capSpeechRegister(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  return trimmed.length > SPEECH_REGISTER_MAX ? trimmed.slice(0, SPEECH_REGISTER_MAX) : trimmed
}

export function sanitizeSpeechHint(raw: string | undefined | null): string | null {
  if (raw == null) return null
  let t = raw.replace(/\s+/g, ' ').trim()
  if (!t) return null
  t = stripDoubleQuotedSpans(t)
  if (!t) return null
  return t.length > SPEECH_HINT_MAX ? t.slice(0, SPEECH_HINT_MAX) : t
}

/** Physical/social move only — drop quoted lines and post-colon speech dumps. */
export function sanitizePlannedAction(raw: string | null | undefined): string {
  let t = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return 'acts without speaking'

  const quoteAt = t.search(/[:—]\s*["“'‘]|["“][A-Z]/)
  if (quoteAt >= 0) t = t.slice(0, quoteAt)

  const dumped = t.match(
    /^(.*?\b(?:say|says|ask|asks|tell|tells|speak|speaks|whisper|whispers|shout|shouts)\b[^:]{0,80}):\s+\S/i,
  )
  if (dumped?.[1]) t = dumped[1]

  t = t.replace(/[\s:;—,\-]+$/g, '').trim()
  if (!t) return 'speaks, then waits'
  return t.length > PLANNED_ACTION_MAX ? t.slice(0, PLANNED_ACTION_MAX) : t
}

export function isTalkShapedPlan(plan: TalkPlanInput): boolean {
  const type = plan.intent_type?.trim().toLowerCase()
  if (type && TALK_INTENT_TYPES.has(type)) return true
  const text = `${plan.planned_action} ${plan.intent ?? ''}`
  return SPEECH_VERB.test(text)
}

export function defaultSpeechHint(speechRegister: string | null | undefined): string {
  const fromRegister = speechRegister?.match(/default(?:\s*move)?:\s*([^·]+)/i)
  const move = fromRegister?.[1]?.trim()
  if (move) {
    return (
      sanitizeSpeechHint(`${move}; then add a clause; not a one-liner`) ??
      'answer then add; a few spoken clauses'
    )
  }
  return 'answer then add; a few spoken clauses; may talk to another NPC'
}

export function finalizeTalkPlan(
  plan: TalkPlanInput,
  speechRegister: string | null | undefined,
): { planned_action: string; speech_hint: string | null } {
  const planned_action = sanitizePlannedAction(plan.planned_action)
  let speech_hint = sanitizeSpeechHint(plan.speech_hint)
  if (isTalkShapedPlan({ ...plan, planned_action }) && !speech_hint) {
    speech_hint = defaultSpeechHint(speechRegister)
  }
  return { planned_action, speech_hint }
}

export function antagonistSpeechRegister(
  authored: string | null | undefined,
): string {
  return capSpeechRegister(authored) ?? DEFAULT_ANTAGONIST_SPEECH_REGISTER
}

/** Deterministic stub register so offline seeds still have distinct voices. */
export function stubSpeechRegisterForRole(role: string): string {
  const key = role.trim().toLowerCase()
  if (/captain|director|commander|abbot|chief/.test(key)) {
    return 'clipped · formal · default: direct instruction · never moralizes'
  }
  if (/medic|doctor|physician|surgeon|corpsman/.test(key)) {
    return 'calm · technical · default: observation then one question · no small talk'
  }
  if (/pilot|helmsman|driver/.test(key)) {
    return 'clipped · restless · default: one joke then the point · never lectures'
  }
  if (/engineer|smith/.test(key)) {
    return 'gruff · concrete · default: one correction · never small talk'
  }
  if (/cook|steward|quartermaster|host|caretaker/.test(key)) {
    return 'warm · practical · default: gentle question or offer · never pushy'
  }
  if (/analyst|scribe|archivist|navigator|science/.test(key)) {
    return 'dry · precise · default: one correction · never small talk'
  }
  return 'spare · concrete · default: one question · never monologues'
}

function stripDoubleQuotedSpans(text: string): string {
  let t = text
  if (/["“][^"”]{8,}["”]/.test(t)) {
    t = t.replace(/["“][^"”]{8,}["”]/g, '').replace(/\s+/g, ' ').trim()
  }
  return t
}

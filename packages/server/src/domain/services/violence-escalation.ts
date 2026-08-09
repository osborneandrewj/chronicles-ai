// Pure violence / superpower escalation suggestions (PR E option a).
// Outputs exact row-target shapes the archivist (or a deterministic merge) can
// apply — never silent DB writes. Prompt text still does the prose work; this
// helper is the testable partner so public multi-kill does not re-lose
// institutional response after a model update.

export type SuggestedThreat = {
  kind: 'threat'
  title: string
  summary: string
  stakes: string
  consequences: string
  status: 'active'
}

export type SuggestedTimelineEvent = {
  title: string
  summary: string
  importance: number
}

export type SuggestedResource = {
  name: string
  kind: string
  detail: string
  held_by_name: 'protagonist'
  salient: true
}

export type ViolenceEscalationSuggestion = {
  threat: SuggestedThreat | null
  timelineEvent: SuggestedTimelineEvent | null
  /** Only for an actual carried condition/object (bloodied cloak, visible wound). */
  resource: SuggestedResource | null
}

export type ViolenceEscalationInput = {
  /** Latest narrator prose (and optionally player text). */
  narration: string
  playerText?: string
  /** Place kind or name cues (agora, forum, senate, market, street, temple…). */
  placeName?: string | null
  placeKind?: string | null
  /** Names of present non-player characters (survivors / witnesses). */
  presentNpcNames?: string[]
  /** True when PLAYER CANON / correction granted superhuman ability this session. */
  hasSuperhumanCanon?: boolean
  /** True when the latest correction or turn is a power grant. */
  isPowerGrant?: boolean
}

const CIVIC_PLACE =
  /\b(agora|forum|senate|market|square|street|temple|basilica|curia|assembly|court|palace|gate|harbour|harbor|port|piraeus)\b/i

// Animate/death language — deliberately avoid "kill the engine", "kill time", etc.
const INERT_KILL =
  /\bkill(?:s|ed|ing)?\s+(?:the\s+)?(?:engine|motor|lights?|power|switch|time|noise|sound|music)\b/gi

const DEATH_CUES =
  /\b(slay(?:s|ed|ing)?|slaughter(?:s|ed|ing)?|murder(?:s|ed|ing)?|cut\s+down|strike(?:s|ing)?\s+down|bodies\b|corpses?\b|\bdie[sd]\b|\bdied\b|\bdeath\b|blood(?:y|ied)?|massacre|falls?\s+dead|lie[s]?\s+dead|left\s+for\s+dead)\b/i

const KILL_PERSON =
  /\bkill(?:s|ed|ing)?\s+(?:him|her|them|both|all|(?:the\s+)?(?:man|men|woman|women|guard|guards|citizen|citizens|senator|senators|soldier|soldiers|merchant|merchants|boy|girl|child|children|enemy|enemies|attacker|attackers|npc|host|hostess|priest|priests))\b/i

const MULTI_KILL =
  /\b(bodies\b|corpses?\b|several\s+(?:men|citizens|guards)|two\s+(?:guards|senators|citizens)|both\s+(?:guards|men|senators)|the\s+(?:guards?|senators?|citizens?)\s+(?:fall|fall dead|lie dead)|mass\s+killing)\b/i

const SUPERHUMAN =
  /\b(superhuman|demigod|godlike|inhuman\s+strength|impossible\s+strength|heals?\s+(?:instantly|immediately)|regenerat|beyond\s+(?:mortal|human)|unnatural\s+strength)\b/i

function isCivicPlace(placeName?: string | null, placeKind?: string | null): boolean {
  const blob = `${placeName ?? ''} ${placeKind ?? ''}`
  return CIVIC_PLACE.test(blob)
}

function hasDeathLanguage(text: string): boolean {
  const cleaned = text.replace(INERT_KILL, ' ')
  return DEATH_CUES.test(cleaned) || KILL_PERSON.test(cleaned)
}

/**
 * Suggest dossier rows when public violence or superhuman power use should
 * produce institutional / social cost. Returns nulls when nothing to escalate.
 */
export function shouldEscalateViolence(
  input: ViolenceEscalationInput,
): ViolenceEscalationSuggestion {
  const text = `${input.playerText ?? ''}\n${input.narration}`
  const civic = isCivicPlace(input.placeName, input.placeKind)
  const death = hasDeathLanguage(text)
  const multi = MULTI_KILL.test(text.replace(INERT_KILL, ' '))
  const power =
    input.isPowerGrant ||
    input.hasSuperhumanCanon ||
    SUPERHUMAN.test(text)

  let threat: SuggestedThreat | null = null
  let timelineEvent: SuggestedTimelineEvent | null = null
  let resource: SuggestedResource | null = null

  if (death && (civic || multi)) {
    const place = input.placeName?.trim() || 'the public square'
    threat = {
      kind: 'threat',
      title: multi ? 'City response to public slaughter' : 'Blood-guilt and civic pursuit',
      summary: multi
        ? `Multiple deaths in ${place} have drawn the city's attention; authorities and kin will answer.`
        : `Violence in ${place} leaves blood-guilt and witnesses; the city will not ignore it.`,
      stakes: 'Arrest, exile, sacred pollution, or faction reprisal closes on the protagonist.',
      consequences: 'Safe passage through civic spaces hardens; informants and guards take interest.',
      status: 'active',
    }
    timelineEvent = {
      title: multi ? 'Public slaughter' : 'Public killing',
      summary: `Violence at ${place} leaves the dead in view of the city.`,
      importance: multi ? 5 : 4,
    }
  } else if (power && (input.isPowerGrant || SUPERHUMAN.test(text))) {
    threat = {
      kind: 'threat',
      title: 'Rumor of unnatural power',
      summary:
        'Word spreads that the protagonist acted beyond mortal strength or healing; fear and sacred alarm follow.',
      stakes: 'Priests, magistrates, or rivals treat the protagonist as a daimon, omen, or weapon.',
      consequences: 'Scrutiny, ritual response, and faction interest replace frictionless power fantasy.',
      status: 'active',
    }
    timelineEvent = {
      title: 'Unnatural feat witnessed',
      summary: 'A superhuman act is seen or rumored; the world begins to answer.',
      importance: 4,
    }
  }

  // Resource only for an actual carried mark/object, not a vague "condition".
  if (
    death &&
    /\b(blood(?:-|\s)?stain(?:ed)?|bloodied\s+cloak|visible\s+wound|cursed\s+mark|scar(?:red)?)\b/i.test(
      text,
    )
  ) {
    resource = {
      name: 'blood-stained cloak',
      kind: 'condition',
      detail: 'Visible mark of recent violence; witnesses and laundry both notice.',
      held_by_name: 'protagonist',
      salient: true,
    }
  } else if (
    power &&
    /\b(cursed\s+mark|brand|glowing\s+scar|unhealing\s+wound)\b/i.test(text)
  ) {
    resource = {
      name: 'mark of unnatural power',
      kind: 'condition',
      detail: 'A lasting personal mark from superhuman use; hard to hide in close company.',
      held_by_name: 'protagonist',
      salient: true,
    }
  }

  return { threat, timelineEvent, resource }
}

type RecentTurn = { role: 'user' | 'assistant'; content: string }

type GuidanceContext = {
  stance: string
  inputMode: string
  playerText: string
  recentTurns: RecentTurn[]
  presentNpcCount: number
  plannedActionCount: number
  worldTime?: string | null
  activeObjectiveTitles?: string[]
  openClueTitles?: string[]
}

export function formatNarratorTurnGuidance(ctx: GuidanceContext): string {
  const lines: string[] = ['## TURN GUIDANCE']

  if (ctx.inputMode !== 'in-character' || ctx.stance === 'meta') {
    lines.push(
      'Brief reply in the narrator voice — keep the fiction in place; do not advance the scene.',
    )
    return lines.join('\n')
  }

  lines.push(
    'Write the next beat with novelistic weight. Trust the fiction to set length and rhythm; vary the shape from recent turns.',
  )

  const beat = pickBeatCue(ctx)
  if (beat) lines.push(beat)

  if (isTimeCheckMove(ctx.playerText)) {
    lines.push(
      `The time-bearing device shows the authoritative world clock exactly: ${ctx.worldTime ?? '(unset)'}.`,
    )
  }

  if (isInvestigativeMove(ctx.playerText)) {
    const objHint = ctx.activeObjectiveTitles?.slice(0, 2).join('; ')
    const clueHint = ctx.openClueTitles?.slice(0, 3).join('; ')
    if (objHint || clueHint) {
      const parts: string[] = []
      if (objHint) parts.push(`objectives: ${objHint}`)
      if (clueHint) parts.push(`clues: ${clueHint}`)
      lines.push(`Dossier pressure if it fits — ${parts.join(' | ')}.`)
    }
  }

  const continuity = pickContinuityNudge(ctx.recentTurns)
  if (continuity) lines.push(continuity)

  if (needsBranch(ctx)) {
    lines.push('Leave at least one branch the player can pursue.')
  }

  return lines.join('\n')
}

function pickBeatCue(ctx: GuidanceContext): string | null {
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
  if (isDangerMove(text) || isTransitionMove(text)) {
    return 'Let the beat breathe — arrival, danger, or consequence can reveal layout, cost, witness, texture, or choice.'
  }
  if (isMediaFeedMove(text)) {
    return 'This is a public information surface — put specific diegetic content on it; at least one concrete wider-world item that could recur.'
  }
  if (isInvestigativeMove(text)) {
    return 'The player is trying to learn something — return a concrete result, partial match, contradiction, named obstacle, or new lead.'
  }
  if (ctx.stance === 'observe' || isAttentionOnlyMove(text)) {
    return 'Observation should reveal a new handle: a detail, offer, threat, contradiction, interruption, or lead.'
  }
  if (ctx.stance === 'say') {
    const language = detectMarkedSpokenLanguage(text)
    if (language) {
      return `Let audible dialogue be audible — write the words someone answers with, not a summary. The player marked their speech as ${language}; a light romanized touch keeps it audible while the meaning stays clear in English.`
    }
    return 'Let audible dialogue be audible — write the words someone answers with, not a summary.'
  }
  return null
}

function pickContinuityNudge(turns: RecentTurn[]): string | null {
  const anchors = repeatedAmbientAnchors(turns)
  if (anchors.length > 0) {
    const list = joinList(anchors)
    return `Recent narration has leaned on ${list} as an ambient closer — return to ${list} only if it changes, becomes evidence, or the protagonist interacts with it.`
  }
  if (recentNarrationIsStalled(turns) || recentNarrationUsesSameShortShape(turns)) {
    return 'Recent narration is repeating its architecture. Change the shape — start in motion, lead with consequence, add dialogue, advance time, or land on a concrete new choice.'
  }
  return null
}

function needsBranch(ctx: GuidanceContext): boolean {
  if (ctx.stance === 'say' || ctx.stance === 'observe') return true
  const text = ctx.playerText
  return (
    isAttentionOnlyMove(text) ||
    isInvestigativeMove(text) ||
    isMediaFeedMove(text) ||
    isTransitionMove(text) ||
    isDangerMove(text) ||
    isSpectacleMove(text) ||
    isChargedConfrontationMove(text)
  )
}

function isAttentionOnlyMove(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
  return /\b(i )?(look|stare|glance|watch|listen)\b/.test(compact) && compact.length <= 90
}

function isInvestigativeMove(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const hasAnalysisVerb =
    /\b(pattern match|match|scan|analy[sz]e|identify|inspect|examine|read|check|search|compare|diagnose|translate|decode|look up|trace|sample)\b/.test(
      compact,
    )
  const hasQuestion = /\b(what|who|where|when|why|how|which)\b|\?/.test(compact)
  const targetsToolOrInquiry =
    /\b(vox|auspex|cogitator|scanner|sensor|reader|servo|computer|database|archive|records?)\b/.test(
      compact,
    ) || hasQuestion

  return hasAnalysisVerb && targetsToolOrInquiry
}

function isTimeCheckMove(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const hasCheckVerb = /\b(check|look at|look|glance at|read|consult|see|inspect)\b/.test(compact)
  const hasTimeQuestion = /\bwhat time\b|\btime is it\b|\bcurrent time\b/.test(compact)
  const hasTimeDevice =
    /\b(watch|wristwatch|phone|cell|mobile|smartphone|clock|wall clock|alarm clock|dashboard clock|car clock|computer clock|laptop|terminal|display|screen)\b/.test(
      compact,
    )
  return hasTimeQuestion || (hasCheckVerb && hasTimeDevice && /\btime|clock|watch|phone\b/.test(compact))
}

function isMediaFeedMove(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const hasOpenOrCheckVerb =
    /\b(open|opens|check|checks|look at|looks at|look through|scroll|scrolls|read|reads|watch|watches|listen|listens|turn on|turns on|browse|browses|refresh|refreshes)\b/.test(
      compact,
    )
  const hasMediaSurface =
    /\b(x|twitter|feed|timeline|social media|news|headlines?|tv|television|radio|podcast|browser|web|internet|notifications?|alerts?|email|inbox|screen|phone)\b/.test(
      compact,
    )

  return hasOpenOrCheckVerb && hasMediaSurface
}

function isTransitionMove(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
  return /\b(go|goes|walk|walks|run|runs|head|heads|travel|travels|cross|crosses|enter|enters|leave|leaves|return|returns|approach|approaches|make my way|move|moves|climb|climbs|drive|drives)\b/.test(
    compact,
  )
}

function isDangerMove(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
  return /\b(explosion|blast|crater|blood|corpse|dead|wound|weapon|gun|knife|attack|threat|danger|fire|smoke|scream|alarm|soldier|body)\b/.test(
    compact,
  )
}

function isSpectacleMove(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const hasPowerVerb =
    /\b(crush|crumple|fold|tear|rip|burst|explode|ignite|burn|shatter|collapse|detonate|blast|throw|hurl|levitate|lift|split|peel|melt)\b/.test(
      compact,
    )
  const hasSpectacleObject =
    /\b(car|cars|cruiser|cruisers|squad car|truck|building|wall|door|bulkhead|ship|tower|bridge|body|bodies|dragon|spell|ward|reactor|engine|weapon|blade|gun|flame|fire|lightning|vacuum)\b/.test(
      compact,
    )
  const repeatsSpectacle = /\b(do the same|same thing|again|one by one)\b/.test(compact)
  return (hasPowerVerb && hasSpectacleObject) || (repeatsSpectacle && hasSpectacleObject)
}

function isChargedRecognitionMove(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
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
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const hasDialogue = /["“][^"”]{2,}["”]/.test(text)
  const hasPressureVerb =
    /\b(command|threaten|warn|demand|interrogate|accuse|confront|approach|smile|bring me|if you value your life|not being honest|lie|lying|answer me)\b/.test(
      compact,
    )
  return hasDialogue && hasPressureVerb
}

function detectMarkedSpokenLanguage(text: string): string | null {
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const match = compact.match(
    /\b(?:speak|say|ask|answer|reply|call|whisper|shout|tell|murmur|mutter)s?\s+(?:to\s+\w+\s+)?in\s+(russian|spanish|french|german|italian|japanese|mandarin|cantonese|korean|arabic|hindi|latin)\b/,
  )
  if (!match) return null

  const language = match[1]
  return language.charAt(0).toUpperCase() + language.slice(1)
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
  ]

  return anchors
    .filter((anchor) => {
      const pattern = new RegExp(`\\b(?:${anchor.terms.map(escapeRegExp).join('|')})\\b`, 'i')
      return recentAssistantEndings.filter((ending) => pattern.test(ending)).length >= 2
    })
    .map((anchor) => anchor.label)
    .slice(0, 3)
}

function recentNarrationUsesSameShortShape(turns: RecentTurn[]): boolean {
  const recentAssistant = turns
    .filter((t) => t.role === 'assistant')
    .slice(-3)
    .map((t) => t.content)

  if (recentAssistant.length < 2) return false

  const shaped = recentAssistant.map((text) => ({
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length,
    startsWithYou: /^\s*(?:"[^"]+"\s*)?you\b/i.test(text),
    mentionsTool:
      /\b(vox|auspex|scanner|sensor|cogitator|servo|beam|query|pulse|scan)\b/i.test(text),
    short: text.length < 900,
  }))

  return shaped.every(
    (s) => s.short && s.paragraphs === 2 && s.startsWithYou && s.mentionsTool,
  )
}

function isReactionOnlyNarration(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, ' ').trim()
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

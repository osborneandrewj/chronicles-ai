// Consecutive low-agency player moves before the narrator should make the world
// act on its own (escalating momentum). Tunable.
const MOMENTUM_IDLE_THRESHOLD = 2

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
  activeThreatTitles?: string[]
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
      lines.push(
        `Internal pressure only — do not name these to the player, never list them, never present them as goals or options; let at most one bend the scene through action or subtext if it fits naturally — ${parts.join(' | ')}.`,
      )
    }
  }

  const continuity = pickContinuityNudge(ctx.recentTurns)
  if (continuity) lines.push(continuity)

  const momentum = pickMomentumCue(ctx)
  if (momentum) lines.push(momentum)
  else {
    // Engagement is the softer tier-1 push below the L2 intrusion threshold, so
    // it only fires when the L2 momentum cue did not (mutually exclusive).
    const engagement = pickEngagementCue(ctx)
    if (engagement) lines.push(engagement)
  }

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
    return (
      'The protagonist is taking in the scene — render the surroundings in depth: lead with concrete, ' +
      'multi-sensory specifics (light, sound, smell, temperature, terrain, distances, the people and ' +
      'their bearing) so the world feels inhabited and particular, then surface at least one new handle ' +
      '(a detail, offer, threat, contradiction, or lead). This is an establishing beat in the ' +
      'medium-to-long band — do not answer a look-around with two or three sentences. If the scene was ' +
      'already painted this richly on a recent turn, vary the focus or advance something rather than ' +
      'repeating the same survey.'
    )
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

function isLowAgencyMove(text: string): boolean {
  const compact = normalize(text)
  // Short observation / waiting / bare continuation — the player is marking time.
  if (isAttentionOnlyMove(text)) return true
  return (
    compact.length <= 40 &&
    /\b(wait|waits|continue|continues|keep going|carry on|stay|stand|listen|nothing|hold|pause|rest)\b/.test(
      compact,
    )
  )
}

function countTrailingIdleMoves(ctx: GuidanceContext): number {
  // Current move + trailing player moves, newest-first, until a driving move.
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

function pickMomentumCue(ctx: GuidanceContext): string | null {
  // When the NPC agent already supplied planned moves, those ARE this turn's
  // intrusion (the narrator MUST stage them) — don't also tell it to invent a
  // separate "world acts" intrusion, which would collide with the "one intrusion
  // only" cap and tempt it to drop a planned move.
  if (ctx.plannedActionCount > 0) return null
  const idle = countTrailingIdleMoves(ctx)
  if (idle < MOMENTUM_IDLE_THRESHOLD) return null
  const threat = ctx.activeThreatTitles?.[0]
  const pressure = threat
    ? ` Draw the pressure from the active threat "${threat}".`
    : ''
  return (
    'The player is marking time — the world acts: make something happen TO the protagonist this ' +
    'turn that they did not initiate (an NPC pursues its goal, a threat closes, time bites, a new ' +
    'element enters). Create a situation, not a forced choice; do not decide the protagonist’s ' +
    'actions or feelings; one intrusion only.' +
    pressure
  )
}

// Tier-1 push, softer than the L2 "world acts" intrusion: on a single idle move
// with a present NPC and no NPC action already planned this turn, license a
// present character to take the initiative and press the protagonist directly.
// Gated below MOMENTUM_IDLE_THRESHOLD so it never overlaps the L2 cue, on
// plannedActionCount === 0 (a planned move already puts a character in motion),
// and skipped on the opening beat (no prior turns) so an establishing turn is
// not pre-empted.
function pickEngagementCue(ctx: GuidanceContext): string | null {
  if (ctx.presentNpcCount < 1) return null
  if (ctx.plannedActionCount > 0) return null
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

// The dominant repetition failure (prod world 12): the narrator re-renders the
// previous turn's opening sentence, per-character status lines, and ambient
// closer almost verbatim, varying only the central action beat. Token-Jaccard
// over the last two narrator turns catches this directly — the older
// keyword/shape detectors miss it because the overlap is lexical, not a fixed
// noun or a 2-paragraph shape. Thresholds are tuned high (real restatement
// scores open≈1.0 / body≈0.78 / tail≈0.84; genuinely varied turns score <0.25)
// so legitimate same-place continuation does not trip it.
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
    // Period / cross-genre ambient anchors (genre-coupling audit) so repeated
    // closers are caught outside the modern/temperate default set.
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

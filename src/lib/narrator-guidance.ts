type RecentTurn = { role: 'user' | 'assistant'; content: string }

type GuidanceContext = {
  stance: string
  inputMode: string
  playerText: string
  recentTurns: RecentTurn[]
  presentNpcCount: number
  plannedActionCount: number
  activeObjectiveTitles?: string[]
  openClueTitles?: string[]
}

export function formatNarratorTurnGuidance(ctx: GuidanceContext): string {
  const attentionOnlyMove = isAttentionOnlyMove(ctx.playerText)
  const investigativeMove = isInvestigativeMove(ctx.playerText)
  const transitionMove = isTransitionMove(ctx.playerText)
  const dangerMove = isDangerMove(ctx.playerText)
  const stalled = recentNarrationIsStalled(ctx.recentTurns)
  const repeatedAnchors = repeatedAmbientAnchors(ctx.recentTurns)
  const repeatedStructure = recentNarrationUsesSameShortShape(ctx.recentTurns)
  const lines = [
    '## TURN GUIDANCE',
    'Make the player move legible without copying the input shape. Stage direction becomes prose; dialogue may remain dialogue.',
  ]

  if (ctx.inputMode !== 'in-character' || ctx.stance === 'meta') {
    lines.push('This is not an in-character scene beat; keep it brief and do not advance the fiction.')
    return lines.join('\n')
  }

  if (ctx.stance === 'say') {
    lines.push(
      'If a present character answers, render their actual spoken words. Do not summarize an answer as "he replies in the same language" or "the words are measured."',
    )
  }

  if (ctx.stance === 'observe' || attentionOnlyMove) {
    lines.push(
      'Observation is a chance for the world to reveal something new. Do not only list who looks back; add a concrete detail, choice, offer, threat, interruption, or lead.',
    )
  }

  if (investigativeMove) {
    const objectiveHint = ctx.activeObjectiveTitles?.slice(0, 2).join('; ')
    const clueHint = ctx.openClueTitles?.slice(0, 3).join('; ')
    lines.push(
      'The player is trying to learn something. Resolve the attempt with a concrete result, partial match, contradiction, or named obstacle; do not spend the turn only showing scanning, processing, tones, lights, or waiting.',
    )
    if (objectiveHint || clueHint) {
      lines.push(
        `Use dossier pressure for the result when it fits: ${[
          objectiveHint ? `objectives: ${objectiveHint}` : null,
          clueHint ? `clues: ${clueHint}` : null,
        ]
          .filter(Boolean)
          .join(' | ')}.`,
      )
    }
  }

  if (transitionMove || dangerMove) {
    lines.push(
      'This is a movement, transition, danger, or consequence beat. Let it breathe if the fiction warrants it: arrival can reveal a new layout, obstacle, witness, cost, or immediate choice.',
    )
  }

  const socialBeatNeedsPressure =
    ctx.stance === 'say' || ctx.stance === 'observe' || attentionOnlyMove || investigativeMove || transitionMove || dangerMove || stalled

  if (ctx.presentNpcCount > 0 && ctx.plannedActionCount === 0 && socialBeatNeedsPressure) {
    lines.push(
      'At least one present NPC should behave like a person with a day of their own: answer specifically, ask a loaded counter-question, make an offer, withhold something, leave, arrive, call someone, or reveal pressure from outside the room.',
    )
  }

  if (stalled || repeatedStructure) {
    lines.push(
      'Recent narration has fallen into a repeated short architecture. Break the shape this turn: start in motion, compress the obvious move into a clause, let the consequence lead, add dialogue, advance time, or end on a concrete new choice.',
    )
  }

  if (repeatedAnchors.length > 0) {
    lines.push(
      `Recent narration has leaned on ${joinList(repeatedAnchors)} as an ambient closer. Do not mention ${joinList(
        repeatedAnchors,
      )} again unless it materially changes, becomes evidence, or the protagonist actively interacts with it.`,
    )
  }

  if (socialBeatNeedsPressure) {
    lines.push(
      'A good quiet turn leaves at least one branch the player can pursue: a named person, a concrete place, a rumor, a demand, a debt, a danger, a contradiction, or a door that just opened.',
    )
  }

  return lines.join('\n')
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

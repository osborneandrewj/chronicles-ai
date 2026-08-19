// Detect an NPC restaging the same presence/comfort beat after it already
// landed. Pure — no I/O. Used by the NPC agent (do not replan) and narrator
// guidance (do not reuse the line).

export type PlanOutcomeForLoop = {
  planned_action: string
  narrator_disposition: string | null
  intent_type?: string | null
}

const LANDED = new Set(['staged', 'modified'])

const PRESENCE_MOVE =
  /\b(glass|window|palm|ledge|presence|witness|watching|remain(?:s|ed)?|stay(?:s|ing)?|barrier|observation|i(?:['’]m| am) here)\b/i

const PRESENCE_LINE =
  /\bi(?:['’]m| am)\s+(?:still\s+|right\s+)*(?:here|watching|staying)\b/i

export function repeatedStagedPlanCue(outcomes: PlanOutcomeForLoop[]): string | null {
  const landed = outcomes
    .filter((o) => o.narrator_disposition != null && LANDED.has(o.narrator_disposition))
    .slice(-3)
  if (landed.length < 2) return null

  const presenceHits = landed.filter((o) => PRESENCE_MOVE.test(o.planned_action))
  const similar = pairwiseOverlap(landed) >= 0.4
  if (presenceHits.length < 2 && !similar) return null

  return (
    'PLAN LOOP: your last plans already landed. Do not restage presence, palm-on-glass, watching, or "I\'m here". ' +
    'Pick a different move — new information, a choice, talk to another NPC, leave, or act on your own goal.'
  )
}

export function repeatedSpokenLineCue(assistantTurns: string[]): string | null {
  const recent = assistantTurns.slice(-4)
  if (recent.length < 2) return null
  const hits = recent.filter((t) => PRESENCE_LINE.test(t))
  if (hits.length < 2) return null
  const sample = firstPresenceQuote(hits[hits.length - 1]) ?? "I'm here"
  return (
    `Do not reuse this NPC comfort-presence line: "${sample}". They already said it. ` +
    'Recede the gesture. Give them a new beat — information, a choice, talk to someone else, or silence.'
  )
}

function pairwiseOverlap(rows: PlanOutcomeForLoop[]): number {
  let best = 0
  for (let i = 0; i < rows.length; i++) {
    const a = tokens(rows[i].planned_action)
    for (let j = i + 1; j < rows.length; j++) {
      best = Math.max(best, jaccard(a, tokens(rows[j].planned_action)))
    }
  }
  return best
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z']{3,}/g) ?? [])
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let n = 0
  for (const t of a) if (b.has(t)) n += 1
  return n / (a.size + b.size - n)
}

function firstPresenceQuote(text: string): string | null {
  const re = /[“"]([^”"]{4,80})[”"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (PRESENCE_LINE.test(m[1])) return m[1].trim()
  }
  return null
}

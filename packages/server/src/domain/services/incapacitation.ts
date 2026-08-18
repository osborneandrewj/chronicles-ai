// Pure. Detects when the protagonist cannot act — unconscious, seized,
// restrained, sedated, or explicitly staying under. Scene-agnostic: no
// medical-table / facility assumptions. No I/O.

export type AgencyLockState = {
  /** Player text this turn authors a collapse or restraint. */
  collapsingThisTurn: boolean
  /** They cannot act this turn (persisted lock or live detection). */
  locked: boolean
  /** Player asked to remain unable to act (don't wake / don't respond). */
  stayUnder: boolean
  /** Locked and not staying under: world advances and agency returns. */
  restoreAgency: boolean
}

/** Player authors going under or being rendered unable to act. */
const AUTHOR_LOCK =
  /\b(i|i'm|i am)\s+(pass(?:e[sd])? out|lose consciousness|lost consciousness|fade(?:s|d)? out(?: of consciousness)?|black(?:ing)? out|faint(?:ed|ing)?|go(?:ing)? under|go limp|black out|get knocked out|cannot move|can't move|can't speak)\b/i

const AUTHOR_RESTRAINT =
  /\b(i am|i'm|they|he|she)\s+(bound|gagged|tied|pinned|restrained|paralyzed|sedated|drugged)\b/i

/** Prior prose still has them unable to act. Unicode apostrophes included. */
const PROSE_LOCK =
  /\b(lose[s]? consciousness|lost consciousness|pass(?:es|ed)? out|blackness rushes|fade[sd]? into blackness|eyes roll(?:ed)? back|he['’]?s out|she['’]?s out|slack in (?:your|his|her) limbs|unconscious|(?:is|are|remains?|stays?)\s+unresponsive|knocked out|still under|stays under|does(?: not|n't) wake|bound|gagged|tied down|restrained|paralyzed|cannot move|can't move|if you['’]?re surfacing)\b/i

const STAY_UNDER =
  /\b(don['’]?t wake|do not wake|not wake yet|stay (?:out|under|unconscious)|remain (?:out|unconscious)|don['’]?t respond|do not respond|i don't respond)\b/i

export function resolveAgencyLock(input: {
  playerText: string
  recentAssistantText: string | null
  persistedLocked?: boolean
}): AgencyLockState {
  const text = input.playerText.trim()
  const collapsingThisTurn =
    AUTHOR_LOCK.test(text) || AUTHOR_RESTRAINT.test(text)
  const stayUnder = STAY_UNDER.test(text)
  const alreadyOut = Boolean(
    input.recentAssistantText && PROSE_LOCK.test(input.recentAssistantText),
  )
  const locked =
    collapsingThisTurn ||
    stayUnder ||
    alreadyOut ||
    input.persistedLocked === true
  const restoreAgency = locked && !collapsingThisTurn && !stayUnder
  return { collapsingThisTurn, locked, stayUnder, restoreAgency }
}

export function isBareContinue(text: string): boolean {
  const t = text.trim().toLowerCase()
  return (
    t === 'continue' ||
    t === 'go on' ||
    t === 'keep going' ||
    t === '...' ||
    t === '…'
  )
}

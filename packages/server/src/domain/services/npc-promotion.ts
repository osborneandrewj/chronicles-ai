// Pure domain service (P4, spec §5.1-P4 item 4): the deciding tiering RULES for
// NPC promotion/demotion. No I/O — every function takes loaded values and
// returns a verdict (transient-or-not, the next agency tier from a turn gap).
// The transaction-issuing orchestrator `recordAppearancesAndAutoPromote` stays
// in lib/npc-promotion.ts for now and calls these rules; the full "decide tiers
// from a snapshot → return write commands the use case applies" carve is
// deferred (the tier decision is interleaved with per-character UPDATEs).
//
// Extracted verbatim from lib/npc-promotion.ts (no behavior change); the
// npc-promotion.test.ts characterization tests cover the outcomes.
import type { CharacterAgencyLevel } from '@/domain/entities'

// An NPC becomes agent-tier after this many distinct turns in scene with the
// protagonist. Three is enough to filter out one-shot walk-ons (the bartender
// who pours one drink) while catching recurring characters.
export const AUTO_PROMOTE_THRESHOLD = 3

// The agency ladder over the turn gap since an off-scene NPC was last seen. An
// NPC with an open thread (active_goal / personal_goals / current_focus) decays
// more slowly. Pure: takes the gap and the open-thread flag, returns the tier.
export function nextAgencyTier(turnsAway: number, hasOpenThread: boolean): CharacterAgencyLevel {
  if (turnsAway <= 3) return 'nearby'
  if (turnsAway <= 10) return 'distant'
  if (turnsAway <= 20 || (hasOpenThread && turnsAway <= 40)) return 'dormant'
  return 'npc'
}

// A walk-on service role (mail carrier, cashier, barista, …) with no durable
// story signal in its goals. These are demoted back to plain `npc` rather than
// auto-promoted, so a one-drink bartender never becomes an agent NPC. Returns
// false the moment a durable signal (threat / follow / secret / named antagonist
// / relationship) appears in the durable fields — then it is a real character.
export function isTransientServiceNpc(c: {
  name: string
  description: string | null
  active_goal?: string | null
  personal_goals?: string | null
  current_focus?: string | null
}): boolean {
  const text = `${c.name} ${c.description ?? ''}`.toLowerCase()
  const serviceRole =
    /\b(usps|postal|mail carrier|mailman|mailwoman|courier|delivery driver|package driver|parcel carrier|fedex|ups|doordash|rideshare|taxi driver|cashier|receptionist|clerk|server|barista)\b/.test(
      text,
    )

  if (!serviceRole) return false

  const durableSignals = `${c.personal_goals ?? ''} ${c.current_focus ?? ''} ${c.active_goal ?? ''}`.toLowerCase()
  return !/\b(minerva|black cloak|caesar|threat|follow|stalk|watch|spy|warn|secret|conspiracy|murder|missing|romance|debt|promise|protect|investigate)\b/.test(
    durableSignals,
  )
}

// Settled findings beat leftover pressure. When a thread/objective/clue is
// done, sibling intake threads and NPC focus that still talk about that work
// must not restage it. Pure — no I/O.

import type { Character, StoryClue, StoryObjective, StoryThread } from '@/domain/entities'

const STOP = new Set([
  'about',
  'after',
  'assignment',
  'before',
  'from',
  'into',
  'newly',
  'that',
  'their',
  'there',
  'this',
  'unexplained',
  'with',
])

const OPEN_WORK =
  /\b(request|submit|obtain|retrieve|pending|file|filing|pull|wait(?:ing)?|need(?:s|ed)?|not yet|uncleared|not cleared|records?)\b/i

const LIVE_WORK =
  /\b(latin|collapse|collapsed|transfer|monitor|chart|episode|seizure|airway|pulse|cot|crash|emergency|leads?)\b/i

export type SettledAnchor = { title: string; detail: string | null }

export type NpcFocusWrite = {
  characterId: number
  current_focus?: string
  last_known_situation?: string
  active_goal?: string
}

export function collectSettledAnchors(input: {
  threads: Pick<StoryThread, 'title' | 'status' | 'summary'>[]
  objectives: Pick<StoryObjective, 'title' | 'status' | 'detail'>[]
  clues?: Pick<StoryClue, 'title' | 'status' | 'detail'>[]
}): SettledAnchor[] {
  const anchors: SettledAnchor[] = []
  for (const o of input.objectives) {
    if (o.status === 'completed' || o.status === 'failed') {
      anchors.push({ title: o.title, detail: o.detail })
    }
  }
  for (const t of input.threads) {
    if (t.status === 'resolved' || t.status === 'failed') {
      anchors.push({ title: t.title, detail: t.summary })
    }
  }
  for (const c of input.clues ?? []) {
    if (c.status === 'interpreted' || c.status === 'spent') {
      anchors.push({ title: c.title, detail: c.detail })
    }
  }
  return anchors
}

export function isSettledLeftoverThread(
  thread: Pick<StoryThread, 'id' | 'title' | 'status'>,
  allThreads: Pick<StoryThread, 'id' | 'title' | 'status'>[],
  objectives: Array<
    Pick<StoryObjective, 'status'> & {
      thread_id?: number | null
      thread_title?: string | null
    }
  >,
): boolean {
  if (thread.status !== 'active') return false
  const children = objectives.filter(
    (o) =>
      o.thread_id === thread.id ||
      (o.thread_title != null &&
        o.thread_title.trim().toLowerCase() === thread.title.trim().toLowerCase()),
  )
  if (children.some((o) => o.status === 'active' || o.status === 'blocked')) {
    return false
  }
  return allThreads.some((other) => {
    if (other.id === thread.id) return false
    const closed =
      other.status === 'resolved' ||
      other.status === 'failed' ||
      other.status === 'dormant'
    if (!closed) return false
    return (
      titlesAreSameThread(thread.title, other.title) ||
      shareDistinctiveToken(thread.title, other.title)
    )
  })
}

export function canonicalizeThreadTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function titlesAreSameThread(a: string, b: string): boolean {
  return canonicalizeThreadTitle(a) === canonicalizeThreadTitle(b)
}

export function planNpcFocusHygiene(
  npcs: Array<
    Pick<Character, 'id' | 'is_player' | 'current_focus' | 'active_goal'> & {
      last_known_situation?: string | null
    }
  >,
  anchors: SettledAnchor[],
): NpcFocusWrite[] {
  if (anchors.length === 0) return []
  const writes: NpcFocusWrite[] = []
  for (const npc of npcs) {
    if (npc.is_player === 1) continue
    const write: NpcFocusWrite = { characterId: npc.id }
    const focusHit = contradictingAnchor(npc.current_focus, anchors)
    if (focusHit) write.current_focus = `Settled — ${focusHit.title}.`
    const goalHit = contradictingAnchor(npc.active_goal, anchors)
    if (goalHit) write.active_goal = `Settled — ${goalHit.title}.`
    if (write.current_focus || write.active_goal) {
      writes.push(write)
    }
  }
  return writes
}

function contradictingAnchor(
  text: string | null | undefined,
  anchors: SettledAnchor[],
): SettledAnchor | null {
  if (!text) return null
  if (LIVE_WORK.test(text)) return null
  if (!OPEN_WORK.test(text)) return null
  for (const anchor of anchors) {
    const hay = `${anchor.title} ${anchor.detail ?? ''}`
    if (shareDistinctiveToken(text, hay)) return anchor
  }
  return null
}

export function shareDistinctiveToken(a: string, b: string): boolean {
  const ta = distinctiveTokens(a)
  if (ta.size === 0) return false
  for (const w of distinctiveTokens(b)) {
    if (ta.has(w)) return true
  }
  return false
}

function distinctiveTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 5 && !STOP.has(w)) out.add(w)
  }
  return out
}

export function applySettledFindingsToSnapshot<
  T extends {
    knownCharacters: Character[]
    presentCharacters: Character[]
    dossier: { threads: StoryThread[]; objectives: StoryObjective[]; clues: StoryClue[] }
  },
>(state: T): {
  next: T
  focusWrites: NpcFocusWrite[]
  dormantThreadIds: number[]
} {
  const anchors = collectSettledAnchors(state.dossier)
  const dormantThreadIds = state.dossier.threads
    .filter((t) => isSettledLeftoverThread(t, state.dossier.threads, state.dossier.objectives))
    .map((t) => t.id)
  const focusWrites = planNpcFocusHygiene(state.knownCharacters, anchors)
  if (dormantThreadIds.length === 0 && focusWrites.length === 0) {
    return { next: state, focusWrites, dormantThreadIds }
  }

  const focusById = new Map(focusWrites.map((w) => [w.characterId, w]))
  const patchChar = (c: Character): Character => {
    const w = focusById.get(c.id)
    if (!w) return c
    return {
      ...c,
      current_focus: w.current_focus ?? c.current_focus,
      last_known_situation: w.last_known_situation ?? c.last_known_situation,
      active_goal: w.active_goal ?? c.active_goal,
    }
  }
  const dormant = new Set(dormantThreadIds)
  return {
    next: {
      ...state,
      knownCharacters: state.knownCharacters.map(patchChar),
      presentCharacters: state.presentCharacters.map(patchChar),
      dossier: {
        ...state.dossier,
        threads: state.dossier.threads.map((t) =>
          dormant.has(t.id) ? { ...t, status: 'dormant' } : t,
        ),
      },
    },
    focusWrites,
    dormantThreadIds,
  }
}

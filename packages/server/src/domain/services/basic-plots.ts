// Christopher Booker's seven basic plots (The Seven Basic Plots, 2004).
// Used when *authoring* story threads — world-gen and bootstrap — not as a
// director beat enum. A world may mix shapes. Do not require all seven.

export type BasicPlotId =
  | 'overcoming_the_monster'
  | 'rags_to_riches'
  | 'the_quest'
  | 'voyage_and_return'
  | 'comedy'
  | 'tragedy'
  | 'rebirth'

export type BasicPlot = {
  id: BasicPlotId
  name: string
  /** One-line definition for prompts and seeders. */
  definition: string
  defaultKind: 'quest' | 'mystery' | 'threat' | 'relationship'
}

export const BASIC_PLOTS: readonly BasicPlot[] = [
  {
    id: 'overcoming_the_monster',
    name: 'Overcoming the Monster',
    definition:
      'The protagonist must defeat an antagonistic force that threatens them or their home.',
    defaultKind: 'threat',
  },
  {
    id: 'rags_to_riches',
    name: 'Rags to Riches',
    definition:
      'Someone overlooked gains standing or a place, loses it, and must earn it back as a changed person.',
    defaultKind: 'quest',
  },
  {
    id: 'the_quest',
    name: 'The Quest',
    definition:
      'The protagonist and companions set out to reach a place or obtain something, facing obstacles on the way.',
    defaultKind: 'quest',
  },
  {
    id: 'voyage_and_return',
    name: 'Voyage and Return',
    definition:
      'The protagonist enters a strange situation, is changed by it, and must come back with what they learned.',
    defaultKind: 'mystery',
  },
  {
    id: 'comedy',
    name: 'Comedy',
    definition:
      'Confusion and crossed purposes thicken until a clarifying event makes the true relations plain (not merely jokes).',
    defaultKind: 'relationship',
  },
  {
    id: 'tragedy',
    name: 'Tragedy',
    definition:
      'A capable person is undone by a flaw or a choice; the cost should evoke pity, not a procedure loop.',
    defaultKind: 'threat',
  },
  {
    id: 'rebirth',
    name: 'Rebirth',
    definition:
      'An event forces the protagonist to change who they are or what they serve.',
    defaultKind: 'mystery',
  },
] as const

export function getBasicPlot(id: string): BasicPlot | undefined {
  return BASIC_PLOTS.find((p) => p.id === id)
}

/** Deterministic distinct shapes for opening threads. */
export function pickSeedPlotShapes(seed: number, count = 3): BasicPlot[] {
  const n = Math.min(Math.max(1, count), BASIC_PLOTS.length)
  const order = [...BASIC_PLOTS]
  let s = Math.abs(Math.trunc(seed)) || 1
  for (let i = order.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const j = s % (i + 1)
    const tmp = order[i]!
    order[i] = order[j]!
    order[j] = tmp
  }
  return order.slice(0, n)
}

const SOMATIC =
  /\b(tremor|clawing|numbness|spasm|vitals|baseline|blood[- ]pressure|intake exam|medical hold|mapping (the )?(facility )?tremor|clawing arm)\b/i

export type ThreadLike = {
  title: string
  summary?: string | null
  stakes?: string | null
  kind?: string | null
}

/** Repeating medical/procedure pressure — not a season arc. */
export function isSomaticProcedureThread(thread: ThreadLike): boolean {
  const blob = `${thread.title} ${thread.summary ?? ''} ${thread.stakes ?? ''}`
  return SOMATIC.test(blob)
}

/**
 * A new somatic threat must not steal the floor from a real mystery/quest.
 * Existing rows are unchanged (updates still apply).
 */
export function resolveNewThreadKind(
  incoming: ThreadLike & { kind?: string | null },
  existing: Array<ThreadLike & { status?: string | null }>,
): string {
  const kind = incoming.kind?.trim() || 'mystery'
  if (kind !== 'threat') return kind
  if (!isSomaticProcedureThread(incoming)) return kind
  const hasArc = existing.some(
    (t) =>
      (t.status == null || t.status === 'active') &&
      !isSomaticProcedureThread(t) &&
      (t.kind === 'mystery' || t.kind === 'quest' || t.kind === 'relationship'),
  )
  return hasArc ? 'background' : kind
}

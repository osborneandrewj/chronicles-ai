// Pure PlayerModel compaction + deterministic refresh from reports / exits.
// No I/O.

import type { ExitKind } from '@/domain/services/sim-run-report'
import type { PlayerModel, SimRunReport } from '@/domain/entities'

export const PLAYER_MODEL_CAPS = {
  tactics: 4,
  softSpots: 3,
  tells: 3,
  openGoals: 3,
  stanceChars: 120,
  antagonistBeliefs: 3,
  tokenBudget: 250,
} as const

function clip(text: string, max: number): string {
  const c = text.replace(/\s+/g, ' ').trim()
  if (c.length <= max) return c
  return `${c.slice(0, max - 1).trimEnd()}…`
}

function uniqCap(items: string[], max: number, chars = 80): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const s = clip(raw, chars)
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

export function emptyPlayerModel(hubWorldId: number, updatedAt: string): PlayerModel {
  return {
    hub_world_id: hubWorldId,
    tactics: [],
    soft_spots: [],
    tells: [],
    open_goals: [],
    stance_toward_program: 'unknown',
    antagonist_beliefs: [],
    updated_at: updatedAt,
  }
}

export function compactPlayerModel(model: PlayerModel): PlayerModel {
  return {
    hub_world_id: model.hub_world_id,
    tactics: uniqCap(model.tactics, PLAYER_MODEL_CAPS.tactics),
    soft_spots: uniqCap(model.soft_spots, PLAYER_MODEL_CAPS.softSpots),
    tells: uniqCap(model.tells, PLAYER_MODEL_CAPS.tells),
    open_goals: uniqCap(model.open_goals, PLAYER_MODEL_CAPS.openGoals),
    stance_toward_program: clip(model.stance_toward_program || 'unknown', PLAYER_MODEL_CAPS.stanceChars),
    antagonist_beliefs: uniqCap(
      model.antagonist_beliefs,
      PLAYER_MODEL_CAPS.antagonistBeliefs,
    ),
    updated_at: model.updated_at,
  }
}

export function formatPlayerModelBlock(model: PlayerModel): string {
  const m = compactPlayerModel(model)
  const lines = [
    '## Player model (antagonist intel — may be incomplete or wrong)',
    `- Stance: ${m.stance_toward_program}`,
  ]
  if (m.tactics.length) lines.push(`- Tactics: ${m.tactics.join('; ')}`)
  if (m.soft_spots.length) lines.push(`- Soft spots: ${m.soft_spots.join('; ')}`)
  if (m.tells.length) lines.push(`- Tells: ${m.tells.join('; ')}`)
  if (m.open_goals.length) lines.push(`- Open goals: ${m.open_goals.join('; ')}`)
  if (m.antagonist_beliefs.length) {
    lines.push(`- Beliefs: ${m.antagonist_beliefs.join('; ')}`)
  }
  return lines.join('\n')
}

/** Merge exit + latest report into the model with cheap heuristics. */
export function refreshPlayerModelFromReport(args: {
  prior: PlayerModel | null
  hubWorldId: number
  report: Pick<SimRunReport, 'codename' | 'status' | 'outcomes' | 'anomalies' | 'headline'>
  exitKind: ExitKind
  updatedAt: string
}): PlayerModel {
  const base = args.prior
    ? { ...args.prior }
    : emptyPlayerModel(args.hubWorldId, args.updatedAt)

  const tactics = [...base.tactics]
  const soft = [...base.soft_spots]
  const tells = [...base.tells]
  const beliefs = [...base.antagonist_beliefs]
  const goals = [...base.open_goals]

  if (args.exitKind === 'death') {
    soft.push('vulnerable to lethal end-states in simulation')
    beliefs.push(`Subject may not survive hard ${args.report.codename}-class runs`)
  } else {
    tactics.push('surfaces / escapes simulation under pressure')
    beliefs.push('Subject can be extracted or extract themselves')
  }

  for (const o of args.report.outcomes.slice(0, 2)) {
    tells.push(o)
  }
  if (args.report.anomalies.length > 0) {
    goals.push(`Investigate anomalies from ${args.report.codename}`)
  }

  let stance = base.stance_toward_program
  if (args.exitKind === 'death') {
    stance = clip(`Pressured by ${args.report.codename} death exit`, PLAYER_MODEL_CAPS.stanceChars)
  } else if (stance === 'unknown') {
    stance = clip(`Returned from ${args.report.codename}`, PLAYER_MODEL_CAPS.stanceChars)
  }

  return compactPlayerModel({
    hub_world_id: args.hubWorldId,
    tactics,
    soft_spots: soft,
    tells,
    open_goals: goals,
    stance_toward_program: stance,
    antagonist_beliefs: beliefs,
    updated_at: args.updatedAt,
  })
}

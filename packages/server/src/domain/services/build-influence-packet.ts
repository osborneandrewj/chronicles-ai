// Pure InfluencePacket builder — hub control channel into a new subworld.
// Complements selectBleedThreads (motifs). No I/O.

import type {
  InfluencePacket,
  MetaStoryBible,
  PlayerModel,
  SimRunReport,
} from '@/domain/entities'

function clip(text: string, max: number): string {
  const c = text.replace(/\s+/g, ' ').trim()
  if (c.length <= max) return c
  return `${c.slice(0, max - 1).trimEnd()}…`
}

export function buildInfluencePacket(args: {
  hubWorldId: number
  targetSubworldId: number | null
  bible: MetaStoryBible | null
  playerModel: PlayerModel | null
  recentReports: SimRunReport[]
  /** Deterministic seed for vessel role choice. */
  seed?: number
}): InfluencePacket {
  const latest = args.recentReports[0] ?? null
  const model = args.playerModel
  const bible = args.bible

  const pressureTags: string[] = []
  if (latest?.status === 'death_exit') pressureTags.push('raise_stakes')
  if (latest?.anomalies.length) pressureTags.push('amplify_anomaly')
  if (model?.soft_spots.length) pressureTags.push('probe_soft_spot')
  if (model?.tactics.some((t) => /escape|surface|extract/i.test(t))) {
    pressureTags.push('block_escape')
  }
  while (pressureTags.length < 1) pressureTags.push('observe_subject')
  const tags = pressureTags.slice(0, 4)

  const planSummary = clip(
    [
      bible ? `Program pressure from hub antagonist ops.` : 'Hub ops pressure.',
      latest ? `Prior run ${latest.codename} (${latest.status}).` : null,
      model?.stance_toward_program
        ? `Subject stance: ${model.stance_toward_program}.`
        : null,
    ]
      .filter(Boolean)
      .join(' '),
    200,
  )

  const vesselRole = pickVesselRole(args.seed ?? latest?.id ?? 0)
  const vessel = {
    role: vesselRole,
    name_hint: null as string | null,
    public_goal: clip(
      vesselRole === 'rival legate'
        ? 'Compete for the same archive or mandate'
        : vesselRole === 'friendly archivist'
          ? 'Offer help while steering the subject'
          : 'Watch and report subject behavior',
      120,
    ),
    hidden_goal: clip(
      bible?.antagonist
        ? `Serve hub antagonist interests: ${clip(bible.antagonist, 60)}`
        : 'Advance program control over the subject',
      120,
    ),
  }

  const bleedMotifIds = (bible?.bleedMotifs ?? []).slice(0, 2).map((m, i) => `motif:${i}:${clip(m, 40)}`)

  return {
    hub_world_id: args.hubWorldId,
    target_subworld_id: args.targetSubworldId,
    plan_summary: planSummary,
    vessel,
    pressure_tags: tags,
    bleed_motif_ids: bleedMotifIds,
  }
}

function pickVesselRole(seed: number): string {
  const roles = ['rival legate', 'friendly archivist', 'watchful handler']
  return roles[Math.abs(seed) % roles.length]!
}

export function formatInfluencePacketBlock(packet: InfluencePacket): string {
  const lines = [
    '## Hub influence (seeded once — do not spam)',
    `- Plan: ${packet.plan_summary}`,
    `- Pressure: ${packet.pressure_tags.join(', ') || '(none)'}`,
  ]
  if (packet.vessel) {
    lines.push(
      `- Vessel: ${packet.vessel.role}` +
        (packet.vessel.name_hint ? ` (${packet.vessel.name_hint})` : ''),
    )
    lines.push(`  public: ${packet.vessel.public_goal}`)
    lines.push(`  hidden: ${packet.vessel.hidden_goal}`)
  }
  return lines.join('\n')
}

export function compactInfluencePacket(packet: InfluencePacket): InfluencePacket {
  return {
    ...packet,
    plan_summary: clip(packet.plan_summary, 200),
    pressure_tags: packet.pressure_tags.map((t) => clip(t, 40)).slice(0, 4),
    bleed_motif_ids: packet.bleed_motif_ids.map((t) => clip(t, 60)).slice(0, 4),
    vessel: packet.vessel
      ? {
          role: clip(packet.vessel.role, 60),
          name_hint: packet.vessel.name_hint ? clip(packet.vessel.name_hint, 40) : null,
          public_goal: clip(packet.vessel.public_goal, 120),
          hidden_goal: clip(packet.vessel.hidden_goal, 120),
        }
      : null,
  }
}

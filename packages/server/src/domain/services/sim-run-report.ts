// Pure SimRunReport compaction, clearance filtering, and prompt rendering.
// Hard caps keep hub STATE budget bounded. No I/O.

import type {
  ClearanceLevel,
  SimRunReport,
  SimRunReportUpsert,
  SimRunStatus,
} from '@/domain/entities'
import { clearanceMeets } from '@/domain/services/clearance'

export const SIM_REPORT_CAPS = {
  headline: 120,
  summary: 600,
  outcomeMax: 5,
  outcomeChars: 120,
  anomalyMax: 4,
  anomalyChars: 120,
  poiMax: 4,
  poiChars: 40,
  /** ~400 tokens for a full body render. */
  bodyTokenBudget: 400,
  ambientIndexMax: 8,
} as const

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function clip(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1).trimEnd()}…`
}

function clipList(items: string[], maxItems: number, maxChars: number): string[] {
  return items
    .map((s) => clip(s, maxChars))
    .filter((s) => s.length > 0)
    .slice(0, maxItems)
}

/** Enforce hard field caps on a report body (idempotent). */
export function compactSimRunReport(
  input: SimRunReportUpsert,
): SimRunReportUpsert {
  return {
    ...input,
    codename: clip(input.codename, 80),
    headline: clip(input.headline, SIM_REPORT_CAPS.headline),
    summary: clip(input.summary, SIM_REPORT_CAPS.summary),
    outcomes: clipList(input.outcomes, SIM_REPORT_CAPS.outcomeMax, SIM_REPORT_CAPS.outcomeChars),
    anomalies: clipList(
      input.anomalies,
      SIM_REPORT_CAPS.anomalyMax,
      SIM_REPORT_CAPS.anomalyChars,
    ),
    persons_of_interest: clipList(
      input.persons_of_interest,
      SIM_REPORT_CAPS.poiMax,
      SIM_REPORT_CAPS.poiChars,
    ),
    genre_tags: input.genre_tags.map((t) => clip(t, 40)).filter(Boolean).slice(0, 8),
  }
}

export type ReportSlice =
  | { kind: 'index'; line: string }
  | { kind: 'headline'; codename: string; status: SimRunStatus; headline: string }
  | { kind: 'body'; report: SimRunReport }

/**
 * Filter a report for a given clearance.
 * - Below minClearance: index line only (codename + status) if public-visible status
 * - public_crew: headline slice
 * - operator+: summary + outcomes
 * - classified/antagonist: full body
 */
export function selectReportSliceForClearance(
  report: SimRunReport,
  clearance: ClearanceLevel,
): ReportSlice {
  const indexLine = `- ${report.codename} — ${report.status} — "${clip(report.headline, 80)}"`

  if (!clearanceMeets(clearance, report.min_clearance) && clearance === 'public_crew') {
    return {
      kind: 'index',
      line: `- ${report.codename} — ${report.status} — (restricted)`,
    }
  }

  if (clearance === 'public_crew') {
    return {
      kind: 'headline',
      codename: report.codename,
      status: report.status,
      headline: report.headline,
    }
  }

  if (clearance === 'operator') {
    return {
      kind: 'body',
      report: {
        ...report,
        anomalies: [],
        persons_of_interest: [],
      },
    }
  }

  // classified + antagonist: full compact body
  return { kind: 'body', report }
}

export function filterReportsForClearance(
  reports: SimRunReport[],
  clearance: ClearanceLevel,
): ReportSlice[] {
  return reports.map((r) => selectReportSliceForClearance(r, clearance))
}

export function formatReportIndexLines(
  reports: SimRunReport[],
  clearance: ClearanceLevel,
  max = SIM_REPORT_CAPS.ambientIndexMax,
): string[] {
  return reports.slice(0, max).map((r) => {
    const slice = selectReportSliceForClearance(r, clearance)
    if (slice.kind === 'index') return slice.line
    if (slice.kind === 'headline') {
      return `- ${slice.codename} — ${slice.status} — "${clip(slice.headline, 80)}"`
    }
    return `- ${slice.report.codename} — ${slice.report.status} — "${clip(slice.report.headline, 80)}"`
  })
}

function renderReportBodyParts(report: SimRunReport): string {
  const lines: string[] = [
    `## Simulation log: ${report.codename}`,
    `Status: ${report.status}`,
    `Summary: ${report.summary}`,
  ]
  if (report.outcomes.length > 0) {
    lines.push('Outcomes:')
    for (const o of report.outcomes) lines.push(`- ${o}`)
  }
  if (report.anomalies.length > 0) {
    lines.push('Anomalies:')
    for (const a of report.anomalies) lines.push(`- ${a}`)
  }
  if (report.persons_of_interest.length > 0) {
    lines.push(`POIs: ${report.persons_of_interest.join(', ')}`)
  }
  return lines.join('\n')
}

export function formatReportBody(report: SimRunReport): string {
  let working: SimRunReport = report
  let text = renderReportBodyParts(working)
  // Budget trim: drop anomalies → POIs → truncate summary if still over.
  if (estimateTokens(text) > SIM_REPORT_CAPS.bodyTokenBudget) {
    working = { ...working, anomalies: [] }
    text = renderReportBodyParts(working)
  }
  if (estimateTokens(text) > SIM_REPORT_CAPS.bodyTokenBudget) {
    working = { ...working, persons_of_interest: [] }
    text = renderReportBodyParts(working)
  }
  if (estimateTokens(text) > SIM_REPORT_CAPS.bodyTokenBudget) {
    const maxSummary = Math.max(80, SIM_REPORT_CAPS.bodyTokenBudget * 4 - 200)
    working = { ...working, summary: clip(working.summary, maxSummary) }
    text = renderReportBodyParts(working)
  }
  return text
}

export function formatAmbientSimIndexBlock(
  reports: SimRunReport[],
  clearance: ClearanceLevel,
): string {
  if (reports.length === 0) return ''
  const lines = formatReportIndexLines(reports, clearance)
  if (lines.length === 0) return ''
  return `\n\n## Simulation index (clearance-filtered)\n${lines.join('\n')}`
}

export function formatConsoleLogPullBlock(
  report: SimRunReport,
  clearance: ClearanceLevel,
): string {
  const slice = selectReportSliceForClearance(report, clearance)
  if (slice.kind === 'index') {
    return `\n\n## Simulation log: ${report.codename}\n${slice.line}\n(Access denied beyond status line.)`
  }
  if (slice.kind === 'headline') {
    return `\n\n## Simulation log: ${slice.codename}\nStatus: ${slice.status}\nHeadline: ${slice.headline}`
  }
  return `\n\n${formatReportBody(slice.report)}`
}

export type ExitKind = 'death' | 'awakening'

export function statusFromExitKind(kind: ExitKind): SimRunStatus {
  return kind === 'death' ? 'death_exit' : 'awakening_exit'
}

/**
 * Deterministic compact report at run close. Never blocks on LLM.
 * Uses exit kind + codename + a thin window of recent prose for color.
 */
export function buildDeterministicSimRunReport(args: {
  codename: string
  exitKind: ExitKind
  genreTags?: string[]
  sourceTurnId: number | null
  recentTurns?: Array<{ role: string; content: string }>
  placeNames?: string[]
}): SimRunReportUpsert {
  const status = statusFromExitKind(args.exitKind)
  const codename = args.codename.trim() || 'Unnamed protocol'
  const recent = args.recentTurns ?? []
  const narratorBits = recent
    .filter((t) => t.role === 'assistant')
    .map((t) => t.content.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const lastNarrator = narratorBits[narratorBits.length - 1] ?? ''

  const headline =
    args.exitKind === 'death'
      ? `Subject lost during ${codename}; run closed on death.`
      : `Subject surfaced from ${codename}; simulation released.`

  const placeHint =
    args.placeNames && args.placeNames.length > 0
      ? ` Last locales: ${args.placeNames.slice(0, 3).join(', ')}.`
      : ''

  const summary = clip(
    args.exitKind === 'death'
      ? `${codename} terminated with subject death.${placeHint} ${clip(lastNarrator, 280)}`
      : `${codename} ended with subject awakening / release.${placeHint} ${clip(lastNarrator, 280)}`,
    SIM_REPORT_CAPS.summary,
  )

  const outcomes: string[] = [
    args.exitKind === 'death' ? 'Primary subject declared dead in-sim' : 'Subject returned to hub facility',
  ]
  if (args.placeNames?.[0]) {
    outcomes.push(`Closing locale: ${args.placeNames[0]}`)
  }

  const anomalies: string[] = []
  const combined = recent.map((t) => t.content).join('\n').toLowerCase()
  if (/\b(lucid|glitch|bleed|impossible|wrongness|motif)\b/.test(combined)) {
    anomalies.push('Anomaly language present in closing window')
  }
  if (args.exitKind === 'death') {
    anomalies.push('Death exit may elevate program review')
  }

  const min_clearance: ClearanceLevel =
    anomalies.length > 1 ? 'classified' : 'operator'

  return compactSimRunReport({
    hub_world_id: 0, // filled by caller
    subworld_id: 0,
    codename,
    genre_tags: args.genreTags ?? [],
    status,
    headline,
    summary,
    outcomes,
    anomalies,
    persons_of_interest: [],
    min_clearance,
    source_turn_id: args.sourceTurnId,
  })
}

/** Pick one report for console pull: name match, else newest. */
export function pickReportForQuery(
  reports: SimRunReport[],
  playerText: string,
): SimRunReport | null {
  if (reports.length === 0) return null
  const text = playerText.toLowerCase()
  const named = reports.find((r) => {
    const name = r.codename.toLowerCase()
    return name.length >= 3 && text.includes(name)
  })
  if (named) return named
  // Prefer completed-ish over ongoing when listing
  return [...reports].sort((a, b) => b.id - a.id)[0] ?? null
}

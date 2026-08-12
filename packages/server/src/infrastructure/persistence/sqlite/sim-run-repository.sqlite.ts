import 'server-only'

import type { SimRunReport, SimRunReportUpsert, SimRunStatus } from '@/domain/entities'
import type { SimRunRepository } from '@/domain/ports/sim-run-repository'
import { parseClearanceLevel } from '@/domain/services/clearance'
import { compactSimRunReport } from '@/domain/services/sim-run-report'
import { db } from '@/lib/db'

type ReportRow = {
  id: number
  hub_world_id: number
  subworld_id: number
  codename: string
  genre_tags: string
  status: string
  headline: string
  summary: string
  outcomes: string
  anomalies: string
  persons_of_interest: string
  min_clearance: string
  source_turn_id: number | null
  created_at: string
}

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function mapRow(row: ReportRow): SimRunReport {
  return {
    id: row.id,
    hub_world_id: row.hub_world_id,
    subworld_id: row.subworld_id,
    codename: row.codename,
    genre_tags: parseJsonArray(row.genre_tags),
    status: row.status as SimRunStatus,
    headline: row.headline,
    summary: row.summary,
    outcomes: parseJsonArray(row.outcomes),
    anomalies: parseJsonArray(row.anomalies),
    persons_of_interest: parseJsonArray(row.persons_of_interest),
    min_clearance: parseClearanceLevel(row.min_clearance, 'operator'),
    source_turn_id: row.source_turn_id,
    created_at: row.created_at,
  }
}

const upsertStmt = db.prepare<
  [
    number,
    number,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    number | null,
  ]
>(
  `INSERT INTO sim_run_reports (
     hub_world_id, subworld_id, codename, genre_tags, status,
     headline, summary, outcomes, anomalies, persons_of_interest,
     min_clearance, source_turn_id
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(hub_world_id, subworld_id) DO UPDATE SET
     codename = excluded.codename,
     genre_tags = excluded.genre_tags,
     status = excluded.status,
     headline = excluded.headline,
     summary = excluded.summary,
     outcomes = excluded.outcomes,
     anomalies = excluded.anomalies,
     persons_of_interest = excluded.persons_of_interest,
     min_clearance = excluded.min_clearance,
     source_turn_id = COALESCE(excluded.source_turn_id, sim_run_reports.source_turn_id)
   RETURNING *`,
)

const forHubStmt = db.prepare<[number]>(
  `SELECT * FROM sim_run_reports WHERE hub_world_id = ? ORDER BY id DESC`,
)

const bySubworldStmt = db.prepare<[number, number]>(
  `SELECT * FROM sim_run_reports WHERE hub_world_id = ? AND subworld_id = ?`,
)

export class SqliteSimRunRepository implements SimRunRepository {
  upsertByRun(report: SimRunReportUpsert): Promise<SimRunReport> {
    const c = compactSimRunReport(report)
    const row = upsertStmt.get(
      c.hub_world_id,
      c.subworld_id,
      c.codename,
      JSON.stringify(c.genre_tags),
      c.status,
      c.headline,
      c.summary,
      JSON.stringify(c.outcomes),
      JSON.stringify(c.anomalies),
      JSON.stringify(c.persons_of_interest),
      c.min_clearance,
      c.source_turn_id,
    ) as ReportRow
    return Promise.resolve(mapRow(row))
  }

  forHub(hubWorldId: number): Promise<SimRunReport[]> {
    const rows = forHubStmt.all(hubWorldId) as ReportRow[]
    return Promise.resolve(rows.map(mapRow))
  }

  bySubworld(hubWorldId: number, subworldId: number): Promise<SimRunReport | null> {
    const row = bySubworldStmt.get(hubWorldId, subworldId) as ReportRow | undefined
    return Promise.resolve(row ? mapRow(row) : null)
  }
}

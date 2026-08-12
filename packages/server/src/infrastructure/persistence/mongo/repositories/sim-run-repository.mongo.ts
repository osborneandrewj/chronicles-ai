import 'server-only'

import type { SimRunReport, SimRunReportUpsert, SimRunStatus } from '@/domain/entities'
import type { SimRunRepository } from '@/domain/ports/sim-run-repository'
import { parseClearanceLevel } from '@/domain/services/clearance'
import { compactSimRunReport } from '@/domain/services/sim-run-report'
import type { MongoContext } from '../mongo-context'
import type { SimRunReportDoc } from '../models'
import { toSqliteDatetime } from './mappers'

function mapDoc(d: SimRunReportDoc): SimRunReport {
  return {
    id: d.id,
    hub_world_id: d.hubWorldId,
    subworld_id: d.subworldId,
    codename: d.codename,
    genre_tags: d.genreTags ?? [],
    status: d.status as SimRunStatus,
    headline: d.headline,
    summary: d.summary,
    outcomes: d.outcomes ?? [],
    anomalies: d.anomalies ?? [],
    persons_of_interest: d.personsOfInterest ?? [],
    min_clearance: parseClearanceLevel(d.minClearance, 'operator'),
    source_turn_id: d.sourceTurnId ?? null,
    created_at: toSqliteDatetime(d.createdAt),
  }
}

export class MongoSimRunRepository implements SimRunRepository {
  constructor(private readonly ctx: MongoContext) {}

  async upsertByRun(report: SimRunReportUpsert): Promise<SimRunReport> {
    const c = compactSimRunReport(report)
    const existing = await this.ctx.models.SimRunReport.findOne({
      hubWorldId: c.hub_world_id,
      subworldId: c.subworld_id,
    }).lean()

    if (existing) {
      await this.ctx.models.SimRunReport.updateOne(
        { hubWorldId: c.hub_world_id, subworldId: c.subworld_id },
        {
          $set: {
            codename: c.codename,
            genreTags: c.genre_tags,
            status: c.status,
            headline: c.headline,
            summary: c.summary,
            outcomes: c.outcomes,
            anomalies: c.anomalies,
            personsOfInterest: c.persons_of_interest,
            minClearance: c.min_clearance,
            sourceTurnId: c.source_turn_id ?? existing.sourceTurnId ?? null,
          },
        },
        { session: this.ctx.currentSession ?? undefined },
      )
      const updated = await this.ctx.models.SimRunReport.findOne({
        hubWorldId: c.hub_world_id,
        subworldId: c.subworld_id,
      }).lean()
      return mapDoc(updated as SimRunReportDoc)
    }

    const id = await this.ctx.nextSeq('simRunReportId')
    await this.ctx.models.SimRunReport.create(
      [
        {
          id,
          hubWorldId: c.hub_world_id,
          subworldId: c.subworld_id,
          codename: c.codename,
          genreTags: c.genre_tags,
          status: c.status,
          headline: c.headline,
          summary: c.summary,
          outcomes: c.outcomes,
          anomalies: c.anomalies,
          personsOfInterest: c.persons_of_interest,
          minClearance: c.min_clearance,
          sourceTurnId: c.source_turn_id,
          createdAt: new Date(),
        },
      ],
      { session: this.ctx.currentSession ?? undefined },
    )
    const created = await this.ctx.models.SimRunReport.findOne({ id }).lean()
    return mapDoc(created as SimRunReportDoc)
  }

  async forHub(hubWorldId: number): Promise<SimRunReport[]> {
    const docs = await this.ctx.models.SimRunReport.find({ hubWorldId })
      .sort({ id: -1 })
      .lean()
    return docs.map((d) => mapDoc(d as SimRunReportDoc))
  }

  async bySubworld(hubWorldId: number, subworldId: number): Promise<SimRunReport | null> {
    const doc = await this.ctx.models.SimRunReport.findOne({
      hubWorldId,
      subworldId,
    }).lean()
    return doc ? mapDoc(doc as SimRunReportDoc) : null
  }
}

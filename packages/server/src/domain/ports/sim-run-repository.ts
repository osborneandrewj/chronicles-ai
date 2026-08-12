import type { SimRunReport, SimRunReportUpsert } from '@/domain/entities'

// SimRunRepository — compact hub-scoped sim exit reports.
// Unique key (hub_world_id, subworld_id); upsert is idempotent across return paths.

export interface SimRunRepository {
  /** Insert or overwrite compact body for the same hub+subworld run. */
  upsertByRun(report: SimRunReportUpsert): Promise<SimRunReport>
  /** All reports for a hub, newest first. */
  forHub(hubWorldId: number): Promise<SimRunReport[]>
  bySubworld(hubWorldId: number, subworldId: number): Promise<SimRunReport | null>
}

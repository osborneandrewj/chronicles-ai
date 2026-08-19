import 'server-only'

import type { HostRoster } from '@/domain/entities/host'
import type { HostRosterProvider } from '@/domain/ports/host-roster'
import { THRESHOLD_ROSTER } from '@/infrastructure/world-gen/parks/threshold/roster'

const DEFAULT_ROSTERS: ReadonlyMap<string, HostRoster> = new Map([
  [THRESHOLD_ROSTER.parkId, THRESHOLD_ROSTER],
])

export class StaticHostRosterProvider implements HostRosterProvider {
  constructor(private readonly rosters: ReadonlyMap<string, HostRoster> = DEFAULT_ROSTERS) {}

  forPark(parkId: string): Promise<HostRoster | null> {
    return Promise.resolve(this.rosters.get(parkId) ?? null)
  }
}

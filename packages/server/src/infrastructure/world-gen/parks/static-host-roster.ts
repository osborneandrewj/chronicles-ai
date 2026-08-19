import 'server-only'

import type { HostRoster } from '@/domain/entities/host'
import type { HostRosterProvider } from '@/domain/ports/host-roster'

// In-memory lookup. Catalog parks get authored files in a later slice;
// until then every park id misses and createBoundedWorld keeps Grok dressing.

export class StaticHostRosterProvider implements HostRosterProvider {
  constructor(private readonly rosters: ReadonlyMap<string, HostRoster> = new Map()) {}

  forPark(parkId: string): Promise<HostRoster | null> {
    return Promise.resolve(this.rosters.get(parkId) ?? null)
  }
}

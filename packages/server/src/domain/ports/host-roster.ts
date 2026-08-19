import type { HostRoster } from '@/domain/entities/host'

// HostRosterProvider — authored people for one catalog park. Null when the
// park has no roster yet (sandbox / until the THRESHOLD files land). The
// adapter is dumb lookup; seeding orchestration stays in a use case.

export interface HostRosterProvider {
  forPark(parkId: string): Promise<HostRoster | null>
}

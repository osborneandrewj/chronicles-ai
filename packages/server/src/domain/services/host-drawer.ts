import type { Character } from '@/domain/entities'
import type { HostFile, HostRoster } from '@/domain/entities/host'
import { isDescriptorName } from '@/domain/services/character-identity'
import { parseRefusals } from '@/domain/services/host-refusals'

export function walkOnDrawer(roster: HostRoster): HostFile[] {
  return roster.hosts.filter((host) => host.kind === 'walk-on')
}

export function principalHosts(roster: HostRoster): HostFile[] {
  return roster.hosts.filter((host) => host.kind === 'principal')
}

export function offStageHosts(roster: HostRoster): HostFile[] {
  return roster.hosts.filter((host) => host.kind === 'off-stage')
}

// Seated extras carry authored refusals and stay npc-tier. Principals are
// local; minted sandbox walk-ons have no refusals. Bind to that, not a role regex.
export function isSeatedExtra(
  c: Pick<Character, 'is_player' | 'status' | 'agency_level' | 'refusals'>,
): boolean {
  return (
    c.is_player === 0 &&
    c.status === 'active' &&
    c.agency_level === 'npc' &&
    parseRefusals(c.refusals).length > 0
  )
}

export function pickDrawerExtra(
  proposedName: string,
  placeId: number | null,
  existing: Character[],
): Character | null {
  if (!isDescriptorName(proposedName) || placeId == null) return null
  const atPlace = existing
    .filter((c) => isSeatedExtra(c) && c.current_place_id === placeId)
    .sort((a, b) => a.id - b.id)
  return atPlace[0] ?? null
}

// Catalog parks with a drawer must not mint "the technician". Sandbox worlds
// (no seated extras) keep descriptor inserts.
export function shouldSkipDescriptorMint(proposedName: string, existing: Character[]): boolean {
  if (!isDescriptorName(proposedName)) return false
  return existing.some(isSeatedExtra)
}

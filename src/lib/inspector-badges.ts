import type { Character, Scene } from '@/lib/world-state'

export type BadgeTone = 'player' | 'danger' | 'muted' | 'here' | 'agency' | 'active'

export interface InspectorBadge {
  label: string
  tone: BadgeTone
}

/**
 * At-a-glance badges for a character's collapsed row, in fixed order:
 * player marker, life status (dead/inactive; active shows nothing), presence
 * (in the current place), agency level (npc shows nothing).
 */
export function deriveCharacterBadges(
  c: Pick<Character, 'is_player' | 'status' | 'agency_level' | 'current_place_id'>,
  currentPlaceId: number | null,
): InspectorBadge[] {
  const badges: InspectorBadge[] = []
  if (c.is_player === 1) badges.push({ label: 'you', tone: 'player' })
  if (c.status === 'dead') badges.push({ label: 'dead', tone: 'danger' })
  else if (c.status === 'inactive') badges.push({ label: 'inactive', tone: 'muted' })
  if (currentPlaceId !== null && c.current_place_id === currentPlaceId) {
    badges.push({ label: 'here', tone: 'here' })
  }
  if (c.is_player !== 1 && c.agency_level !== 'npc') {
    badges.push({ label: c.agency_level, tone: 'agency' })
  }
  return badges
}

export function deriveSceneBadge(s: Pick<Scene, 'status'>): InspectorBadge {
  return s.status === 'active'
    ? { label: 'active', tone: 'active' }
    : { label: 'done', tone: 'muted' }
}

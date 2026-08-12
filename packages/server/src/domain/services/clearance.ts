// Pure clearance ordering for hub ops. No I/O.

import type { ClearanceLevel } from '@/domain/entities'

const RANK: Record<ClearanceLevel, number> = {
  public_crew: 0,
  operator: 1,
  classified: 2,
  antagonist: 3,
}

export const CLEARANCE_LEVELS: ClearanceLevel[] = [
  'public_crew',
  'operator',
  'classified',
  'antagonist',
]

export function isClearanceLevel(value: unknown): value is ClearanceLevel {
  return typeof value === 'string' && value in RANK
}

export function parseClearanceLevel(
  value: unknown,
  fallback: ClearanceLevel = 'public_crew',
): ClearanceLevel {
  return isClearanceLevel(value) ? value : fallback
}

/** True when actor clearance is at least as high as required. */
export function clearanceMeets(
  actor: ClearanceLevel,
  required: ClearanceLevel,
): boolean {
  return RANK[actor] >= RANK[required]
}

export function minClearance(
  a: ClearanceLevel,
  b: ClearanceLevel,
): ClearanceLevel {
  return RANK[a] <= RANK[b] ? a : b
}

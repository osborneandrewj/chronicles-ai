// Parse / serialize worlds.director_state_json. Pure. Fail-open empty.

import type { DirectorCastSlot } from '@/domain/entities/director-beat'
import type {
  DirectorBrainReason,
  DirectorState,
  PendingDirectorBeat,
} from '@/domain/entities/director-state'
import { emptyDirectorState } from '@/domain/entities/director-state'
import type { DirectorBeatKind } from '@/domain/entities/director-beat'

const BEAT_KINDS = new Set<DirectorBeatKind>([
  'pressure',
  'reveal',
  'arrival',
  'close',
  'stall_escalate',
  'local',
  'yield',
])
const REASONS = new Set<DirectorBrainReason>([
  'stall',
  'climax',
  'empty_dossier',
  'cast_collision',
])
const ROLES = new Set(['initiate', 'react', 'background', 'arrive'])

export function parseDirectorState(raw: string | null | undefined): DirectorState {
  if (!raw || !raw.trim()) return emptyDirectorState()
  try {
    const v = JSON.parse(raw) as Partial<DirectorState>
    return {
      pending: parsePending(v.pending),
      lastBrainTurnId: asInt(v.lastBrainTurnId),
      lastBrainReason:
        typeof v.lastBrainReason === 'string' && REASONS.has(v.lastBrainReason)
          ? v.lastBrainReason
          : null,
    }
  } catch {
    return emptyDirectorState()
  }
}

export function serializeDirectorState(state: DirectorState): string {
  return JSON.stringify(state)
}

function parsePending(raw: unknown): PendingDirectorBeat | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<PendingDirectorBeat>
  if (typeof p.beatKind !== 'string' || !BEAT_KINDS.has(p.beatKind)) return null
  if (typeof p.reason !== 'string' || !REASONS.has(p.reason)) return null
  return {
    beatKind: p.beatKind,
    foregroundThreadId: asInt(p.foregroundThreadId),
    mustStage: asStringArray(p.mustStage),
    mustNot: asStringArray(p.mustNot),
    cast: asCast(p.cast),
    guidanceLines: asStringArray(p.guidanceLines),
    reason: p.reason,
    sourceTurnId: asInt(p.sourceTurnId) ?? 0,
  }
}

function asInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function asCast(v: unknown): DirectorCastSlot[] {
  if (!Array.isArray(v)) return []
  const slots: DirectorCastSlot[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<DirectorCastSlot>
    if (typeof row.characterId !== 'number' || typeof row.name !== 'string') continue
    if (typeof row.role !== 'string' || !ROLES.has(row.role)) continue
    slots.push({ characterId: row.characterId, name: row.name, role: row.role })
  }
  return slots
}
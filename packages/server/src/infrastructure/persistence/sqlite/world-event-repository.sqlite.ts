import 'server-only'

import type { WorldEvent, WorldEventInput } from '@/domain/entities'
import { isWorldEventKind } from '@/domain/entities'
import type { WorldEventRepository } from '@/domain/ports/world-event-repository'
import { WORLD_EVENT_RECENT_CAP } from '@/domain/ports/world-event-repository'
import { db } from '@/lib/db'

type WorldEventRow = {
  id: number
  world_id: number
  turn_id: number | null
  world_time: string | null
  kind: string
  source_agent: string
  actor_id: number | null
  thread_id: number | null
  payload_json: string
  visibility: string
  created_at: string
}

const insertStmt = db.prepare<
  [
    number,
    number | null,
    string | null,
    string,
    string,
    number | null,
    number | null,
    string,
    string,
  ]
>(
  `INSERT INTO world_events (
     world_id, turn_id, world_time, kind, source_agent,
     actor_id, thread_id, payload_json, visibility
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)

const recentStmt = db.prepare<[number, number]>(
  `SELECT id, world_id, turn_id, world_time, kind, source_agent,
          actor_id, thread_id, payload_json, visibility, created_at
     FROM world_events
    WHERE world_id = ?
    ORDER BY id DESC
    LIMIT ?`,
)

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function mapRow(row: WorldEventRow): WorldEvent | null {
  if (!isWorldEventKind(row.kind)) return null
  const source =
    row.source_agent === 'director' || row.source_agent === 'reconciler'
      ? row.source_agent
      : 'director'
  const visibility =
    row.visibility === 'narrator' ||
    row.visibility === 'player' ||
    row.visibility === 'system'
      ? row.visibility
      : 'system'
  return {
    id: row.id,
    world_id: row.world_id,
    turn_id: row.turn_id,
    world_time: row.world_time,
    kind: row.kind,
    source_agent: source,
    actor_id: row.actor_id,
    thread_id: row.thread_id,
    payload: parsePayload(row.payload_json),
    visibility,
    created_at: row.created_at,
  }
}

export class SqliteWorldEventRepository implements WorldEventRepository {
  append(event: WorldEventInput): Promise<void> {
    insertStmt.run(
      event.world_id,
      event.turn_id,
      event.world_time,
      event.kind,
      event.source_agent,
      event.actor_id,
      event.thread_id,
      JSON.stringify(event.payload ?? {}),
      event.visibility,
    )
    return Promise.resolve()
  }

  recentForWorld(
    worldId: number,
    limit: number = WORLD_EVENT_RECENT_CAP,
  ): Promise<WorldEvent[]> {
    const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : WORLD_EVENT_RECENT_CAP
    const rows = recentStmt.all(worldId, cap) as WorldEventRow[]
    return Promise.resolve(rows.map(mapRow).filter((e): e is WorldEvent => e != null))
  }
}
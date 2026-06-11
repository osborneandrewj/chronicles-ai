import type { TimelineProvenance } from '@/domain/entities'

// A timeline event to append. Ids + `created_at` are owned by the store. Both
// provenance kinds flow through here: 'turn' events carry a turn_id (sim_tick
// null); 'sim' events carry a sim_tick (turn_id null). The caller sets the
// provenance + the matching id; the adapter does a single INSERT.
export type TimelineEventInput = {
  world_id: number
  turn_id: number | null
  thread_id: number | null
  world_time: string | null
  title: string
  summary: string
  importance: number
  sim_tick: number | null
  provenance: TimelineProvenance
}

// TimelineWriter (starship P0) — the WRITE seam for `timeline_events`. Today the
// only timeline writes live in `lib/` (archivist.ts / db.ts) and `DossierRepository`
// reads only; there is no onion-layer write port to reuse. This adds the minimal
// append the pre-sim needs (provenance='sim') and that the strangled archivist
// path can adopt later (provenance='turn'). Dumb CRUD — no deciding logic.
// Async by mandate (spec §5.3).
export interface TimelineWriter {
  append(event: TimelineEventInput): Promise<void>
}

// Turn entity + turn metadata value shapes (spec §3.3: row TYPE defs live in
// domain/entities). Pure type declarations — no I/O, no SDK, no db handle.

export type TurnRole = 'user' | 'assistant'

export type Turn = {
  id: number
  world_id: number
  role: TurnRole
  content: string
  scene_id: number | null
  created_at: string
}

export type TurnTimestamp = { id: number; created_at: string }

// Parsed metadata for a single assistant turn. `metadata` is the per-agent
// usage/diagnostics blob the pipeline writes via json_patch; consumers parse it
// into an open record because each agent owns its own nested key.
export type AssistantTurnMetadata = { id: number; metadata: Record<string, unknown> }

import type {
  AssistantTurnMetadata,
  Turn,
  TurnRole,
  TurnTimestamp,
} from '@/domain/entities'

// TurnRepository (spec §3.4) — APPEND-ONLY. There is deliberately NO general
// `update` / clobbering `setMetadata`: turns are immutable once written. The only
// permitted mutations are the two narrow, commutative metadata operations the
// app actually performs:
//   - `mergeMetadata`: deep-merges one agent's block under its key (mirrors the
//     `json_patch` semantics so concurrent archivist / tts writers don't clobber).
//   - `incTtsChars`: additively grows `$.tts.chars` (mirrors `json_set` additive
//     semantics so replays accumulate rather than overwrite).
// All methods are async (Promise) even though the SQLite adapter is synchronous,
// so the future Mongo adapter is signature-compatible (spec §5.3 risk row).
export interface TurnRepository {
  /** Append a new turn. */
  insert(
    worldId: number,
    role: TurnRole,
    content: string,
    sceneId?: number | null,
  ): Promise<Turn>

  /** All turns for a world, oldest-first. */
  allForWorld(worldId: number): Promise<Turn[]>

  /** The most recent `limit` turns, returned oldest-first. */
  recentTurns(
    worldId: number,
    limit: number,
  ): Promise<Array<Pick<Turn, 'id' | 'role' | 'content'>>>

  /** The newest `limit` turns, oldest-first (history initial page). */
  latestTurns(worldId: number, limit: number): Promise<Turn[]>

  /** Up to `limit` turns with id < beforeId, oldest-first (history "load older"). */
  turnsBefore(worldId: number, beforeId: number, limit: number): Promise<Turn[]>

  /** Content of the latest user turn, or null. */
  latestUserContent(worldId: number): Promise<string | null>

  /** The latest turn of any role, or null. */
  latestTurn(worldId: number): Promise<Turn | null>

  /** The newest assistant turn after the latest user turn (idempotency probe). */
  latestAssistantAfterLatestUser(worldId: number): Promise<Turn | null>

  /** Count of user turns in the world. */
  userTurnCount(worldId: number): Promise<number>

  /** Id of the latest user turn (for [t:N] provenance), or null. */
  latestUserTurnId(worldId: number): Promise<number | null>

  /** Deep-merge `block` under `agentKey` into the turn's metadata (json_patch). */
  mergeMetadata(
    turnId: number,
    agentKey: string,
    block: Record<string, unknown>,
  ): Promise<void>

  /** Additively grow `$.tts.chars` for an assistant turn in this world. */
  incTtsChars(worldId: number, turnId: number, chars: number): Promise<void>

  /** Latest non-null metadata blob, parsed, or null. */
  latestMetadata(
    worldId: number,
  ): Promise<{ id: number; metadata: Record<string, unknown> } | null>

  /** All assistant-turn metadata, oldest-first. */
  allAssistantMetadata(worldId: number): Promise<AssistantTurnMetadata[]>

  /** Assistant-turn metadata with id >= minId, oldest-first. */
  assistantMetadataSince(
    worldId: number,
    minId: number,
  ): Promise<AssistantTurnMetadata[]>

  /** Assistant-turn metadata in [minId, maxIdExclusive), oldest-first. */
  assistantMetadataInRange(
    worldId: number,
    minId: number,
    maxIdExclusive: number,
  ): Promise<AssistantTurnMetadata[]>

  /** Whether any turn exists with id < id (cheap "has older" probe). */
  hasTurnBefore(worldId: number, id: number): Promise<boolean>

  /** (id, created_at) for every turn, oldest-first (turn-number derivation). */
  turnTimestamps(worldId: number): Promise<TurnTimestamp[]>
}

import 'server-only'

import {
  addTtsChars,
  allAssistantMetadata,
  allTurns,
  assistantMetadataInRange,
  assistantMetadataSince,
  getLatestMetadata,
  getTurnTimestampsForWorld,
  hasTurnBefore,
  insertTurn,
  latestAssistantAfterLatestUser,
  latestTurn,
  latestTurns,
  latestUserContent,
  latestUserTurnId,
  recentTurns,
  turnsBefore,
  updateTurnMetadata,
  userTurnCount,
  type AssistantTurnMetadata,
  type Turn,
  type TurnRole,
  type TurnTimestamp,
} from '@/lib/db'
import type { TurnRepository } from '@/domain/ports/turn-repository'

// SQLite adapter for the append-only TurnRepository (spec §5.1-P1, §3.4).
// Delegates to the prepared statements in `lib/db.ts` — SQL identical, only the
// access path changes. Every method returns a Promise (the engine is sync;
// `Promise.resolve` keeps the signature compatible with the future Mongo
// adapter, spec §5.3). Mutation is restricted to the two commutative metadata
// ops; there is no general row update.
export class SqliteTurnRepository implements TurnRepository {
  insert(
    worldId: number,
    role: TurnRole,
    content: string,
    sceneId: number | null = null,
  ): Promise<Turn> {
    return Promise.resolve(insertTurn(worldId, role, content, sceneId))
  }

  allForWorld(worldId: number): Promise<Turn[]> {
    return Promise.resolve(allTurns(worldId))
  }

  recentTurns(
    worldId: number,
    limit: number,
  ): Promise<Array<Pick<Turn, 'id' | 'role' | 'content'>>> {
    return Promise.resolve(recentTurns(worldId, limit))
  }

  latestTurns(worldId: number, limit: number): Promise<Turn[]> {
    return Promise.resolve(latestTurns(worldId, limit))
  }

  turnsBefore(worldId: number, beforeId: number, limit: number): Promise<Turn[]> {
    return Promise.resolve(turnsBefore(worldId, beforeId, limit))
  }

  latestUserContent(worldId: number): Promise<string | null> {
    return Promise.resolve(latestUserContent(worldId))
  }

  latestTurn(worldId: number): Promise<Turn | null> {
    return Promise.resolve(latestTurn(worldId))
  }

  latestAssistantAfterLatestUser(worldId: number): Promise<Turn | null> {
    return Promise.resolve(latestAssistantAfterLatestUser(worldId))
  }

  userTurnCount(worldId: number): Promise<number> {
    return Promise.resolve(userTurnCount(worldId))
  }

  latestUserTurnId(worldId: number): Promise<number | null> {
    return Promise.resolve(latestUserTurnId(worldId))
  }

  // Deep-merge `block` under `agentKey` (json_patch semantics in db.ts). The
  // append-only invariant permits this because keyed agent blocks never clobber
  // a sibling agent's block.
  mergeMetadata(
    turnId: number,
    agentKey: string,
    block: Record<string, unknown>,
  ): Promise<void> {
    updateTurnMetadata(turnId, { [agentKey]: block })
    return Promise.resolve()
  }

  incTtsChars(worldId: number, turnId: number, chars: number): Promise<void> {
    addTtsChars(worldId, turnId, chars)
    return Promise.resolve()
  }

  latestMetadata(
    worldId: number,
  ): Promise<{ id: number; metadata: Record<string, unknown> } | null> {
    return Promise.resolve(getLatestMetadata(worldId))
  }

  allAssistantMetadata(worldId: number): Promise<AssistantTurnMetadata[]> {
    return Promise.resolve(allAssistantMetadata(worldId))
  }

  assistantMetadataSince(
    worldId: number,
    minId: number,
  ): Promise<AssistantTurnMetadata[]> {
    return Promise.resolve(assistantMetadataSince(worldId, minId))
  }

  assistantMetadataInRange(
    worldId: number,
    minId: number,
    maxIdExclusive: number,
  ): Promise<AssistantTurnMetadata[]> {
    return Promise.resolve(assistantMetadataInRange(worldId, minId, maxIdExclusive))
  }

  hasTurnBefore(worldId: number, id: number): Promise<boolean> {
    return Promise.resolve(hasTurnBefore(worldId, id))
  }

  turnTimestamps(worldId: number): Promise<TurnTimestamp[]> {
    return Promise.resolve(getTurnTimestampsForWorld(worldId))
  }
}

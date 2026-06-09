import type { WorldCorrectionRow } from '@/domain/entities'
import type { CorrectionRepository, TurnRepository, WorldRepository } from '@/domain/ports'
import { WorldNotFoundError } from '@/application/use-cases/load-history'

// ApplyCorrection (spec §3.5, §5.1-P5) — orchestrates a player→archivist
// correction: read prior state + recent turns, run the correction extractor,
// apply the resulting patch, persist the correction row, and fold the LLM cost
// into the latest turn's archivist metadata bucket.
//
// PARTIAL CARVE: the patch application itself (`applyArchivistPatch`) is the
// fused merge transaction — name-resolution / alias-merge / scene-transition all
// issue interleaved UPDATE/DELETE mid-loop. Converting it to a load-all →
// simulate → apply MergePlan is the same rewrite staged for AdvanceTurn (P5 part
// 2). Until then the extractor and applier are injected as functions the route
// wires (they own the SDK + SQL); the use case owns only the orchestration.

export { WorldNotFoundError }

export class CorrectionExtractFailed extends Error {
  constructor(public readonly cause: unknown) {
    super('Correction extraction failed')
    this.name = 'CorrectionExtractFailed'
  }
}

export class CorrectionApplyFailed extends Error {
  constructor(public readonly cause: unknown) {
    super('Correction apply failed')
    this.name = 'CorrectionApplyFailed'
  }
}

type RecentTurn = { role: 'user' | 'assistant'; content: string }

export type CorrectionPatchResult = {
  patch: unknown
  reply: string
  usage: { inputTokens?: number; outputTokens?: number }
}

const RECENT_TURNS_FOR_CONTEXT = 4

export type ApplyCorrectionInput = {
  worldId: number
  text: string
}

export type ApplyCorrectionDeps = {
  worlds: WorldRepository
  turns: TurnRepository
  corrections: CorrectionRepository
  /** Read the narrator-facing prior state the extractor reasons over. */
  readPriorState: (worldId: number) => unknown
  /** Run the correction extractor (LLM). Owns the SDK call. */
  extractPatch: (
    prior: unknown,
    playerText: string,
    recent: RecentTurn[],
  ) => Promise<CorrectionPatchResult>
  /** Apply the extracted patch (fused merge txn). Owns the SQL. */
  applyPatch: (worldId: number, turnId: number, patch: unknown) => Promise<void>
}

export type ApplyCorrectionResult = {
  row: WorldCorrectionRow
  reply: string
  appliedPatch: unknown
}

export async function applyCorrection(
  { worldId, text }: ApplyCorrectionInput,
  {
    worlds,
    turns,
    corrections,
    readPriorState,
    extractPatch,
    applyPatch,
  }: ApplyCorrectionDeps,
): Promise<ApplyCorrectionResult> {
  if (!(await worlds.getWorld(worldId))) {
    throw new WorldNotFoundError(worldId)
  }

  const prior = readPriorState(worldId)
  const recent: RecentTurn[] = (await turns.recentTurns(worldId, RECENT_TURNS_FOR_CONTEXT))
    // recentTurns returns DESC by id; the prompt wants chronological order.
    .slice()
    .reverse()
    .map((t) => ({ role: t.role as 'user' | 'assistant', content: t.content }))

  let result: CorrectionPatchResult
  try {
    result = await extractPatch(prior, text, recent)
  } catch (err) {
    throw new CorrectionExtractFailed(err)
  }

  const latest = await turns.latestTurn(worldId)
  // turn_id pins the correction to the narrative moment it was made at, and
  // gives any [t:N][edit]-tagged memorable_facts a real id to land on. May be
  // null for a fresh world with no turns yet.
  const turnId = latest?.id ?? null

  try {
    await applyPatch(worldId, turnId ?? 0, result.patch)
  } catch (err) {
    throw new CorrectionApplyFailed(err)
  }

  const row = await corrections.insert(worldId, turnId, text, result.reply, result.patch)

  // Fold the LLM cost into the latest turn's archivist bucket so the usage
  // dashboard accumulates correction calls. Additive merge — never clobber a
  // prior archivist usage block.
  if (latest) {
    const existing = (await turns.latestMetadata(worldId))?.metadata ?? {}
    const priorUsage =
      (existing as { archivist?: { usage?: { inputTokens?: number; outputTokens?: number } } })
        .archivist?.usage ?? { inputTokens: 0, outputTokens: 0 }
    await turns.mergeMetadata(latest.id, 'archivist', {
      usage: {
        inputTokens: (priorUsage.inputTokens ?? 0) + (result.usage.inputTokens ?? 0),
        outputTokens: (priorUsage.outputTokens ?? 0) + (result.usage.outputTokens ?? 0),
      },
    })
  }

  return { row, reply: result.reply, appliedPatch: result.patch }
}

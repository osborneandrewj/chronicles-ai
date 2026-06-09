import type { Turn } from '@/domain/entities'
import type {
  BackgroundTasks,
  NarrationStream,
  TurnRepository,
  WorldRepository,
} from '@/domain/ports'
import { WorldNotFoundError } from '@/application/use-cases/load-history'

// AdvanceTurn (spec §3.5, §5.1-P5) — the turn pipeline carved out of the
// 593-line god endpoint. The route becomes a thin parse → execute → pipe
// adapter; this use case owns the load-bearing ordering, the two transaction
// boundaries, and the ex-closure variables as explicit local state.
//
// LOAD-BEARING INVARIANTS (do not "improve"):
//  - Player turn persists PRE-stream (fail-closed). Narrator + all factual /
//    post work persists POST-stream (fail-open).
//  - Pre-stream gates are the ONLY hard errors: WorldNotFound→404,
//    EmptyPlayerAction→400, BudgetExceeded→429. Everything post-stream
//    (reconciler, archivist, promotion, dedup, reverie) is best-effort
//    `console.error` + continue — never converted to a thrown domain error.
//  - The `dbTurnId` resolves via `completion`, which settles AFTER the UI
//    stream drains (the narrator adapter resolves it from its onFinish). The
//    route appends the metadata part after `completion` — the flush-after-
//    onFinish ordering the client depends on for TTS caching + per-turn cost.
//
// PARTIAL-CARVE BOUNDARY (honest green, spec §5.2 / task brief): the SDK
// (`streamText`) and the SQL-issuing pipeline steps are injected as functions
// the route wires — the apply-correction shape. `application/` stays
// import-clean (domain + node only). Two pieces stay route-wired and are
// tracked as remaining:
//   1. The pre-stream pipeline body (classify / geocode / npc-agent / occupancy
//      / reverie-flare / prompt render) — a dense SQL+SDK braid; carved as a
//      single `runPreStream` step that returns the prompt + the explicit state
//      the post-stream closure needs.
//   2. The fused `applyArchivistPatch` merge txn (the deferred NameResolution
//      MergePlan) — still applied inline by the injected post-stream step.

export { WorldNotFoundError }

export class EmptyPlayerActionError extends Error {
  constructor() {
    super('Empty player action')
    this.name = 'EmptyPlayerActionError'
  }
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly used: number,
    public readonly limit: number,
  ) {
    super('The shared daily LLM budget is spent. Try again after UTC midnight.')
    this.name = 'BudgetExceededError'
  }
}

// A pre-stream branch that short-circuits to a canned stream (meta-command or a
// replayed assistant turn) without spending a classifier/narrator/archivist
// cycle. The route renders the text into a UI message stream.
export type CannedResponse =
  | { kind: 'meta'; text: string }
  | { kind: 'replay'; turnId: number; text: string }

export type AdvanceTurnInput = {
  worldId: number
  playerText: string
  /** The incoming UIMessage history (for retry/replay dedup probes). */
  incomingMessages: Array<{ id?: string; role: string; text: string }>
}

// The narrator stream value (port type), specialized to resolve with the
// persisted narrator turn id the route appends as `dbTurnId` metadata.
export type NarratorStream = NarrationStream<number | undefined>

// Injected pipeline steps. The route (inbound adapter) wires the concrete
// `@/lib/*` + infra implementations so `application/` imports no SDK or SQL.
export type AdvanceTurnDeps = {
  worlds: WorldRepository
  turns: TurnRepository
  backgroundTasks: BackgroundTasks

  /** Daily shared cost cap (fail-closed pre-stream gate). */
  isOverDailyLimit: () => Promise<boolean>
  todaysTokens: () => Promise<number>
  dailyTokenLimit: () => number

  /** Meta-command detection + execution (pre-stream short-circuit). */
  isMetaCommand: (text: string) => boolean
  runMetaCommand: (text: string, worldId: number) => string

  /** Read the world's active scene id (the player turn is stamped with it). */
  activeSceneId: (worldId: number) => Promise<number | null>

  /**
   * The pre-stream pipeline body (classify → geocode → npc-agent → occupancy →
   * reverie-flare → prompt render), plus everything the post-stream closure
   * needs to do its factual work. SQL + SDK live here; the use case treats the
   * return as opaque carried state. The fused archivist merge txn stays inside
   * the post-stream callback this returns. Tracked as remaining (MergePlan).
   */
  buildNarration: (ctx: NarrationContext) => Promise<NarratorStream>
}

// What the use case hands the narration builder: the gated, deduped, player-
// turn-persisted context. `backgroundTasks` is threaded so the builder can
// register the post-stream archivist promise on it.
export type NarrationContext = {
  worldId: number
  playerText: string
  activeSceneId: number | null
  playerTurnId: number
  backgroundTasks: BackgroundTasks
}

export type AdvanceTurnResult =
  | { kind: 'canned'; response: CannedResponse }
  | { kind: 'stream'; stream: NarratorStream }

// Pre-stream dedup decision (mirrors the route's retry/replay logic exactly).
export function decideReplay(
  playerText: string,
  persistedLatestUserContent: string | null,
  latestPersistedTurn: Turn | null,
  persistedAssistant: Turn | null,
  incomingMessages: AdvanceTurnInput['incomingMessages'],
): { replay: boolean; insertUserTurn: boolean } {
  const latestUserAlreadyCompleted =
    persistedLatestUserContent === playerText &&
    latestPersistedTurn?.role === 'assistant' &&
    persistedAssistant?.id === latestPersistedTurn.id
  const incomingHasPersistedAssistant =
    persistedAssistant !== null &&
    incomingMessages.some(
      (msg) =>
        msg.role === 'assistant' &&
        (msg.id === String(persistedAssistant.id) ||
          msg.text.trim() === persistedAssistant.content.trim()),
    )

  // A completed retry replays the existing assistant turn rather than spending
  // another cycle — unless the incoming history already includes that assistant
  // (then the identical text is an intentional repeat).
  const replay =
    latestUserAlreadyCompleted && persistedAssistant !== null && !incomingHasPersistedAssistant

  // In-flight retry of the same user text with no assistant yet → don't
  // duplicate the user row. An intentional repeat (assistant already in the
  // incoming history) does insert a fresh user row.
  const intentionalRepeat =
    latestUserAlreadyCompleted && persistedAssistant !== null && incomingHasPersistedAssistant
  const insertUserTurn = persistedLatestUserContent !== playerText || intentionalRepeat

  return { replay, insertUserTurn }
}

export async function advanceTurn(
  { worldId, playerText, incomingMessages }: AdvanceTurnInput,
  deps: AdvanceTurnDeps,
): Promise<AdvanceTurnResult> {
  const { worlds, turns, backgroundTasks } = deps

  // ── Pre-stream fail-closed gates (the only hard errors) ──────────────────
  if (!(await worlds.getWorld(worldId))) {
    throw new WorldNotFoundError(worldId)
  }
  if (!playerText) {
    throw new EmptyPlayerActionError()
  }

  // Meta-command short-circuit — no LLM cycle.
  if (deps.isMetaCommand(playerText)) {
    return {
      kind: 'canned',
      response: { kind: 'meta', text: deps.runMetaCommand(playerText, worldId) },
    }
  }

  // Retry / replay dedup.
  const persistedLatestUserContent = await turns.latestUserContent(worldId)
  const latestPersistedTurn = await turns.latestTurn(worldId)
  const persistedAssistant = await turns.latestAssistantAfterLatestUser(worldId)
  const { replay, insertUserTurn } = decideReplay(
    playerText,
    persistedLatestUserContent,
    latestPersistedTurn,
    persistedAssistant,
    incomingMessages,
  )
  if (replay && persistedAssistant) {
    return {
      kind: 'canned',
      response: { kind: 'replay', turnId: persistedAssistant.id, text: persistedAssistant.content },
    }
  }

  // Daily shared cost cap — gated before any LLM call so an exhausted budget
  // never starts a stream we'd have to error mid-flight.
  if (await deps.isOverDailyLimit()) {
    throw new BudgetExceededError(await deps.todaysTokens(), deps.dailyTokenLimit())
  }

  // ── PRE-STREAM transaction boundary: persist the player turn (fail-closed) ─
  const activeSceneId = await deps.activeSceneId(worldId)
  if (insertUserTurn) {
    await turns.insert(worldId, 'user', playerText, activeSceneId)
  }
  // [t:N] provenance: the just-inserted player turn id (narrator turn doesn't
  // exist yet — the NPC agent runs pre-narrator).
  const playerTurnId = (await turns.latestUserTurnId(worldId)) ?? 0

  // ── Stream + POST-stream fail-open factual work (delegated, SQL+SDK) ──────
  const stream = await deps.buildNarration({
    worldId,
    playerText,
    activeSceneId,
    playerTurnId,
    backgroundTasks,
  })

  return { kind: 'stream', stream }
}

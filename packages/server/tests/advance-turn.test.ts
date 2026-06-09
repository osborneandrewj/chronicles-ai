import { describe, expect, it } from 'vitest'

import {
  advanceTurn,
  BudgetExceededError,
  EmptyPlayerActionError,
  WorldNotFoundError,
  decideReplay,
  type AdvanceTurnDeps,
  type NarrationContext,
  type NarratorStream,
} from '@/application/use-cases/advance-turn'
import type { Turn } from '@/domain/entities'
import type { BackgroundTasks, TurnRepository, WorldRepository } from '@/domain/ports'

// Use-case tests (spec §5.2) — AdvanceTurn against in-memory fake repos with no
// DB and no SDK. Asserts the load-bearing semantics:
//   - fail-closed: BudgetExceeded short-circuits PRE-stream (no player turn, no
//     stream) and maps to the budget domain error the route turns into 429.
//   - fail-open: the post-stream archivist throwing does NOT prevent the player
//     turn (pre-stream) or the narrator turn (post-stream) from persisting.

// ── Minimal Map-backed fakes ────────────────────────────────────────────────

class FakeTurnRepository {
  readonly turns: Turn[] = []
  private nextId = 1

  async insert(
    worldId: number,
    role: 'user' | 'assistant',
    content: string,
    sceneId: number | null = null,
  ): Promise<Turn> {
    const turn: Turn = {
      id: this.nextId++,
      world_id: worldId,
      role,
      content,
      scene_id: sceneId,
      created_at: '2026-06-04T00:00:00.000Z',
    }
    this.turns.push(turn)
    return turn
  }

  async latestUserContent(worldId: number): Promise<string | null> {
    const last = [...this.turns].reverse().find((t) => t.world_id === worldId && t.role === 'user')
    return last?.content ?? null
  }

  async latestTurn(worldId: number): Promise<Turn | null> {
    const last = [...this.turns].reverse().find((t) => t.world_id === worldId)
    return last ?? null
  }

  async latestAssistantAfterLatestUser(worldId: number): Promise<Turn | null> {
    const worldTurns = this.turns.filter((t) => t.world_id === worldId)
    const lastUserIdx = worldTurns.map((t) => t.role).lastIndexOf('user')
    const after = worldTurns.slice(lastUserIdx + 1).find((t) => t.role === 'assistant')
    return after ?? null
  }

  async latestUserTurnId(worldId: number): Promise<number | null> {
    const last = [...this.turns].reverse().find((t) => t.world_id === worldId && t.role === 'user')
    return last?.id ?? null
  }

  userTurns(worldId: number): Turn[] {
    return this.turns.filter((t) => t.world_id === worldId && t.role === 'user')
  }
  assistantTurns(worldId: number): Turn[] {
    return this.turns.filter((t) => t.world_id === worldId && t.role === 'assistant')
  }
}

class FakeBackgroundTasks {
  readonly registered: Promise<unknown>[] = []
  register(task: Promise<unknown>): void {
    this.registered.push(task)
  }
  async drain(): Promise<void> {
    await Promise.allSettled(this.registered)
  }
}

function fakeWorld(exists: boolean): WorldRepository {
  return {
    createBounded: async () => ({ id: 1 }),
    createOpen: async () => ({ id: 1 }),
    getWorld: async () => (exists ? ({ id: 1, premise: 'A test premise.' } as never) : null),
    listWorlds: async () => [],
    listArchivedWorlds: async () => [],
    archiveWorld: async () => {},
    unarchiveWorld: async () => {},
    cursor: async () => ({ world_time: null, current_scene_id: null }),
    setWorldTime: async () => {},
    setCursor: async () => {},
    setSettingRegion: async () => {},
  }
}

type BuildDepsOverrides = {
  worldExists?: boolean
  isOverDailyLimit?: boolean
  buildNarration?: (ctx: NarrationContext) => Promise<NarratorStream>
}

function buildDeps(
  turns: FakeTurnRepository,
  bg: FakeBackgroundTasks,
  o: BuildDepsOverrides = {},
): AdvanceTurnDeps {
  return {
    worlds: fakeWorld(o.worldExists ?? true),
    turns: turns as unknown as TurnRepository,
    backgroundTasks: bg as unknown as BackgroundTasks,
    isOverDailyLimit: async () => o.isOverDailyLimit ?? false,
    todaysTokens: async () => 12345,
    dailyTokenLimit: () => 50000,
    isMetaCommand: () => false,
    runMetaCommand: () => '',
    activeSceneId: () => null,
    buildNarration: o.buildNarration ?? (async () => emptyNarration()),
  }
}

function emptyNarration(): NarratorStream {
  return {
    chunks: new ReadableStream({ start: (c) => c.close() }),
    completion: Promise.resolve(undefined),
  }
}

const baseInput = { worldId: 1, playerText: 'I open the door.', incomingMessages: [] }

// ── Fail-closed pre-stream gates ────────────────────────────────────────────

describe('AdvanceTurn — fail-closed pre-stream gates', () => {
  it('throws WorldNotFoundError when the world is absent (no player turn persisted)', async () => {
    const turns = new FakeTurnRepository()
    const bg = new FakeBackgroundTasks()
    await expect(
      advanceTurn(baseInput, buildDeps(turns, bg, { worldExists: false })),
    ).rejects.toBeInstanceOf(WorldNotFoundError)
    expect(turns.turns).toHaveLength(0)
  })

  it('throws EmptyPlayerActionError on blank player text', async () => {
    const turns = new FakeTurnRepository()
    const bg = new FakeBackgroundTasks()
    await expect(
      advanceTurn({ ...baseInput, playerText: '' }, buildDeps(turns, bg)),
    ).rejects.toBeInstanceOf(EmptyPlayerActionError)
    expect(turns.turns).toHaveLength(0)
  })

  it('throws BudgetExceededError PRE-stream when over the daily cap (no turn, no stream)', async () => {
    const turns = new FakeTurnRepository()
    const bg = new FakeBackgroundTasks()
    let narrationCalled = false
    const deps = buildDeps(turns, bg, {
      isOverDailyLimit: true,
      buildNarration: async () => {
        narrationCalled = true
        return emptyNarration()
      },
    })
    const err = await advanceTurn(baseInput, deps).catch((e) => e)
    expect(err).toBeInstanceOf(BudgetExceededError)
    expect((err as BudgetExceededError).used).toBe(12345)
    expect((err as BudgetExceededError).limit).toBe(50000)
    // Fail-closed: the budget gate fires before any player turn or narrator call.
    expect(turns.turns).toHaveLength(0)
    expect(narrationCalled).toBe(false)
  })
})

// ── Fail-open post-stream ───────────────────────────────────────────────────

describe('AdvanceTurn — fail-open post-stream', () => {
  it('persists the player turn PRE-stream and the narrator turn POST-stream even when the archivist throws', async () => {
    const turns = new FakeTurnRepository()
    const bg = new FakeBackgroundTasks()

    // buildNarration models the real adapter: it persists the narrator turn in
    // its (post-stream) onFinish and registers a throwing archivist promise on
    // backgroundTasks — exactly the best-effort path that must not block.
    const buildNarration = async (ctx: NarrationContext): Promise<NarratorStream> => {
      // The player turn was already persisted by AdvanceTurn (pre-stream).
      expect(turns.userTurns(ctx.worldId)).toHaveLength(1)
      // POST-stream factual work: narrator turn persists; archivist throws but
      // is swallowed (registered, best-effort).
      await turns.insert(ctx.worldId, 'assistant', 'The door creaks open.', ctx.activeSceneId)
      const archivist = Promise.reject(new Error('archivist boom')).catch(() => {
        /* swallowed: fail-open */
      })
      ctx.backgroundTasks.register(archivist)
      return {
        chunks: new ReadableStream({ start: (c) => c.close() }),
        completion: Promise.resolve(2),
      }
    }

    const result = await advanceTurn(baseInput, buildDeps(turns, bg, { buildNarration }))
    expect(result.kind).toBe('stream')
    if (result.kind !== 'stream') throw new Error('expected stream')

    // completion still resolves with the persisted narrator turn id…
    await expect(result.stream.completion).resolves.toBe(2)
    // …and draining the registered archivist does not reject the use case.
    await expect(bg.drain()).resolves.toBeUndefined()

    // Both turns persisted despite the archivist failure (fail-open).
    expect(turns.userTurns(1).map((t) => t.content)).toEqual(['I open the door.'])
    expect(turns.assistantTurns(1).map((t) => t.content)).toEqual(['The door creaks open.'])
  })
})

// ── Pure dedup decision ─────────────────────────────────────────────────────

describe('AdvanceTurn — decideReplay (pure)', () => {
  const mkTurn = (id: number, role: 'user' | 'assistant', content: string): Turn => ({
    id,
    world_id: 1,
    role,
    content,
    scene_id: null,
    created_at: '',
  })

  it('replays a completed assistant when the same user text recurs and the assistant is not in incoming history', () => {
    const assistant = mkTurn(2, 'assistant', 'narration')
    const d = decideReplay('hello', 'hello', assistant, assistant, [])
    expect(d.replay).toBe(true)
  })

  it('does NOT replay (intentional repeat) when the assistant is already in the incoming history', () => {
    const assistant = mkTurn(2, 'assistant', 'narration')
    const d = decideReplay('hello', 'hello', assistant, assistant, [
      { id: '2', role: 'assistant', text: 'narration' },
    ])
    expect(d.replay).toBe(false)
    expect(d.insertUserTurn).toBe(true)
  })

  it('does not duplicate the user row on an in-flight retry (same text, no assistant yet)', () => {
    const userTurn = mkTurn(1, 'user', 'hello')
    const d = decideReplay('hello', 'hello', userTurn, null, [])
    expect(d.replay).toBe(false)
    expect(d.insertUserTurn).toBe(false)
  })

  it('inserts a fresh user row for new text', () => {
    const d = decideReplay('new action', 'old action', null, null, [])
    expect(d.insertUserTurn).toBe(true)
    expect(d.replay).toBe(false)
  })
})

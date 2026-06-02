# Reverie Creation Throttle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap NPC reveries at 3 and throttle minting with a deterministic cooldown so reveries become a small, slowly-evolving identity instead of a high-churn list.

**Architecture:** Lower `MAX_REVERIES_PER_NPC` to 3 (existing prune handles "replace weakest"). Add a deterministic creation gate in the NPC-agent path — a pure `canMintReverie` decision fed by a DB-backed `reverieMintState` (does the NPC have any reverie? how many world player-turns since it last minted one?) — allowing ≤1 new reverie per tick and only after a `REVERIE_COOLDOWN_TURNS` (15) gap. A one-time migration trims existing over-cap NPCs. Prompt text is a backup nudge only.

**Tech Stack:** TypeScript, raw `better-sqlite3` (prepared statements), Vitest. Branch: `fix/reverie-prose-leak` (bundled with the reverie prose-leak fix).

---

## File Structure

- `src/lib/reveries.ts` — **modify.** Lower the cap; add `REVERIE_COOLDOWN_TURNS`, pure `canMintReverie`, DB-backed `reverieMintState`, and two prepared statements. This file owns reverie storage + policy primitives.
- `src/lib/npc-agent.ts` — **modify.** Gate the `reveries_add` processing through `canMintReverie(reverieMintState(...))` and pass only the first item.
- `src/lib/migrations.ts` — **modify.** Append migration `version: 25` (`prune_reveries_to_three`).
- `prompts/npc-agent-system.md` — **modify.** Reword the reverie rule (backup nudge).
- `tests/reveries.test.ts` — **modify.** Tests for `canMintReverie`, `reverieMintState`, and the migration ranking.

---

## Task 1: Lower the cap to 3

**Files:**
- Modify: `src/lib/reveries.ts:3`
- Test: `tests/reveries.test.ts` (existing prune test uses the constant)

- [ ] **Step 1: Change the constant**

In `src/lib/reveries.ts`, line 3:

```typescript
export const MAX_REVERIES_PER_NPC = 3
```

- [ ] **Step 2: Run the existing prune test to confirm it still holds at 3**

Run: `npx vitest run tests/reveries.test.ts -t "prunes to MAX_REVERIES_PER_NPC"`
Expected: PASS (the test loops `MAX_REVERIES_PER_NPC + 2` inserts and asserts `toHaveLength(MAX_REVERIES_PER_NPC)`, so it tracks the constant — now 3).

- [ ] **Step 3: Commit**

```bash
git add src/lib/reveries.ts
git commit -m "feat: cap reveries at 3 per NPC (was 6)"
```

---

## Task 2: `REVERIE_COOLDOWN_TURNS` + pure `canMintReverie`

**Files:**
- Modify: `src/lib/reveries.ts` (add near `MAX_REVERIES_PER_NPC`)
- Test: `tests/reveries.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/reveries.test.ts` (add `REVERIE_COOLDOWN_TURNS` and `canMintReverie` to the existing `@/lib/reveries` import):

```typescript
describe('canMintReverie', () => {
  it('allows the first reverie when the NPC has none', () => {
    expect(canMintReverie({ hasAny: false, playerTurnsSinceLast: 0 })).toBe(true)
  })
  it('blocks a new reverie within the cooldown window', () => {
    expect(canMintReverie({ hasAny: true, playerTurnsSinceLast: REVERIE_COOLDOWN_TURNS - 1 })).toBe(false)
  })
  it('allows a new reverie once the cooldown has elapsed', () => {
    expect(canMintReverie({ hasAny: true, playerTurnsSinceLast: REVERIE_COOLDOWN_TURNS })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reveries.test.ts -t canMintReverie`
Expected: FAIL — `canMintReverie` / `REVERIE_COOLDOWN_TURNS` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/reveries.ts`, just below `export const MAX_REVERIES_PER_NPC = 3`:

```typescript
// v0.6.x: how many of this world's player turns must pass between an NPC
// minting one reverie and the next. Deterministic rate throttle; the agent
// prompt's "rarely" is only a nudge. Tunable.
export const REVERIE_COOLDOWN_TURNS = 15

// Pure decision: may this NPC mint a new reverie this tick? The first one (no
// reveries yet) is always free; afterwards a full cooldown must have elapsed.
export function canMintReverie(
  state: { hasAny: boolean; playerTurnsSinceLast: number },
  cooldown = REVERIE_COOLDOWN_TURNS,
): boolean {
  return !state.hasAny || state.playerTurnsSinceLast >= cooldown
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reveries.test.ts -t canMintReverie`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reveries.ts tests/reveries.test.ts
git commit -m "feat: canMintReverie cooldown decision + REVERIE_COOLDOWN_TURNS"
```

---

## Task 3: `reverieMintState` (DB-backed inputs for the gate)

Computes `hasAny` and `playerTurnsSinceLast` for an NPC. `playerTurnsSinceLast` is the count of this world's player (`role='user'`) turns inserted after the NPC's most recent minted reverie. If the NPC has no reverie carrying a `created_turn_id` (none, or only backfilled rows whose `created_turn_id` is NULL), treat it as "long ago" (`Infinity`) so the gate allows minting.

**Files:**
- Modify: `src/lib/reveries.ts` (add statements near the other `db.prepare(...)` block, and the function near `addReveriesForCharacter`)
- Test: `tests/reveries.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/reveries.test.ts` (import `reverieMintState` from `@/lib/reveries`, `db` and `insertTurn` from `@/lib/db`, and `createWorld` from `@/lib/worlds`; reuse whatever the file already imports):

```typescript
describe('reverieMintState', () => {
  it('reports no reveries for a fresh NPC', () => {
    const world = createWorld({
      name: 'Mint State A',
      premise: 'Test.',
      initialState: { time: 'Day', location: 'Room', identity: 'X', playerName: 'P' },
    })
    const charId = db
      .prepare(`INSERT INTO characters (world_id, name, is_player, status) VALUES (?, 'Nyx', 0, 'active')`)
      .run(world.id).lastInsertRowid as number
    expect(reverieMintState(world.id, charId)).toEqual({ hasAny: false, playerTurnsSinceLast: Number.POSITIVE_INFINITY })
  })

  it('counts world player-turns since the NPC last minted a reverie', () => {
    const world = createWorld({
      name: 'Mint State B',
      premise: 'Test.',
      initialState: { time: 'Day', location: 'Room', identity: 'X', playerName: 'P' },
    })
    const charId = db
      .prepare(`INSERT INTO characters (world_id, name, is_player, status) VALUES (?, 'Nyx', 0, 'active')`)
      .run(world.id).lastInsertRowid as number
    const mintTurn = insertTurn(world.id, 'assistant', 'narration', null)
    addReveriesForCharacter(world.id, charId, [{ text: 'a smell of rain' }], mintTurn.id)
    // Two player turns occur after the reverie was minted.
    insertTurn(world.id, 'user', 'p1', null)
    insertTurn(world.id, 'user', 'p2', null)
    const state = reverieMintState(world.id, charId)
    expect(state.hasAny).toBe(true)
    expect(state.playerTurnsSinceLast).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reveries.test.ts -t reverieMintState`
Expected: FAIL — `reverieMintState` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/reveries.ts`, add these prepared statements in the `// ---- DB access ----` block (near the other `db.prepare(...)` definitions):

```typescript
const reverieMintInfoStmt = db.prepare<[number]>(
  'SELECT MAX(created_turn_id) AS lastTurn, COUNT(*) AS n FROM npc_reveries WHERE character_id = ?',
)
const playerTurnsSinceStmt = db.prepare<[number, number]>(
  "SELECT COUNT(*) AS n FROM turns WHERE world_id = ? AND role = 'user' AND id > ?",
)
```

And add this exported function (near `addReveriesForCharacter`):

```typescript
// Inputs for canMintReverie. playerTurnsSinceLast is the number of this world's
// player turns inserted after the NPC's most recent minted reverie; Infinity
// when the NPC has no reverie carrying a created_turn_id (none, or only
// backfilled rows) so the cooldown does not block the next mint.
export function reverieMintState(
  worldId: number,
  characterId: number,
): { hasAny: boolean; playerTurnsSinceLast: number } {
  const info = reverieMintInfoStmt.get(characterId) as { lastTurn: number | null; n: number }
  const hasAny = info.n > 0
  if (info.lastTurn === null) {
    return { hasAny, playerTurnsSinceLast: Number.POSITIVE_INFINITY }
  }
  const since = playerTurnsSinceStmt.get(worldId, info.lastTurn) as { n: number }
  return { hasAny, playerTurnsSinceLast: since.n }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reveries.test.ts -t reverieMintState`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reveries.ts tests/reveries.test.ts
git commit -m "feat: reverieMintState — DB inputs for the reverie cooldown gate"
```

---

## Task 4: Gate minting in the NPC agent

**Files:**
- Modify: `src/lib/npc-agent.ts:15` (import) and `:626-628` (the `reveries_add` processing)
- Test: existing `tests/npc-agent.test.ts` (regression — must stay green)

- [ ] **Step 1: Update the import**

In `src/lib/npc-agent.ts:15`, change:

```typescript
import { addReveriesForCharacter, getReveriesForCharacters } from '@/lib/reveries'
```

to:

```typescript
import {
  addReveriesForCharacter,
  canMintReverie,
  getReveriesForCharacters,
  reverieMintState,
} from '@/lib/reveries'
```

- [ ] **Step 2: Gate the processing**

Replace `src/lib/npc-agent.ts:626-628`:

```typescript
      if (u.reveries_add !== undefined && u.reveries_add.length > 0) {
        addReveriesForCharacter(worldId, existing.id, u.reveries_add, narratorTurnId)
      }
```

with:

```typescript
      if (u.reveries_add !== undefined && u.reveries_add.length > 0) {
        // v0.6.x: throttle creation — at most one new reverie per tick, and only
        // once the per-NPC cooldown has elapsed. Deterministic; the prompt's
        // "rarely" is just a nudge. addReveriesForCharacter still dedups + caps.
        if (canMintReverie(reverieMintState(worldId, existing.id))) {
          addReveriesForCharacter(worldId, existing.id, [u.reveries_add[0]], narratorTurnId)
        }
      }
```

- [ ] **Step 3: Run the agent suite to confirm no regression**

Run: `npx vitest run tests/npc-agent.test.ts`
Expected: PASS (all). If a test asserted that multiple reveries are added in one tick or that a reverie is added regardless of cooldown, update it to reflect the new throttle (≤1 per tick, cooldown-gated) — note any such change in the commit body.

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/npc-agent.ts
git commit -m "feat: throttle reverie minting in NPC agent (<=1/tick, cooldown-gated)"
```

---

## Task 5: Migration 25 — trim existing NPCs to the new cap

**Files:**
- Modify: `src/lib/migrations.ts` (append after the `version: 24` migration object)
- Test: `tests/reveries.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/reveries.test.ts` (imports: `db` from `@/lib/db`, `createWorld` from `@/lib/worlds`, `getReveriesForCharacter` from `@/lib/reveries`). The test exercises the migration's exact prune SQL against a seeded over-cap NPC. Replicate the migration's ranked-delete so the assertion is independent of startup ordering:

```typescript
describe('migration 25 prune_reveries_to_three (ranked delete)', () => {
  it('keeps the top 3 by intensity, then recency of flaring, then newest', () => {
    const world = createWorld({
      name: 'Prune25',
      premise: 'Test.',
      initialState: { time: 'Day', location: 'Room', identity: 'X', playerName: 'P' },
    })
    const charId = db
      .prepare(`INSERT INTO characters (world_id, name, is_player, status) VALUES (?, 'Vex', 0, 'active')`)
      .run(world.id).lastInsertRowid as number
    const ins = db.prepare(
      `INSERT INTO npc_reveries (world_id, character_id, text, match_tags, intensity, last_flared_turn_id)
       VALUES (?, ?, ?, '', ?, ?)`,
    )
    ins.run(world.id, charId, 'r-weakest', 0.1, null)
    ins.run(world.id, charId, 'r-mid-old', 0.5, 10)
    ins.run(world.id, charId, 'r-mid-new', 0.5, 20)
    ins.run(world.id, charId, 'r-strong', 0.9, null)
    ins.run(world.id, charId, 'r-mid-mid', 0.5, 15)

    // Exact prune SQL the migration runs.
    const ranked = db
      .prepare(
        `SELECT id FROM npc_reveries WHERE character_id = ?
         ORDER BY intensity DESC, COALESCE(last_flared_turn_id, -1) DESC, id DESC`,
      )
      .all(charId) as Array<{ id: number }>
    const del = db.prepare('DELETE FROM npc_reveries WHERE id = ?')
    for (const { id } of ranked.slice(3)) del.run(id)

    const kept = getReveriesForCharacter(charId).map((r) => r.text).sort()
    expect(kept).toEqual(['r-mid-mid', 'r-mid-new', 'r-strong'])
  })
})
```

(Ranking: `r-strong` 0.9 wins; then among the 0.5s, higher `last_flared_turn_id` first → `r-mid-new` (20), `r-mid-mid` (15), `r-mid-old` (10); top-3 kept = strong, mid-new, mid-mid. `r-weakest` 0.1 and `r-mid-old` dropped.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reveries.test.ts -t "prune_reveries_to_three"`
Expected: FAIL (the seeded NPC starts with 5 reveries; before the prune block the assertion of exactly 3 specific texts fails — confirm the ranked delete is what produces the pass, i.e. the test fails if you remove the delete loop). If it passes without the delete loop, the seed is wrong — fix the seed.

- [ ] **Step 3: Add the migration**

In `src/lib/migrations.ts`, append this object immediately after the `version: 24` (`npc_reveries_and_daily_loop`) migration object (mind the trailing comma on the preceding object):

```typescript
  {
    // v0.6.x — reverie cap lowered 6 → 3. Trim every character already over the
    // cap down to its top 3 by the same ranking the app's pruneReveriesForCharacter
    // uses: intensity desc, then most-recently-flared desc, then newest id desc.
    version: 25,
    name: 'prune_reveries_to_three',
    up: (db) => {
      const overCap = db
        .prepare(
          'SELECT character_id FROM npc_reveries GROUP BY character_id HAVING COUNT(*) > 3',
        )
        .all() as Array<{ character_id: number }>
      const rankedFor = db.prepare(
        `SELECT id FROM npc_reveries WHERE character_id = ?
         ORDER BY intensity DESC, COALESCE(last_flared_turn_id, -1) DESC, id DESC`,
      )
      const del = db.prepare('DELETE FROM npc_reveries WHERE id = ?')
      for (const { character_id } of overCap) {
        const ids = (rankedFor.all(character_id) as Array<{ id: number }>).map((r) => r.id)
        for (const id of ids.slice(3)) del.run(id)
      }
    },
  },
```

- [ ] **Step 4: Run the full migrations + reveries suites**

Run: `npx vitest run tests/migrations.test.ts tests/reveries.test.ts`
Expected: PASS. (`migrations.test.ts` validates the migration list applies cleanly; if it asserts a migration count or latest version, bump that assertion to include version 25.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/migrations.ts tests/reveries.test.ts
git commit -m "feat: migration 25 — prune existing NPCs to reverie cap of 3"
```

---

## Task 6: Prompt nudge (backup, not the enforcement)

**Files:**
- Modify: `prompts/npc-agent-system.md` (the reverie bullet ~line 24, and the `reveries_add` list entry ~line 73)
- Modify: `src/lib/npc-agent.ts` (the `reveries_add` zod `.describe(...)` at ~line 68-71)

- [ ] **Step 1: Reword the prompt bullet**

In `prompts/npc-agent-system.md`, in the `**Reveries are charged memory**` bullet (~line 24), change the sentence "Use `reveries_add` to add a NEW reverie only when something genuinely lodges (rarely)." to:

```markdown
Use `reveries_add` at most ONCE in a long while — only when a genuinely defining, first-time memory lodges. An NPC carries at most 3 reveries total, and most ticks add none; the system enforces a long cooldown between new ones, so don't reach for it.
```

- [ ] **Step 2: Reword the schema-field description**

In `src/lib/npc-agent.ts`, the `reveries_add` `.describe(...)` (~line 68-71), replace the description string with:

```typescript
      'Add a NET-NEW reverie only — never repeat existing ones, they persist on their own. ' +
        'A reverie is a charged sensory/emotional memory; tag each with concrete anchors ' +
        '(a smell, an object, a place, a phrase, a failure). Add one very rarely: an NPC holds at ' +
        'most 3, and the system enforces a long cooldown, so most ticks add none.',
```

- [ ] **Step 3: Type-check + run prompt-dependent suites**

Run: `npm run type-check && npx vitest run tests/npc-agent.test.ts tests/prompts.test.ts`
Expected: clean + PASS.

- [ ] **Step 4: Commit**

```bash
git add prompts/npc-agent-system.md src/lib/npc-agent.ts
git commit -m "docs: reverie prompt nudge — at most 3, cooldown-enforced (backup)"
```

---

## Final verification

- [ ] `npm run lint && npm run type-check` → clean.
- [ ] `npm test` → full suite green.
- [ ] Confirm `MAX_REVERIES_PER_NPC` reads `3` and the migration list ends at `version: 25`.

---

## Self-Review (completed by plan author)

**Spec coverage:** cap=3 → Task 1; cooldown decision → Task 2; cooldown inputs → Task 3; ≤1/tick + gate wiring → Task 4; retroactive prune (migration) → Task 5; prompt nudge → Task 6. `addReveriesForCharacter` stays pure (untouched) — replace-weakest at cap is its existing add-then-prune behavior, now bounded at 3 by Task 1.

**Placeholder scan:** every code step shows complete code; the only conditional guidance (migration-count assertion in `migrations.test.ts`, any npc-agent test asserting multi-add) points at the exact assertion to adjust rather than inventing a divergent fixture.

**Type/name consistency:** `canMintReverie({ hasAny, playerTurnsSinceLast }, cooldown?)`, `reverieMintState(worldId, characterId) → { hasAny, playerTurnsSinceLast }`, and `REVERIE_COOLDOWN_TURNS` are used identically across Tasks 2–4. Prepared-statement names (`reverieMintInfoStmt`, `playerTurnsSinceStmt`) are introduced and used only in Task 3. The migration ranking SQL in Task 5's test matches the migration body verbatim.

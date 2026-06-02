# Reverie creation: cap 3 + cooldown-throttled minting

**Status:** design approved (brainstorming), pre-implementation-plan.
**Branch:** `fix/reverie-prose-leak` (bundled with the reverie prose-leak fix; ships together).
**Problem:** NPC reveries are created too often (too many held, and minted nearly every tick → churn). Reveries should be a small, slowly-evolving identity, not a high-churn list.

## Goal

- Cap reveries at **3 per NPC** (down from 6).
- Throttle minting deterministically so new reveries are rare and paced — not reliant on the Haiku agent obeying "add rarely."
- Allow slow evolution: at the cap, an eligible new reverie replaces the weakest; below the cap, it's added — but only after a cooldown.

## Decisions (locked during brainstorming)

1. **Cap = 3.** `MAX_REVERIES_PER_NPC` 6 → 3.
2. **Both count and rate** are throttled.
3. **Cooldown, not freeze:** an NPC keeps evolving across a long game; it does not freeze after its first 3.
4. **Deterministic** gate in code; the prompt is only a backup nudge.

## Mechanic

### 1. Cap (`src/lib/reveries.ts`)
`MAX_REVERIES_PER_NPC = 3`. The existing `pruneReveriesForCharacter` ranking (intensity ↓ → most-recently-flared ↓ → newest ↓) already enforces the cap and the "replace weakest" behavior when a 4th is added then pruned.

### 2. Rate throttle (`src/lib/npc-agent.ts`, in the `reveries_add` processing path)
Before persisting, gate creation:

- **≤ 1 new reverie per NPC per tick** — take the first valid `reveries_add` item; ignore any others that tick.
- **Cooldown** — mint only if the NPC has not minted within the last `REVERIE_COOLDOWN_TURNS` (default **15**) *player turns of this world*:
  - `lastReverieTurnId = max(created_turn_id)` across the NPC's reveries (null if none).
  - Allowed iff `lastReverieTurnId === null` (NPC has none yet — first reverie is free) **or** `playerTurnsSince ≥ 15`, where `playerTurnsSince = COUNT(turns WHERE world_id = ? AND role = 'user' AND id > lastReverieTurnId)`.
- The cooldown paces both initial accumulation (an NPC fills to 3 over time, not in three straight ticks) and later evolution.

The decision is a **pure helper** for unit-testing:
```
canMintReverie({ hasAny: boolean, playerTurnsSinceLast: number }, cooldown = REVERIE_COOLDOWN_TURNS): boolean
  → !hasAny || playerTurnsSinceLast >= cooldown
```
`npc-agent.ts` computes `hasAny` / `playerTurnsSinceLast` (the COUNT query) and, if allowed, passes exactly one reverie to `addReveriesForCharacter`.

### 3. Persistence stays pure (`addReveriesForCharacter`)
Unchanged responsibilities: dedup by normalized text, clamp intensity, insert, prune to `MAX_REVERIES_PER_NPC`. At the cap, adding one then pruning evicts the weakest = "replace weakest." No cooldown logic here (keeps it reusable by repoint/backfill/tests).

### 4. Retroactive cap (new migration, appended after `npc_reveries_and_daily_loop`)
Name: `prune_reveries_to_three`. For every character with > 3 reveries, delete all but the top 3 by the same ranking used in `pruneReveriesForCharacter` (intensity ↓, last_flared_turn_id ↓, id ↓). Deterministic; runs once on deploy so existing prod NPCs honor the new cap.

### 5. Prompt nudge (backup) — `prompts/npc-agent-system.md` + `reveries_add` schema text
Reword to: "an NPC carries at most 3 reveries; add a new one only rarely — when a genuinely defining, first-time memory lodges. Most ticks add none." This reduces wasted emissions; it is NOT the enforcement (the deterministic gate is).

## Testing

- **Pure:** `canMintReverie` — first reverie free (`hasAny=false`); blocked within cooldown; allowed at/after cooldown.
- **DB:** the `playerTurnsSince` count query returns the number of this-world player turns after a given turn id.
- **Cap:** `reveries.test.ts` prune test already uses `MAX_REVERIES_PER_NPC` — stays green at 3 (no edit needed beyond the constant).
- **Migration:** seed a character with 5 reveries (varied intensity), run the migration, assert exactly the top 3 by ranking remain.
- **Agent integration (light):** within cooldown, a `reveries_add` emission is dropped; with no prior reveries, one is accepted; ≥2 emitted in one tick → only 1 persisted.

## Out of scope

- Changing how match_tags / intensity are authored (separate concern).
- `is_cornerstone` / awakening-driven evolution (Stage B).
- The reverie prose-leak fix (already committed on this branch).

## Notes / accepted trade-offs

- Cooldown is measured in **world player-turns**, which slightly *over*-counts vs the NPC's own agent ticks (it doesn't tick every turn) — erring toward *less* frequent, which is the goal.
- `REVERIE_COOLDOWN_TURNS` is a named constant, easy to tune.
- An NPC fills to 3 over roughly `2 × cooldown` player-turns, then evolves at ≥ cooldown spacing.

## "Done"

`npm run lint` + `type-check` clean; full suite green incl. new tests; the new migration applies cleanly and trims an over-cap NPC; `MAX_REVERIES_PER_NPC` reads 3.

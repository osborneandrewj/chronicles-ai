# World 13 Intent-Layer Investigation (Stage-B Gate)

**Date:** 2026-05-31  
**Branch:** chore/copy-world-and-design-notes  
**Scope:** Read-only diagnostic — no code modified.

---

## 1. Exact trigger condition for `insertNpcIntent`

`insertNpcIntent` (`src/lib/npc-intents.ts:73`) is called from `runNpcAgentTick`
(`src/lib/npc-agent.ts:512`) only after **all** of the following gates open:

### Gate A — `shouldTickNpcAgent` (route.ts:522–531)

```
// src/app/api/chat/route.ts:522–531
function shouldTickNpcAgent(stance, inputMode, state): boolean {
  if (inputMode !== 'in-character' || stance === 'meta' || stance === 'think') return false
  if (stance === 'do' || stance === 'say') return true
  return state.presentCharacters.some(
    (c) => c.is_player !== 1 && (c.agency_level === 'local' || c.agency_level === 'nearby'),
  )
}
```

The NPC agent tick is entirely skipped when:
- `input_mode !== 'in-character'` (classifier short-circuits everything), OR
- `stance === 'meta'` or `'think'`

It fires unconditionally (regardless of present NPCs) only when `stance === 'do'` or `'say'`.
For any other `in-character` stance it fires only if at least one non-player character with
`agency_level = 'local'` or `'nearby'` is present with the protagonist.

### Gate B — agent NPC query filter (npc-agent.ts:281–302)

```
// src/lib/npc-agent.ts:281–302
const agentNpcsStmt = db.prepare(`
  SELECT ...
    FROM characters c
   WHERE c.world_id = ?
     AND c.agency_level IN ('local', 'nearby', 'distant', 'agent')
     AND c.is_player = 0
     AND c.status != 'dead'
     AND (
       c.agency_level IN ('local', 'agent')
       OR c.last_agent_tick_turn_id IS NULL
       OR (c.agency_level = 'nearby' AND ? - c.last_agent_tick_turn_id >= 2)
       OR (c.agency_level = 'distant' AND ? - c.last_agent_tick_turn_id >= 5)
       OR (? - c.last_agent_tick_turn_id >= 5)
     )
`)
```

Only characters with `agency_level IN ('local','nearby','distant','agent')` and
`status != 'dead'` are fetched. If the query returns zero rows, `runNpcAgentTick`
returns `null` at line 346 before touching any intents.

### Gate C — routine-tick skip filter (npc-agent.ts:379–391)

```
// src/lib/npc-agent.ts:243–252, applied at 379–391
export function shouldSkipRoutineTick(npc, priorNarration): boolean {
  if (npc.present_with_protagonist) return false
  if (npc.in_transit_to_place_id !== null) return false
  if (!npc.daily_loop || npc.daily_loop.trim().length === 0) return false
  if (priorNarration.toLowerCase().includes(npc.name.toLowerCase())) return false
  return true
}
```

Off-scene NPCs that already have a `daily_loop`, are not in transit, and were not
mentioned in the prior narration are removed from the `tickable` set. If the entire
`tickable` array is empty after this filter, `runNpcAgentTick` returns `null` again
(line 391) and no intents are inserted.

### Gate D — `planned_actions` non-empty (npc-agent.ts:503–525)

Even when the LLM call fires, `insertNpcIntent` is only reached for entries in
`object.planned_actions`. The LLM may return an empty array (especially for turns
with no present agent-tier NPCs). Only plans whose `npc_name` resolves to a known
agent NPC in the `tickable` set are persisted.

### Summary of the full call chain

```
POST /api/chat
  → shouldTickNpcAgent() [Gate A]  — returns false → no tick, zero intents
  → runNpcAgentTick()
      → agentNpcsStmt.all()        [Gate B]  — zero rows → return null
      → tickable = agents.filter() [Gate C]  — all skipped → return null
      → generateObject (LLM call)
      → for plan of planned_actions [Gate D] — empty array → zero inserts
          → insertNpcIntent()       ← THE ONLY WRITE PATH
```

---

## 2. Whether the intent layer fires on a normally-created world

Yes. On a world created and played live, the full pipeline executes on the very first
turn where a player makes a `do` or `say` action **if** any character has
`agency_level IN ('local','nearby','distant','agent')`. The NPC-promotion subsystem
(`recordAppearancesAndAutoPromote`, called at route.ts:192) upgrades recurring NPCs
from `passive npc` to `local` tier as they appear in scenes, so agency tiers are
populated organically during live play. A live-played world therefore begins
accumulating `npc_intents` rows once any NPC has been promoted to agent-tier and
the player takes an in-character `do`/`say` action.

---

## 3. Why world 13 has zero rows in `npc_intents`

World 13 ("The Violet Exchange") was imported into production via
`scripts/copy-world.mjs`. The script's `worldScopedTables()` function (line 46–58)
dynamically collects all tables that have a `world_id` column:

```javascript
// scripts/copy-world.mjs:46–58
function worldScopedTables(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ...")
    .all().map((t) => t.name)
  const scoped = ['worlds']
  for (const t of tables) {
    if (t === 'worlds' || SKIP_TABLES.has(t)) continue
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
    if (cols.includes('world_id')) scoped.push(t)
  }
  return scoped
}
```

`npc_intents` **does** have a `world_id` column, so it IS included in the export.
However the source world (world 10 on the dev machine, before import to prod) had
zero `npc_intents` rows to copy — the table was either empty at export time or the
NPC-agent feature was not yet merged when the world was last played locally.

The root cause is that **world 13 has never had a live turn run through the current
production code** since being imported. `npc_intents` rows are only created at
runtime via `insertNpcIntent`; they are not synthesised retroactively for historical
turns. All of world 13's turns pre-date the living-NPCs merge (v0.6.18, commit
`e0d74d5`), and therefore passed through the pre-agent chat route which had no
`npc_intents` write path. Once a player sends a new `do` or `say` turn in world 13,
the code will generate intents normally, assuming at least one character has been
promoted to an agent-level tier.

---

## 4. VERDICT

**Intent layer healthy (world-13 zero rows = import artifact)**

The `npc_intents` write path is structurally correct and reachable on every normally-
played turn that passes all four gates. World 13's empty table is a consequence of
(a) the world being imported via `copy-world.mjs` from a snapshot that predates the
living-NPCs v0.6.18 merge, and (b) no live turns having been taken in that world
since the import. The table will populate as soon as a real player action flows
through the current route. The intent layer is a valid Stage-B prerequisite — it is
not broken and requires no fix before the next milestone can begin.

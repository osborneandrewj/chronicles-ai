# Character Dedup Prevention (v0.6.15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the archivist from creating a duplicate `characters` row when a descriptor-named NPC reveals a proper name, using defense-in-depth (better context, a deterministic detector, a dedicated rename channel) — flag-only, no auto-merge.

**Architecture:** Three layers on the existing archivist pipeline: (1) mark descriptor placeholders in the archivist's prior-state context; (2) a pure `findLikelyDuplicateCharacters` detector surfaced in the inspector, chat-route logs, and the merge script; (3) a `reveals_name_of` patch field that routes into the existing tested `runAliasMerges`. No migration, no persistence, no automatic merging.

**Tech Stack:** TypeScript, Next.js 15, better-sqlite3, Vercel AI SDK + Zod, Vitest, React (inspector). Versioned to v0.6.15.

**Spec:** `docs/superpowers/specs/2026-05-29-character-dedup-prevention-design.md`

**Conventions:** 2-space indent, single quotes, no semicolons, named imports. Tests live in `tests/<module>.test.ts`. Each test seeds its own world on the shared in-memory db (worlds isolate; the singleton is never reset). Run a single file with `npx vitest run tests/<file>.test.ts`.

---

### Task 1: Create the v0.6.15 release branch

**Files:** none (branch only)

- [ ] **Step 1: Branch off the up-to-date main**

```bash
git switch main
git pull --ff-only origin main
git switch -c release/v0.6.15
```

- [ ] **Step 2: Confirm clean baseline**

Run: `npm run type-check && npx vitest run`
Expected: type-check clean; all tests pass (210 at time of writing).

---

### Task 2: `isDescriptorName` + `nameKey` helpers (Layer 1/2 shared)

**Files:**
- Create: `src/lib/character-identity.ts`
- Test: `tests/character-identity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/character-identity.test.ts
import { describe, expect, it } from 'vitest'

import { isDescriptorName, nameKey } from '@/lib/character-identity'

describe('isDescriptorName', () => {
  it('flags article-led descriptor/title placeholders', () => {
    expect(isDescriptorName('The Attendant at the Gates')).toBe(true)
    expect(isDescriptorName('the bartender')).toBe(true)
    expect(isDescriptorName('A Man in a High-Vis Vest')).toBe(true)
  })

  it('does not flag proper names or mononyms', () => {
    expect(isDescriptorName('Jérôme Moreau')).toBe(false)
    expect(isDescriptorName('Marcus')).toBe(false)
    expect(isDescriptorName('')).toBe(false)
  })
})

describe('nameKey', () => {
  it('normalizes articles/punctuation/case for comparison', () => {
    expect(nameKey('The Anchor, Tavern')).toBe('anchor tavern')
    expect(nameKey('Jérôme Moreau')).toBe('jérôme moreau')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/character-identity.test.ts`
Expected: FAIL — cannot resolve `@/lib/character-identity`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/character-identity.ts

// Descriptor/title placeholders the archivist mints for unnamed figures always
// lead with an article ("The Attendant at the Gates", "the bartender", "A Man in
// a High-Vis Vest"). Proper names ("Jérôme Moreau") and mononyms ("Marcus") do
// not. Leading-article detection is high-precision for that generated pattern.
const ARTICLE_RE = /^(the|a|an)\s+/i

export function isDescriptorName(name: string): boolean {
  return ARTICLE_RE.test(name.trim())
}

// Loose comparison key: lowercase, drop punctuation and stop-words, collapse
// whitespace. Used to spot near-identical names. (Note: keeps non-ASCII letters
// so accented names stay distinct.)
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\b(the|a|an|of|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/character-identity.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/character-identity.ts tests/character-identity.test.ts
git commit -m "feat(v0.6.15): isDescriptorName + nameKey character-identity helpers"
```

---

### Task 3: `findLikelyDuplicateCharacters` detector (Layer 2, pure)

**Files:**
- Create: `src/lib/character-dedup.ts`
- Test: `tests/character-dedup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/character-dedup.test.ts
import { describe, expect, it } from 'vitest'

import { findLikelyDuplicateCharacters } from '@/lib/character-dedup'
import type { Character } from '@/lib/db'

// Minimal Character factory — only the fields the detector reads matter; cast
// through unknown so we don't have to fill every column.
function ch(over: Partial<Character>): Character {
  return {
    id: 0, world_id: 1, name: 'X', is_player: 0, current_place_id: null,
    status: 'active', memorable_facts: null, observations: null,
    ...over,
  } as unknown as Character
}

describe('findLikelyDuplicateCharacters', () => {
  it('flags a descriptor + named pair at the same place', () => {
    const chars = [
      ch({ id: 61, name: 'The Attendant at the Gates', current_place_id: 35 }),
      ch({ id: 62, name: 'Jérôme Moreau', current_place_id: 35 }),
    ]
    const pairs = findLikelyDuplicateCharacters(chars)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ aId: 61, bId: 62, reason: 'descriptor + named at same place' })
  })

  it('does NOT flag two distinct proper-named NPCs at the same place', () => {
    const chars = [
      ch({ id: 1, name: 'Marco Reeves', current_place_id: 35 }),
      ch({ id: 2, name: 'Anaïs Bonnet', current_place_id: 35 }),
    ]
    expect(findLikelyDuplicateCharacters(chars)).toHaveLength(0)
  })

  it('flags a pair that shares a distinctive memorable fact', () => {
    const fact = 'carries Jérôme Moreau key ring including a vehicle fob [t:454]'
    const chars = [
      ch({ id: 1, name: 'Andrew', current_place_id: 1, memorable_facts: fact }),
      ch({ id: 2, name: 'Andy', current_place_id: 9, observations: fact }),
    ]
    const pairs = findLikelyDuplicateCharacters(chars)
    expect(pairs.some((p) => p.reason === 'shared memorable fact')).toBe(true)
  })

  it('excludes the player and dead characters', () => {
    const chars = [
      ch({ id: 1, name: 'The Player Ghost', is_player: 1, current_place_id: 5 }),
      ch({ id: 2, name: 'Alice', current_place_id: 5 }),
      ch({ id: 3, name: 'The Corpse', current_place_id: 5, status: 'dead' }),
    ]
    expect(findLikelyDuplicateCharacters(chars)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/character-dedup.test.ts`
Expected: FAIL — cannot resolve `@/lib/character-dedup`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/character-dedup.ts
import { isDescriptorName, nameKey } from '@/lib/character-identity'
import type { Character } from '@/lib/db'

export type DuplicatePair = {
  aId: number
  bId: number
  aName: string
  bName: string
  reason: string
}

// Ignore short/boilerplate lines so "has a daughter" doesn't false-match.
const FACT_MIN_LEN = 25

function distinctiveLines(text: string | null): Set<string> {
  if (!text) return new Set()
  return new Set(
    text
      .split('\n')
      .map((l) => l.replace(/\s*\[t:\d+\]\s*$/, '').trim().toLowerCase())
      .filter((l) => l.length >= FACT_MIN_LEN),
  )
}

// Recall-favoring duplicate detector. Review-only: a few false positives are
// acceptable (a human confirms before any merge); a miss is not. Pure — takes
// rows, returns candidate pairs.
export function findLikelyDuplicateCharacters(chars: Character[]): DuplicatePair[] {
  const active = chars.filter((c) => c.is_player === 0 && c.status !== 'dead')
  const pairs: DuplicatePair[] = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      let reason: string | null = null

      // (a) descriptor + named, same place
      if (
        a.current_place_id != null &&
        a.current_place_id === b.current_place_id &&
        isDescriptorName(a.name) !== isDescriptorName(b.name)
      ) {
        reason = 'descriptor + named at same place'
      }

      // (c) near-identical normalized name
      if (!reason) {
        const ka = nameKey(a.name)
        if (ka && ka === nameKey(b.name)) reason = 'near-identical name'
      }

      // (b) shared distinctive memorable fact / observation
      if (!reason) {
        const aLines = new Set([
          ...distinctiveLines(a.memorable_facts),
          ...distinctiveLines(a.observations),
        ])
        const bLines = new Set([
          ...distinctiveLines(b.memorable_facts),
          ...distinctiveLines(b.observations),
        ])
        for (const l of aLines) {
          if (bLines.has(l)) {
            reason = 'shared memorable fact'
            break
          }
        }
      }

      if (reason) pairs.push({ aId: a.id, bId: b.id, aName: a.name, bName: b.name, reason })
    }
  }
  return pairs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/character-dedup.test.ts`
Expected: PASS (4 tests). If the `ch()` factory cast is awkward in your TS version, simplify it to `return { ...base, ...over }` where `base` is a full `Character` literal with every column set to a null/default — the detector only reads `id, name, is_player, current_place_id, status, memorable_facts, observations`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/character-dedup.ts tests/character-dedup.test.ts
git commit -m "feat(v0.6.15): deterministic duplicate-character detector"
```

---

### Task 4: `reveals_name_of` patch channel (Layer 3)

**Files:**
- Modify: `src/lib/archivist.ts` (CharacterPatchSchema ~line 111; apply loop ~line 1817)
- Modify: `prompts/archivist-system.md` ("A revealed name is the same person" rule)
- Test: `tests/archivist.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the character-canonicalization `describe` block in `tests/archivist.test.ts` (next to the existing `renames a descriptor NPC ... via aliases` test):

```ts
  it('reveals_name_of renames a descriptor row to the proper name, no duplicate', () => {
    applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'The Attendant at the Gates', description: 'Station attendant.' }],
    })
    db.prepare(
      "UPDATE characters SET agency_level = 'local' WHERE world_id = ? AND lower(name) = lower('The Attendant at the Gates')",
    ).run(worldId)

    applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Jérôme Moreau', reveals_name_of: 'The Attendant at the Gates', active_goal: 'survive' },
      ],
    })

    const matches = getCharactersForWorld(worldId).filter((c) =>
      ['Jérôme Moreau', 'The Attendant at the Gates'].includes(c.name),
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('Jérôme Moreau')
    expect(matches[0].agency_level).toBe('local')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/archivist.test.ts -t 'reveals_name_of'`
Expected: FAIL — `reveals_name_of` is rejected by the Zod schema / not honored, leaving two rows.

- [ ] **Step 3a: Add the schema field**

In `src/lib/archivist.ts`, immediately after the `aliases` field in `CharacterPatchSchema` (the field ends with `}),` closing the object), add before the closing `})`:

```ts
  reveals_name_of: z
    .string()
    .optional()
    .describe(
      'The existing descriptor/title or prior name of the figure this row IS. Set when a figure ' +
        'you already track is given or reveals a proper name: put the proper name in `name` and the ' +
        'old descriptor here. The named existing row is renamed and merged into this one — the safe, ' +
        'preferred way to handle a name reveal (clearer than `aliases`).',
    ),
```

- [ ] **Step 3b: Route it through the existing alias-merge in the apply loop**

In `src/lib/archivist.ts`, replace the alias-merge block in `applyArchivistPatch` (currently):

```ts
        if (c.aliases && c.aliases.length > 0) {
          runAliasMerges(worldId, c.name, c.aliases)
        }
```

with:

```ts
        // `reveals_name_of` is a clearer, safe-framed alias for the name-reveal
        // case; fold it into the same tested merge machinery as `aliases`.
        const aliasMergeNames = [
          ...(c.aliases ?? []),
          ...(c.reveals_name_of ? [c.reveals_name_of] : []),
        ]
        if (aliasMergeNames.length > 0) {
          runAliasMerges(worldId, c.name, aliasMergeNames)
        }
```

- [ ] **Step 3c: Point the prompt at the new field**

In `prompts/archivist-system.md`, in the bullet **"A revealed name is the same person, not a new one"**, change the example clause to prefer `reveals_name_of`:

Find: `→ emit `{ "name": "Jérôme Moreau", "aliases": ["The Attendant at the Gates"] }` (plus any other updates) on that one figure`

Replace with: `→ emit `{ "name": "Jérôme Moreau", "reveals_name_of": "The Attendant at the Gates" }` (plus any other updates) on that one figure (`reveals_name_of` is the preferred, safe field for this; `aliases` also works)`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/archivist.test.ts -t 'reveals_name_of'`
Expected: PASS. Also run the whole file: `npx vitest run tests/archivist.test.ts` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/archivist.ts prompts/archivist-system.md tests/archivist.test.ts
git commit -m "feat(v0.6.15): reveals_name_of rename channel routes into runAliasMerges"
```

---

### Task 5: Mark descriptor placeholders in archivist context (Layer 1)

**Files:**
- Modify: `src/lib/archivist.ts` (`extractPatch` prior-state block ~lines 292–315; user-content instruction ~line 372)

This is context formatting fed to the LLM; it has no unit test (the call hits the model). Verify by reading the assembled block. Keep the change minimal.

- [ ] **Step 1: Import the helper**

At the top of `src/lib/archivist.ts`, add to the internal imports group:

```ts
import { isDescriptorName } from '@/lib/character-identity'
```

- [ ] **Step 2: Tag present + known non-player characters**

In `extractPatch`'s `priorBlock`, in the `present_characters` map, add a `descriptor_placeholder` field. Change the present_characters object to include (after the `status` line):

```ts
        descriptor_placeholder:
          c.is_player === 1 ? undefined : isDescriptorName(c.name) || undefined,
```

Do the same in the `known_characters` map (add the identical line after its `status` field). Using `|| undefined` keeps the key out of the JSON for proper-named rows (no noise).

- [ ] **Step 3: Add a point-of-use instruction**

In the user-content array of `extractPatch` (the `content: [ ... ].join('\n')` block), insert one line just before `'Return the patch.'`:

```ts
          'NOTE: a character marked "descriptor_placeholder": true is an unnamed stand-in. If the latest turn names that figure (they state a name, are named, or ID is found), rename THAT row — set `name` to the proper name and `reveals_name_of` to the descriptor — do not create a new character.',
```

- [ ] **Step 4: Verify type-check and existing tests still pass**

Run: `npm run type-check && npx vitest run tests/archivist.test.ts`
Expected: clean + all pass (no behavior change to apply path; this only enriches the prompt).

- [ ] **Step 5: Commit**

```bash
git add src/lib/archivist.ts
git commit -m "feat(v0.6.15): flag descriptor placeholders in archivist context"
```

---

### Task 6: Surface duplicates in world state + inspector (Layer 2)

**Files:**
- Modify: `src/lib/world-state.ts` (`FullWorldState` type ~line 102; `getFullWorldState` ~line 142)
- Modify: `src/components/WorldInspector.tsx` (Wiki → Characters subtab)
- Test: `tests/character-dedup.test.ts` (add a DB-backed integration assertion)

- [ ] **Step 1: Write the failing integration test**

Append to `tests/character-dedup.test.ts`:

```ts
import { applyArchivistPatch } from '@/lib/archivist'
import { getCharactersForWorld } from '@/lib/db'
import { createWorld } from '@/lib/worlds'
import { getFullWorldState } from '@/lib/world-state'

describe('getFullWorldState.potentialDuplicates', () => {
  it('flags a descriptor + named pair at the same place', () => {
    const world = createWorld({
      name: `Dup-${Math.random()}`,
      premise: 'x',
      initialState: { time: 't', location: 'Cornavin station', identity: 'i', playerName: 'Andrew' },
    })
    applyArchivistPatch(world.id, 1, {
      characters: [
        { name: 'The Attendant at the Gates', current_place_name: 'Cornavin station' },
        { name: 'Jérôme Moreau', current_place_name: 'Cornavin station' },
      ],
    })
    const dup = getFullWorldState(world.id).potentialDuplicates
    expect(dup.some((p) => p.reason === 'descriptor + named at same place')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/character-dedup.test.ts -t 'potentialDuplicates'`
Expected: FAIL — `potentialDuplicates` does not exist on `FullWorldState`.

- [ ] **Step 3a: Extend the type and the getter**

In `src/lib/world-state.ts`, add the import:

```ts
import { findLikelyDuplicateCharacters, type DuplicatePair } from '@/lib/character-dedup'
```

Add to the `FullWorldState` type (after `turnTimestamps`):

```ts
  potentialDuplicates: DuplicatePair[]
```

In `getFullWorldState`, capture characters once and include the field. Replace:

```ts
  return {
    worldTime: cursor.world_time,
    currentSceneId: cursor.current_scene_id,
    characters: getCharactersForWorld(worldId),
```

with:

```ts
  const characters = getCharactersForWorld(worldId)
  return {
    worldTime: cursor.world_time,
    currentSceneId: cursor.current_scene_id,
    characters,
    potentialDuplicates: findLikelyDuplicateCharacters(characters),
```

(Leave the rest of the returned object unchanged; `characters` is now the local const.)

- [ ] **Step 3b: Render the flags in the Wiki → Characters subtab**

In `src/components/WorldInspector.tsx`, inside the Wiki view's characters subtab (where `state.characters.map(...)` renders the character list, ~line 379), add a banner just above the list. The component already receives `state: FullWorldState`. Insert:

```tsx
{state.potentialDuplicates.length > 0 && (
  <div className="mb-3 rounded border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-200">
    <p className="font-medium">Potential duplicate characters</p>
    <ul className="mt-1 space-y-1">
      {state.potentialDuplicates.map((d) => (
        <li key={`${d.aId}-${d.bId}`}>
          “{d.aName}” (#{d.aId}) ~ “{d.bName}” (#{d.bId}) — {d.reason}
          <code className="ml-1 block text-amber-300/80">
            node scripts/merge-characters.mjs --world {worldId} --canonical {d.bId} --dupe {d.aId}
          </code>
        </li>
      ))}
    </ul>
  </div>
)}
```

If `worldId` is not in scope in that subcomponent, thread it through its props (the Wiki view already takes `state`; pass `worldId` alongside, mirroring how `ArchivistView` receives it at line 187).

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run tests/character-dedup.test.ts && npm run type-check`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/world-state.ts src/components/WorldInspector.tsx tests/character-dedup.test.ts
git commit -m "feat(v0.6.15): surface potential duplicate characters in the inspector"
```

---

### Task 7: Log detected duplicates post-apply in the chat route (Layer 2)

**Files:**
- Modify: `src/app/api/chat/route.ts` (after `applyArchivistPatch`)

No unit test (route-level side effect); verify by reading and a manual run.

- [ ] **Step 1: Find where the archivist patch is applied**

Run: `grep -n "applyArchivistPatch" src/app/api/chat/route.ts`
Note the post-stream call site (the archivist runs after the narrator stream completes).

- [ ] **Step 2: Add a best-effort warning after the patch is applied**

Add the import near the other `@/lib` imports:

```ts
import { findLikelyDuplicateCharacters } from '@/lib/character-dedup'
import { getCharactersForWorld } from '@/lib/db'
```

(both may already be imported — do not duplicate). Immediately after the `applyArchivistPatch(...)` call in the post-stream block, add:

```ts
      try {
        for (const d of findLikelyDuplicateCharacters(getCharactersForWorld(worldId))) {
          console.warn(
            `[dup-detector] world ${worldId}: "${d.aName}" (#${d.aId}) ~ "${d.bName}" (#${d.bId}) — ${d.reason}`,
          )
        }
      } catch (err) {
        console.error('[dup-detector]', err)
      }
```

- [ ] **Step 3: Verify type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(v0.6.15): log likely duplicate characters after each archivist apply"
```

---

### Task 8: Add `--detect` mode to the merge script (Layer 2)

**Files:**
- Modify: `scripts/merge-characters.mjs`

The script is plain ESM JS and already mirrors runtime merge logic. Mirror the detector rules here too (small; cross-link the TS source in a comment). Verify by running it against the local db.

- [ ] **Step 1: Add a detector + flag, mirroring `src/lib/character-dedup.ts`**

In `scripts/merge-characters.mjs`, extend `parseArgs` to accept `--detect`:

```js
    else if (k === '--detect') args.detect = Number(argv[++i])
```

and initialize `detect: null` in the `args` object literal.

Add these functions (mirror of `src/lib/character-dedup.ts` + `character-identity.ts` — keep in sync):

```js
const ARTICLE_RE = /^(the|a|an)\s+/i
const isDescriptorName = (name) => ARTICLE_RE.test((name ?? '').trim())
const FACT_MIN_LEN = 25
function distinctiveLines(text) {
  if (!text) return new Set()
  return new Set(
    text.split('\n').map((l) => l.replace(/\s*\[t:\d+\]\s*$/, '').trim().toLowerCase())
      .filter((l) => l.length >= FACT_MIN_LEN),
  )
}
function detectWorld(worldId) {
  const db = openDb()
  const chars = db
    .prepare(
      `SELECT id, name, is_player, current_place_id, status, memorable_facts, observations
         FROM characters WHERE world_id = ? AND is_player = 0 AND status != 'dead' ORDER BY id`,
    )
    .all(worldId)
  const pairs = []
  for (let i = 0; i < chars.length; i++) {
    for (let j = i + 1; j < chars.length; j++) {
      const a = chars[i], b = chars[j]
      let reason = null
      if (a.current_place_id != null && a.current_place_id === b.current_place_id &&
          isDescriptorName(a.name) !== isDescriptorName(b.name)) {
        reason = 'descriptor + named at same place'
      }
      if (!reason) {
        const al = new Set([...distinctiveLines(a.memorable_facts), ...distinctiveLines(a.observations)])
        const bl = new Set([...distinctiveLines(b.memorable_facts), ...distinctiveLines(b.observations)])
        for (const l of al) { if (bl.has(l)) { reason = 'shared memorable fact'; break } }
      }
      if (reason) pairs.push({ a, b, reason })
    }
  }
  console.log(`[detect] ${pairs.length} candidate pair(s) in world ${worldId}`)
  for (const { a, b, reason } of pairs) {
    console.log(`  #${a.id} "${a.name}" ~ #${b.id} "${b.name}" — ${reason}`)
    console.log(`    node scripts/merge-characters.mjs --world ${worldId} --canonical ${b.id} --dupe ${a.id}`)
  }
  db.close()
}
```

In `main()`, handle the flag before the merge path:

```js
  if (args.detect !== null) {
    detectWorld(args.detect)
    return
  }
```

- [ ] **Step 2: Run it against the local db**

Run: `node scripts/merge-characters.mjs --detect --world 8`
Expected: prints `[detect] 0 candidate pair(s)` (world 8's duplicate was already merged in v0.6.13 cleanup) — i.e., it runs without error. Seed a fresh duplicate in any test world to see a non-zero result if desired.

- [ ] **Step 3: Commit**

```bash
git add scripts/merge-characters.mjs
git commit -m "feat(v0.6.15): merge-characters.mjs --detect lists likely duplicates"
```

---

### Task 9: Version bump, milestone doc, final verification

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `docs/plans/milestones/v0.6.15.md`

- [ ] **Step 1: Bump the version in both files**

In `package.json` set `"version": "0.6.15"`. In `package-lock.json` set BOTH the top-level `"version": "0.6.15"` and the one under `"packages": { "": { "version": "0.6.15" } }`. (Do not run `npm install` to fix the lockfile — edit directly.)

- [ ] **Step 2: Write the milestone doc**

Create `docs/plans/milestones/v0.6.15.md` following `docs/plans/_template-milestone.md`. It must include the exit criteria, ending with:

```markdown
- `package.json` reads `v0.6.15` on the release branch.
- Archivist `reveals_name_of` collapses a descriptor→proper-name reveal to one row (tested).
- A seeded duplicate is surfaced in the inspector, the chat-route logs, and `merge-characters.mjs --detect`.
- `npm run type-check` and `npm test` pass.
```

(Read `docs/plans/_template-milestone.md` first and match its section structure: summary, scope, exit criteria, accepted cuts.)

- [ ] **Step 3: Full verification**

Run: `npm run type-check && npx vitest run`
Expected: type-check clean; all tests pass (baseline 210 + the new identity/dedup/archivist cases).

- [ ] **Step 4: Restart the dev server and confirm the header**

Kill and restart `npm run dev` (module-level `pkg` JSON import is cached; prompt cache too). Load `/` and confirm the header reads `v0.6.15`. Then manually create a world, have an NPC reveal a name, and confirm: one character row, and the inspector shows no spurious duplicate.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json docs/plans/milestones/v0.6.15.md
git commit -m "chore(v0.6.15): bump version + milestone doc"
```

---

## Self-Review notes

- **Spec coverage:** Layer 1 → Tasks 2,5. Layer 2 detector → Task 3; surfacing → Tasks 6 (inspector), 7 (logs), 8 (script). Layer 3 → Task 4. Version/milestone → Task 9. Error handling (best-effort detector, ignored bad `reveals_name_of`) → Task 4 reuses `runAliasMerges` guards; Task 7 wraps in try/catch.
- **Deviation from spec:** duplicates render in the **Wiki → Characters** subtab, not the Archivist tab — `ArchivistView` is a correction-chat component without `FullWorldState`. Intentional; documented in Task 6.
- **Type consistency:** `DuplicatePair` ({aId,bId,aName,bName,reason}) is defined in Task 3 and consumed unchanged in Tasks 6–8. `isDescriptorName`/`nameKey` (Task 2) are reused by Task 3 and Task 5; the script (Task 8) re-implements them in JS by necessity (cross-linked comment).
- **No auto-merge anywhere** — all surfaces print/show the manual `merge-characters.mjs` command.

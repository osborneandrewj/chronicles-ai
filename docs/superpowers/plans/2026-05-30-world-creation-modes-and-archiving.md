# World Creation Modes + Archiving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-friction "Quick start" world-creation mode (player name + genre → LLM-synthesized world) alongside the existing Advanced form, and let players reversibly archive/unarchive worlds from the home page.

**Architecture:** Feature 2 (archiving) is a nullable `archived_at` column on `worlds` (migration v23) plus data-layer functions, server actions, and home-page UI. Feature 1 (Quick start) is a new `GENRES` allowlist, a Haiku-backed `generateWorldFromGenre` synthesizer modeled on `region-extractor.ts`, and a tabbed `/worlds/new` page sharing the existing creation tail (`createWorld` → `setSettingRegionForWorld` → `generateOpeningTurn` → redirect).

**Tech Stack:** Next.js 15 App Router, TypeScript, better-sqlite3, Vercel AI SDK (`generateObject` + `@ai-sdk/anthropic`), Zod, Tailwind, Vitest.

**Build order:** Archiving first (data layer → actions → UI), then Quick start (genres → generator → forms), then version bump. Each task is independently committable.

---

## File Structure

**Feature 2 — Archiving:**
- `src/lib/migrations.ts` (modify) — add migration v23 adding `worlds.archived_at`.
- `tests/migrations.test.ts` (modify) — bump final `user_version` assertions 22 → 23; add a v23 test.
- `src/lib/worlds.ts` (modify) — filter `listWorlds`, add `listArchivedWorlds` / `archiveWorld` / `unarchiveWorld`, extend `WorldSummary`.
- `tests/worlds-archive.test.ts` (create) — data-layer tests.
- `src/app/worlds/actions.ts` (create) — `archiveWorldAction`, `unarchiveWorldAction`.
- `src/components/WorldRowMenu.tsx` (create) — client ⋯ menu calling an archive/unarchive action.
- `src/components/ArchivedSection.tsx` (create) — client collapsible "Archived (N)" disclosure.
- `src/app/page.tsx` (modify) — restructure row to host the menu; render `ArchivedSection`.

**Feature 1 — Quick start:**
- `src/lib/genres.ts` (create) — `GENRES` const, `Genre` type, `isGenre` guard.
- `tests/genres.test.ts` (create) — allowlist guard tests.
- `src/lib/world-generator.ts` (create) — `GeneratedWorldSchema`, `GeneratedWorld`, `generateWorldFromGenre`.
- `tests/world-generator.test.ts` (create) — schema parse/reject tests (no LLM call).
- `src/app/worlds/new/actions.ts` (modify) — extract shared `createAndOpenWorld` tail; add `createBasicWorldAction`.
- `src/app/worlds/new/QuickStartForm.tsx` (create) — name input + genre grid.
- `src/app/worlds/new/CreateModeTabs.tsx` (create) — client tab toggle.
- `src/app/worlds/new/page.tsx` (modify) — render `CreateModeTabs`.

**Release:**
- `package.json` + `package-lock.json` (modify) — bump to `0.6.16`.
- `docs/plans/milestones/` (modify/create) — milestone doc.

---

## Task 1: Migration v23 — `worlds.archived_at`

**Files:**
- Modify: `src/lib/migrations.ts` (insert before the closing `]` of the `migrations` array, currently at line 718, after the v22 block's `},` on line 717)
- Modify: `tests/migrations.test.ts`

- [ ] **Step 1: Update the existing final-version assertions in the test**

Every existing migration test asserts the DB ends at `user_version` 22. After v23 they must assert 23. Replace **all** occurrences in `tests/migrations.test.ts`:

```
expect(db.pragma('user_version', { simple: true })).toBe(22)
```
with:
```
expect(db.pragma('user_version', { simple: true })).toBe(23)
```

(There are ~11 occurrences. Replace every one.)

- [ ] **Step 2: Write the failing v23 test**

Append this `describe` block to the end of `tests/migrations.test.ts`:

```ts
describe('v23 migration (world_archived_at)', () => {
  it('adds a nullable archived_at column to worlds; defaults to NULL', () => {
    const db = seedV4Database()
    db.prepare(
      `INSERT INTO worlds (id, name, premise, initial_state_json) VALUES (?, ?, ?, ?)`,
    ).run(
      1,
      'Archivable World',
      'p',
      JSON.stringify({ time: 'morning', location: 'a quay', identity: 'a face' }),
    )

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(23)
    expect(db.pragma('foreign_key_check')).toEqual([])

    const cols = db.prepare("PRAGMA table_info('worlds')").all() as Array<{
      name: string
      type: string
      notnull: number
      dflt_value: string | null
    }>
    const archivedAt = cols.find((c) => c.name === 'archived_at')
    expect(archivedAt).toBeDefined()
    expect(archivedAt?.type.toUpperCase()).toBe('TEXT')
    expect(archivedAt?.notnull).toBe(0)
    expect(archivedAt?.dflt_value).toBeNull()

    // The backfilled world starts active (archived_at NULL).
    const world = db.prepare('SELECT archived_at FROM worlds WHERE id = 1').get() as {
      archived_at: string | null
    }
    expect(world.archived_at).toBeNull()

    // Round-trip: archive then clear.
    db.prepare("UPDATE worlds SET archived_at = datetime('now') WHERE id = 1").run()
    const archived = db.prepare('SELECT archived_at FROM worlds WHERE id = 1').get() as {
      archived_at: string | null
    }
    expect(typeof archived.archived_at).toBe('string')
    db.prepare('UPDATE worlds SET archived_at = NULL WHERE id = 1').run()
    const cleared = db.prepare('SELECT archived_at FROM worlds WHERE id = 1').get() as {
      archived_at: string | null
    }
    expect(cleared.archived_at).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- migrations`
Expected: FAIL — the v23 test fails on `toBe(23)` (DB still ends at 22) and `archived_at` is undefined. (Some pre-existing tests may also fail on the 22→23 change until Step 4 lands.)

- [ ] **Step 4: Add the migration**

In `src/lib/migrations.ts`, insert this block immediately after the v22 block's closing `},` (line 717) and before the array's closing `]` (line 718):

```ts
  {
    // v0.6.16 — soft-archive worlds. `archived_at` is NULL for active worlds
    // and an ISO timestamp once archived. Nullable with no default so every
    // existing world stays active after the migration. Reversible: unarchiving
    // sets it back to NULL.
    version: 23,
    name: 'world_archived_at',
    up: (db) => {
      db.exec('ALTER TABLE worlds ADD COLUMN archived_at TEXT')
    },
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- migrations`
Expected: PASS — all migration tests (including the new v23 block) green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/migrations.ts tests/migrations.test.ts
git commit -m "feat(v0.6.16): migration v23 adds worlds.archived_at"
```

---

## Task 2: Archiving data layer in `worlds.ts`

**Files:**
- Modify: `src/lib/worlds.ts:14-20` (`WorldSummary` type), `:42-48` (`listWorldsStmt`), `:138-140` (`listWorlds`)
- Create: `tests/worlds-archive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/worlds-archive.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  archiveWorld,
  createWorld,
  listArchivedWorlds,
  listWorlds,
  unarchiveWorld,
} from '@/lib/worlds'

function seedWorld(name: string): number {
  return createWorld({
    name,
    premise: 'A quiet place where little happens.',
    initialState: {
      time: 'Morning',
      location: 'A harbour',
      identity: 'A newcomer.',
      playerName: 'Tester',
    },
  }).id
}

describe('world archiving', () => {
  it('hides archived worlds from listWorlds and surfaces them in listArchivedWorlds', () => {
    const id = seedWorld(`Archive-${Math.random()}`)

    expect(listWorlds().some((w) => w.id === id)).toBe(true)
    expect(listArchivedWorlds().some((w) => w.id === id)).toBe(false)

    archiveWorld(id)

    expect(listWorlds().some((w) => w.id === id)).toBe(false)
    const archived = listArchivedWorlds().find((w) => w.id === id)
    expect(archived).toBeDefined()
    expect(archived?.archived_at).not.toBeNull()
  })

  it('restores an archived world with unarchiveWorld', () => {
    const id = seedWorld(`Restore-${Math.random()}`)
    archiveWorld(id)
    expect(listWorlds().some((w) => w.id === id)).toBe(false)

    unarchiveWorld(id)

    expect(listWorlds().some((w) => w.id === id)).toBe(true)
    expect(listArchivedWorlds().some((w) => w.id === id)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- worlds-archive`
Expected: FAIL — `archiveWorld`, `listArchivedWorlds`, `unarchiveWorld` are not exported.

- [ ] **Step 3: Extend `WorldSummary` and the active-list query**

In `src/lib/worlds.ts`, change the `WorldSummary` type (currently lines 14-20) to add `archived_at`:

```ts
export type WorldSummary = {
  id: number
  name: string
  premise: string
  created_at: string
  archived_at: string | null
  turn_count: number
}
```

Change `listWorldsStmt` (currently lines 42-48) to select `archived_at` and filter to active worlds:

```ts
const listWorldsStmt = db.prepare(`
  SELECT
    w.id, w.name, w.premise, w.created_at, w.archived_at,
    COALESCE((SELECT COUNT(*) FROM turns t WHERE t.world_id = w.id AND t.role = 'assistant'), 0) AS turn_count
  FROM worlds w
  WHERE w.archived_at IS NULL
  ORDER BY w.created_at DESC, w.id DESC
`)
```

- [ ] **Step 4: Add archived-list + archive/unarchive statements and functions**

In `src/lib/worlds.ts`, immediately after `listWorldsStmt` add:

```ts
const listArchivedWorldsStmt = db.prepare(`
  SELECT
    w.id, w.name, w.premise, w.created_at, w.archived_at,
    COALESCE((SELECT COUNT(*) FROM turns t WHERE t.world_id = w.id AND t.role = 'assistant'), 0) AS turn_count
  FROM worlds w
  WHERE w.archived_at IS NOT NULL
  ORDER BY w.archived_at DESC, w.id DESC
`)

const archiveWorldStmt = db.prepare<[number]>(
  "UPDATE worlds SET archived_at = datetime('now') WHERE id = ?",
)
const unarchiveWorldStmt = db.prepare<[number]>(
  'UPDATE worlds SET archived_at = NULL WHERE id = ?',
)
```

At the end of the file (after `listWorlds`, currently lines 138-140) add:

```ts
export function listArchivedWorlds(): WorldSummary[] {
  return listArchivedWorldsStmt.all() as WorldSummary[]
}

export function archiveWorld(id: number): void {
  archiveWorldStmt.run(id)
}

export function unarchiveWorld(id: number): void {
  unarchiveWorldStmt.run(id)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- worlds-archive`
Expected: PASS — both tests green.

- [ ] **Step 6: Run the type check**

Run: `npm run type-check`
Expected: PASS — `WorldSummary.archived_at` consumers (only `page.tsx` so far) still typecheck (page.tsx doesn't read the field yet).

- [ ] **Step 7: Commit**

```bash
git add src/lib/worlds.ts tests/worlds-archive.test.ts
git commit -m "feat(v0.6.16): archive/unarchive data layer in worlds.ts"
```

---

## Task 3: Archive server actions

**Files:**
- Create: `src/app/worlds/actions.ts`

(No unit test: these are thin wrappers over already-tested `worlds.ts` functions plus `revalidatePath`, which requires the Next.js request runtime. Verified via the browser in Task 5.)

- [ ] **Step 1: Create the server actions**

Create `src/app/worlds/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'

import { archiveWorld, unarchiveWorld } from '@/lib/worlds'

export async function archiveWorldAction(worldId: number): Promise<void> {
  archiveWorld(worldId)
  revalidatePath('/')
}

export async function unarchiveWorldAction(worldId: number): Promise<void> {
  unarchiveWorld(worldId)
  revalidatePath('/')
}
```

- [ ] **Step 2: Run the type check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/worlds/actions.ts
git commit -m "feat(v0.6.16): archive/unarchive server actions"
```

---

## Task 4: `WorldRowMenu` client component

**Files:**
- Create: `src/components/WorldRowMenu.tsx`

A self-contained ⋯ button that opens a one-item dropdown and calls the archive or unarchive action. Closes on outside click. No test (UI/interaction — verified in the browser in Task 5).

- [ ] **Step 1: Create the component**

Create `src/components/WorldRowMenu.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

import { archiveWorldAction, unarchiveWorldAction } from '@/app/worlds/actions'

type WorldRowMenuProps = {
  worldId: number
  variant: 'archive' | 'unarchive'
}

export function WorldRowMenu({ worldId, variant }: WorldRowMenuProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function runAction() {
    setOpen(false)
    startTransition(async () => {
      if (variant === 'archive') {
        await archiveWorldAction(worldId)
      } else {
        await unarchiveWorldAction(worldId)
      }
    })
  }

  const label = variant === 'archive' ? 'Archive' : 'Unarchive'

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`${label} world`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:opacity-50"
      >
        <DotsIcon />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-10 min-w-32 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 py-1 shadow-xl shadow-black/40"
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              runAction()
            }}
            className="block w-full px-3 py-2 text-left text-sm text-neutral-200 transition hover:bg-neutral-800"
          >
            {label}
          </button>
        </div>
      )}
    </div>
  )
}

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="8" cy="3" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="8" cy="13" r="1.4" />
    </svg>
  )
}
```

- [ ] **Step 2: Run the type check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/WorldRowMenu.tsx
git commit -m "feat(v0.6.16): WorldRowMenu archive/unarchive dropdown"
```

---

## Task 5: Home-page wiring — row menu + Archived section

**Files:**
- Create: `src/components/ArchivedSection.tsx`
- Modify: `src/app/page.tsx`

The current `WorldRow` wraps the whole row in a `Link`. A `<button>` cannot live inside an `<a>`, so the row is restructured into a relative container holding the `Link` (main tap target) plus the menu as an absolutely-positioned sibling.

- [ ] **Step 1: Restructure `WorldRow` to host the menu in `page.tsx`**

In `src/app/page.tsx`, add the import at the top (with the other internal imports):

```ts
import { WorldRowMenu } from '@/components/WorldRowMenu'
import { ArchivedSection } from '@/components/ArchivedSection'
import { listArchivedWorlds, listWorlds, type WorldSummary } from '@/lib/worlds'
```

(Replace the existing `import { listWorlds, type WorldSummary } from '@/lib/worlds'` line.)

Replace the `WorldRow` function (currently lines 67-102) with a version that takes a `menuVariant` and renders the menu outside the `Link`:

```tsx
function WorldRow({
  world,
  menuVariant,
}: {
  world: WorldSummary
  menuVariant: 'archive' | 'unarchive'
}) {
  const muted = menuVariant === 'unarchive'
  return (
    <div
      className={`group relative flex min-h-28 items-center gap-3 rounded-[1.75rem] border border-neutral-800 bg-[#1b1c1f] px-4 py-4 shadow-lg shadow-black/20 transition hover:border-neutral-700 hover:bg-[#1f2024] sm:px-5 ${
        muted ? 'opacity-60' : ''
      }`}
    >
      <Link
        href={`/worlds/${world.id}/play`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[1.5rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-lg font-semibold tracking-tight text-neutral-100">
              {world.name}
            </span>
            <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-1 text-xs tabular-nums text-neutral-400">
              {world.turn_count}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 font-serif text-base leading-relaxed text-neutral-300">
            {world.premise}
          </p>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
            <ClockIcon />
            <span>{formatCreatedAt(world.created_at)}</span>
            <span aria-hidden>·</span>
            <span>
              {world.turn_count} turn{world.turn_count === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </Link>
      <WorldRowMenu worldId={world.id} variant={menuVariant} />
    </div>
  )
}
```

(The `ArrowRightIcon` is dropped from the row since the menu now occupies the right edge; leave its `function ArrowRightIcon()` definition in place only if still referenced elsewhere — otherwise delete it to avoid an unused-symbol lint error.)

- [ ] **Step 2: Render active rows with the archive menu and add the Archived section**

In `src/app/page.tsx`, update the `Home` component body. Change the world fetch and the list rendering:

```tsx
export default function Home() {
  const worlds = listWorlds()
  const archived = listArchivedWorlds()

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-black px-4 py-5 sm:px-8 sm:py-8">
      {/* header unchanged */}
      {/* ...existing <header> ... */}

      {worlds.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {worlds.map((w) => (
            <li key={w.id}>
              <WorldRow world={w} menuVariant="archive" />
            </li>
          ))}
        </ul>
      )}

      <ArchivedSection worlds={archived} />
    </main>
  )
}
```

(Keep the existing `<header>` block exactly as-is between the `<main>` open and the `worlds.length === 0` check. Only the `const worlds` line, the list rendering, and the new `<ArchivedSection>` line change.)

- [ ] **Step 3: Create the `ArchivedSection` client component**

Create `src/components/ArchivedSection.tsx`. It is a client component (holds open/closed state) but renders `WorldRow`-style rows; to keep the row markup in one place it imports nothing from `page.tsx` and instead renders its own muted rows via `WorldRowMenu`:

```tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'

import { WorldRowMenu } from '@/components/WorldRowMenu'
import type { WorldSummary } from '@/lib/worlds'

export function ArchivedSection({ worlds }: { worlds: WorldSummary[] }) {
  const [open, setOpen] = useState(false)

  if (worlds.length === 0) return null

  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left text-xs font-medium uppercase tracking-[0.14em] text-neutral-500 transition hover:text-neutral-300 focus:outline-none"
      >
        <ChevronIcon open={open} />
        <span>Archived ({worlds.length})</span>
      </button>
      {open && (
        <ul className="mt-3 space-y-3">
          {worlds.map((w) => (
            <li key={w.id}>
              <ArchivedRow world={w} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ArchivedRow({ world }: { world: WorldSummary }) {
  return (
    <div className="group relative flex min-h-24 items-center gap-3 rounded-[1.75rem] border border-neutral-800/70 bg-[#161719] px-4 py-4 opacity-60 transition hover:opacity-100 sm:px-5">
      <Link
        href={`/worlds/${world.id}/play`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[1.5rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-semibold tracking-tight text-neutral-200">
              {world.name}
            </span>
            <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-1 text-xs tabular-nums text-neutral-500">
              {world.turn_count}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-1 font-serif text-sm leading-relaxed text-neutral-400">
            {world.premise}
          </p>
        </div>
      </Link>
      <WorldRowMenu worldId={world.id} variant="unarchive" />
    </div>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}
```

- [ ] **Step 4: Run lint + type check**

Run: `npm run type-check && npm run lint`
Expected: PASS. If lint flags an unused `ArrowRightIcon`, delete that function from `page.tsx`.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev` (ensure no other dev server is on the port). Open `http://localhost:3000`.
Expected, verify all:
- Each active world row shows a ⋯ button at the right; tapping the row body still navigates to play; tapping ⋯ does **not** navigate and opens an "Archive" menu.
- Click Archive → the world disappears from the active list and an "Archived (N)" disclosure appears (or its count increments).
- Expand "Archived (N)" → the world shows muted with a ⋯ → "Unarchive"; clicking it moves the world back into the active list.
- The header count reflects active worlds only.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/components/ArchivedSection.tsx
git commit -m "feat(v0.6.16): home-page archive menu + Archived section"
```

---

## Task 6: Genre allowlist

**Files:**
- Create: `src/lib/genres.ts`
- Create: `tests/genres.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/genres.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { GENRES, isGenre } from '@/lib/genres'

describe('genres allowlist', () => {
  it('exposes a non-empty, de-duplicated list', () => {
    expect(GENRES.length).toBeGreaterThan(0)
    expect(new Set(GENRES).size).toBe(GENRES.length)
  })

  it('isGenre accepts listed genres and rejects others', () => {
    expect(isGenre(GENRES[0])).toBe(true)
    expect(isGenre('Not A Real Genre')).toBe(false)
    expect(isGenre('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- genres`
Expected: FAIL — `@/lib/genres` does not exist.

- [ ] **Step 3: Create the genre module**

Create `src/lib/genres.ts` (the list is the source of truth for both the picker UI and server-side validation):

```ts
// Curated genre/subgenre labels offered in the Quick start world creator.
// Each label is fed verbatim to the world generator as the creative seed.
// This array is the single source of truth for the picker UI and the
// server-side allowlist.
export const GENRES = [
  'High Fantasy',
  'Dark Fantasy',
  'Urban Fantasy',
  'Sword & Sorcery',
  'Grimdark',
  'Portal/Isekai',
  'Gaslamp Fantasy',
  'Weird West',
  'Science Fiction',
  'Space Opera',
  'Cyberpunk',
  'Steampunk',
  'Post-Apocalyptic',
  'Military Sci-Fi',
  'Solarpunk/Hopepunk',
  'Biopunk/Nanopunk',
  'Time Travel/Alternate History',
  'First Contact/Alien Invasion',
  'Mecha/Giant Robot',
  'Dystopian Rebellion',
  'Mystery/Detective',
  'Noir',
  'Thriller/Espionage',
  'Paranormal/Occult Detective',
  'Heist',
  'Horror',
  'Cosmic Horror',
  'Historical',
  'Historical Adventure',
  'Western',
  'Pulp/Treasure-Hunting Adventure',
  'Survival/Wilderness',
  'Pirate/Swashbuckling',
  'Superhero/Powered Individuals',
  'Romance',
  'Mythological Retellings',
  'Cozy Adventure',
] as const

export type Genre = (typeof GENRES)[number]

export function isGenre(value: string): value is Genre {
  return (GENRES as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- genres`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/genres.ts tests/genres.test.ts
git commit -m "feat(v0.6.16): GENRES allowlist for Quick start"
```

---

## Task 7: World generator

**Files:**
- Create: `src/lib/world-generator.ts`
- Create: `tests/world-generator.test.ts`

Modeled on `src/lib/region-extractor.ts` (Haiku + `generateObject`). The LLM call itself is not unit-tested (consistent with `region-extractor.ts`, which has no test); the test covers the exported Zod schema so the contract is locked.

- [ ] **Step 1: Write the failing test**

Create `tests/world-generator.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { GeneratedWorldSchema } from '@/lib/world-generator'

describe('GeneratedWorldSchema', () => {
  it('accepts a fully-formed generated world', () => {
    const parsed = GeneratedWorldSchema.safeParse({
      name: 'The Drowned Court',
      premise:
        'In a flooded city of brass and barnacles, a tide-priest hunts the heir who vanished beneath the waterline.',
      location: 'The Salt Cathedral, ankle-deep at low tide',
      time: 'Day 1, the turning of the tide',
      identity: 'A wary diver new to the city, lantern in hand.',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an object missing required fields', () => {
    const parsed = GeneratedWorldSchema.safeParse({ name: 'X' })
    expect(parsed.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- world-generator`
Expected: FAIL — `@/lib/world-generator` does not exist.

- [ ] **Step 3: Create the generator module**

Create `src/lib/world-generator.ts`:

```ts
import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'

// One-shot Haiku call run when a player uses the Quick start creator. Given a
// genre label (+ optional player name) it synthesizes a complete starting
// world: title, premise, opening location, opening time, and a character
// description. Narrative richness comes later from the narrator's opening
// turn; this call only needs to produce a coherent, grounded seed. Modeled on
// region-extractor.ts. Throws on failure — unlike region extraction, a failed
// synthesis means there is nothing to create, so the caller must surface it.

const WORLD_GENERATOR_MODEL = 'claude-haiku-4-5-20251001'

export const GeneratedWorldSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(120)
    .describe('A short, evocative title for the world (2–5 words).'),
  premise: z
    .string()
    .min(20)
    .max(2000)
    .describe(
      'One vivid paragraph: setting, era, tone, what is currently happening, ' +
        'and who the protagonist is. Concrete sensory detail over abstract mood.',
    ),
  location: z
    .string()
    .min(1)
    .max(400)
    .describe('Where the very first scene opens — a specific, concrete place.'),
  time: z
    .string()
    .min(1)
    .max(200)
    .describe('In-world opening time, e.g. "Day 1, morning".'),
  identity: z
    .string()
    .min(1)
    .max(600)
    .describe("1–2 sentences on the protagonist: who they are, what they look like, what they carry."),
})

export type GeneratedWorld = z.infer<typeof GeneratedWorldSchema>

export async function generateWorldFromGenre(
  genre: string,
  playerName: string | null,
): Promise<GeneratedWorld> {
  const nameLine = playerName
    ? `The protagonist is named "${playerName}". Weave this name into the character description.`
    : 'The protagonist is unnamed for now — write the description without inventing a proper name.'

  const { object } = await generateObject({
    model: anthropic(WORLD_GENERATOR_MODEL),
    schema: GeneratedWorldSchema,
    system:
      'You are a world designer for an interactive novel. Given a genre, you ' +
      'invent a fresh, specific starting situation a player can immediately ' +
      'step into. Favor concrete, grounded detail over generic tropes. Avoid ' +
      'clichés and brand/franchise names. Keep it coherent: the premise, ' +
      'location, time, and character must describe the same single opening moment.',
    prompt: [
      `GENRE: ${genre}`,
      '',
      nameLine,
      '',
      'Generate the starting world now.',
    ].join('\n'),
  })

  return object
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- world-generator`
Expected: PASS.

- [ ] **Step 5: Run the type check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/world-generator.ts tests/world-generator.test.ts
git commit -m "feat(v0.6.16): generateWorldFromGenre Haiku synthesizer"
```

---

## Task 8: Share the creation tail + add `createBasicWorldAction`

**Files:**
- Modify: `src/app/worlds/new/actions.ts`

- [ ] **Step 1: Extract the shared creation tail and add the basic action**

Replace the contents of `src/app/worlds/new/actions.ts` with the following. The existing `createWorldAction` is preserved but now calls a shared `createAndOpenWorld` helper; `createBasicWorldAction` is new and reuses the same tail.

```ts
'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { isGenre } from '@/lib/genres'
import { generateOpeningTurn } from '@/lib/opening-turn'
import { generateWorldFromGenre } from '@/lib/world-generator'
import { createWorld, setSettingRegionForWorld, type CreateWorldInput } from '@/lib/worlds'

const CreateWorldSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  premise: z.string().trim().min(20, 'Premise is required (at least a sentence)').max(4000),
  location: z.string().trim().min(1, 'Location is required').max(400),
  time: z.string().trim().min(1).max(200).default('Day 1, morning'),
  playerName: z.string().trim().max(120).optional(),
  identity: z
    .string()
    .trim()
    .max(600)
    .default('Travel-worn newcomer — name not yet established.'),
})

const BasicWorldSchema = z.object({
  playerName: z.string().trim().max(120).optional(),
  genre: z.string().trim().refine(isGenre, 'Pick a genre from the list'),
})

export type CreateWorldFormState = {
  error?: string
}

// Shared tail for both creation modes: persist the world, extract a geocoding
// region from the premise, synthesize the narrator's opening move, then send
// the player into /play. `redirect` throws by design, so it must be the caller's
// last statement (and is therefore invoked here, not returned).
async function createAndOpenWorld(input: CreateWorldInput): Promise<never> {
  const world = createWorld(input)
  await setSettingRegionForWorld(world.id, input.premise, input.initialState.location)
  await generateOpeningTurn(world.id, input.premise)
  redirect(`/worlds/${world.id}/play`)
}

export async function createWorldAction(
  _prev: CreateWorldFormState,
  formData: FormData,
): Promise<CreateWorldFormState> {
  const parsed = CreateWorldSchema.safeParse({
    name: formData.get('name'),
    premise: formData.get('premise'),
    location: formData.get('location'),
    time: formData.get('time') || undefined,
    playerName: formData.get('playerName') || undefined,
    identity: formData.get('identity') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  const { name, premise, location, time, playerName, identity } = parsed.data
  await createAndOpenWorld({
    name,
    premise,
    initialState: { time, location, identity, playerName },
  })
}

export async function createBasicWorldAction(
  _prev: CreateWorldFormState,
  formData: FormData,
): Promise<CreateWorldFormState> {
  const parsed = BasicWorldSchema.safeParse({
    playerName: formData.get('playerName') || undefined,
    genre: formData.get('genre'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  const { playerName, genre } = parsed.data

  let generated
  try {
    generated = await generateWorldFromGenre(genre, playerName ?? null)
  } catch (err) {
    console.error('[world generator failed]', err)
    return { error: "Couldn't generate a world — try again, or use Advanced." }
  }

  await createAndOpenWorld({
    name: generated.name,
    premise: generated.premise,
    initialState: {
      time: generated.time,
      location: generated.location,
      identity: generated.identity,
      playerName: playerName ?? undefined,
    },
  })
}
```

Note: `redirect()` throws an internal Next.js control-flow error, so wrapping the whole flow in a try/catch would swallow it. Only the `generateWorldFromGenre` call is wrapped — `createAndOpenWorld` (which calls `redirect`) is outside the try.

- [ ] **Step 2: Verify `CreateWorldInput` is exported from `worlds.ts`**

`createAndOpenWorld` imports `type CreateWorldInput`. It already exists in `src/lib/worlds.ts` (lines 65-69) and is exported. No change needed — confirm with:

Run: `grep -n "export type CreateWorldInput" src/lib/worlds.ts`
Expected: one match.

- [ ] **Step 3: Run lint + type check**

Run: `npm run type-check && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/worlds/new/actions.ts
git commit -m "feat(v0.6.16): shared creation tail + createBasicWorldAction"
```

---

## Task 9: Quick start form + mode tabs

**Files:**
- Create: `src/app/worlds/new/QuickStartForm.tsx`
- Create: `src/app/worlds/new/CreateModeTabs.tsx`
- Modify: `src/app/worlds/new/page.tsx`

- [ ] **Step 1: Create `QuickStartForm`**

Create `src/app/worlds/new/QuickStartForm.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'

import { GENRES } from '@/lib/genres'
import { createBasicWorldAction, type CreateWorldFormState } from './actions'

const INITIAL: CreateWorldFormState = {}

export function QuickStartForm() {
  const [state, formAction, pending] = useActionState(createBasicWorldAction, INITIAL)
  const [genre, setGenre] = useState<string>('')

  return (
    <form action={formAction} className="space-y-6">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">
          Your name
        </span>
        <input
          name="playerName"
          type="text"
          placeholder="Leave blank for an unnamed protagonist"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-[15px] text-neutral-100 placeholder:text-neutral-500 transition focus:border-neutral-600 focus:bg-neutral-900 focus:outline-none"
        />
      </label>

      <div>
        <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">
          Genre <span className="ml-1 text-amber-500/80">*</span>
        </span>
        <input type="hidden" name="genre" value={genre} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GENRES.map((g) => {
            const selected = g === genre
            return (
              <button
                type="button"
                key={g}
                onClick={() => setGenre(g)}
                aria-pressed={selected}
                className={`rounded-xl border px-3 py-2.5 text-left text-[13px] leading-snug transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
                  selected
                    ? 'border-amber-500/80 bg-amber-500/15 text-amber-100'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900'
                }`}
              >
                {g}
              </button>
            )
          })}
        </div>
      </div>

      {state.error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || genre === ''}
          className="rounded-lg bg-amber-500/90 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {pending ? 'Generating…' : 'Generate world'}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Create `CreateModeTabs`**

Create `src/app/worlds/new/CreateModeTabs.tsx`:

```tsx
'use client'

import { useState } from 'react'

import { CreateWorldForm } from './CreateWorldForm'
import { QuickStartForm } from './QuickStartForm'

type Mode = 'basic' | 'advanced'

export function CreateModeTabs() {
  const [mode, setMode] = useState<Mode>('basic')

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-xl border border-neutral-800 bg-neutral-900/60 p-1">
        <TabButton active={mode === 'basic'} onClick={() => setMode('basic')}>
          Quick start
        </TabButton>
        <TabButton active={mode === 'advanced'} onClick={() => setMode('advanced')}>
          Advanced
        </TabButton>
      </div>

      {mode === 'basic' ? <QuickStartForm /> : <CreateWorldForm />}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition focus:outline-none ${
        active ? 'bg-amber-500/90 text-neutral-950' : 'text-neutral-400 hover:text-neutral-100'
      }`}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 3: Render `CreateModeTabs` from the new-world page**

Open `src/app/worlds/new/page.tsx`. Replace the `CreateWorldForm` import with `CreateModeTabs` and render it where `<CreateWorldForm />` currently appears:

```tsx
import { CreateModeTabs } from './CreateModeTabs'
```
and replace the `<CreateWorldForm />` usage with:
```tsx
<CreateModeTabs />
```

(Leave the rest of the page — heading, layout, back link — unchanged. `CreateWorldForm` stays imported by `CreateModeTabs`, not by the page.)

- [ ] **Step 4: Run lint + type check**

Run: `npm run type-check && npm run lint`
Expected: PASS.

- [ ] **Step 5: Verify in the browser**

With `npm run dev` running, open `http://localhost:3000/worlds/new`.
Expected, verify all:
- Two tabs: "Quick start" (default) and "Advanced".
- Quick start shows a name field + a genre grid. Submit is disabled until a genre is selected.
- Selecting a genre and clicking "Generate world" creates a world and lands on `/play` with a streamed opening turn matching the genre.
- Switching to "Advanced" shows the original full form, which still creates a world as before.

- [ ] **Step 6: Commit**

```bash
git add src/app/worlds/new/QuickStartForm.tsx src/app/worlds/new/CreateModeTabs.tsx src/app/worlds/new/page.tsx
git commit -m "feat(v0.6.16): Quick start form + create-mode tabs"
```

---

## Task 10: Full test suite + version bump + milestone doc

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create/modify: milestone doc under `docs/plans/milestones/`

- [ ] **Step 1: Run the full suite, lint, and type check**

Run: `npm test && npm run lint && npm run type-check`
Expected: all PASS. (Confirms the 22→23 migration assertion change didn't miss an occurrence and nothing else regressed.)

- [ ] **Step 2: Bump the version in `package.json`**

Set the top-level `"version"` in `package.json` to `0.6.16`.

- [ ] **Step 3: Bump the version in `package-lock.json`**

Set **both** the top-level `"version"` and the one under `"packages": { "": { ... } }` to `0.6.16`.

- [ ] **Step 4: Verify the three version strings agree**

Run: `node -p "require('./package.json').version" && grep -m2 '\"version\": \"0.6.16\"' package-lock.json`
Expected: prints `0.6.16` and two matching lock lines.

- [ ] **Step 5: Add/refresh the milestone doc**

Create or update the v0.6.16 milestone doc under `docs/plans/milestones/` (follow `docs/plans/_template-milestone.md`). It must list the exit criterion: "`package.json` reads `v0.6.16` on the release branch", and summarize the two features (Quick start creation mode, world archiving) plus the v23 migration.

- [ ] **Step 6: Restart the dev server and confirm the header**

Kill `npm run dev`, restart it, and confirm the header on `/` shows `v0.6.16` (Next.js does not HMR the module-level `pkg` JSON import).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json docs/plans/milestones/
git commit -m "chore(v0.6.16): bump version + milestone doc"
```

---

## Notes for the implementer

- **Migration version coupling:** `tests/migrations.test.ts` asserts the *final* `user_version` in many places. Task 1 changes 22 → 23 everywhere. If `npm test -- migrations` shows a `toBe(22)` failure after Task 1, an occurrence was missed.
- **`redirect()` is control flow, not an error:** it throws a special Next.js signal. Never wrap a `redirect()` call in a try/catch that swallows everything — in Task 8 only the LLM call is guarded.
- **Server actions imported into client components:** `WorldRowMenu` and the forms import `'use server'` actions directly. This is supported in Next 15; the action module must keep its top-level `'use server'` directive.
- **Dev server staleness:** after the version bump, the header only updates on a full dev-server restart (documented gotcha in CLAUDE.md).
- **No new env vars:** the generator reuses `ANTHROPIC_API_KEY` (same as `region-extractor.ts`).
```

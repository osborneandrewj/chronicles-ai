# v0.6.16 — Two-mode world creation + world archiving

**Date:** 2026-05-30
**Version:** v0.6.16
**Status:** Approved design, pre-implementation

## Summary

Two independent features:

1. **Two creation modes** on `/worlds/new`: a low-friction **Quick start** path (player name + genre → LLM-synthesized world) alongside the existing **Advanced** form (manual premise/location/time/character).
2. **Archiving worlds**: reversible soft-hide of worlds from the home list, with a collapsed "Archived" section to view and restore them. No permanent delete.

Both ship together as v0.6.16.

---

## Feature 1 — Two creation modes

### UX

`/worlds/new` gains a tab switcher with two modes:

- **Quick start (Basic)** — the default/leading tab. Two inputs:
  - Character **name** — optional, defaults to `"Player"`.
  - **Genre** — required, picked from a grid of 16 cards (single select).

  On submit: one LLM call synthesizes the world, then the existing creation tail runs (`createWorld` → `setSettingRegionForWorld` → `generateOpeningTurn` → redirect to `/worlds/{id}/play`).

- **Advanced** — today's `CreateWorldForm`, unchanged in fields/behavior.

The tab toggle is a small client component. Basic leads because it is the lower-friction path; Advanced is one tap away.

### Genre list

Flat list of 16 labels (genres + subgenres folded in). The label string is fed to the LLM as the seed — no per-genre config beyond the label.

```
High Fantasy, Dark Fantasy, Urban Fantasy, Sword & Sorcery, Grimdark, Portal/Isekai, Gaslamp Fantasy, Weird West, Science Fiction, Space Opera, Cyberpunk, Steampunk, Post-Apocalyptic, Military Sci-Fi, Solarpunk/Hopepunk, Biopunk/Nanopunk, Time Travel/Alternate History, First Contact/Alien Invasion, Mecha/Giant Robot, Dystopian Rebellion, Mystery/Detective, Noir, Thriller/Espionage, Paranormal/Occult Detective, Heist, Horror, Cosmic Horror, Historical, Historical Adventure, Western, Pulp/Treasure-Hunting Adventure, Survival/Wilderness, Pirate/Swashbuckling, Superhero/Powered Individuals, Romance, Mythological Retellings, Cozy Adventure
```

Defined as a single exported `const GENRES` array (the source of truth for both the picker UI and server-side validation). Grid layout: 2 columns on mobile, 4 on desktop.

### World synthesis

New module `src/lib/world-generator.ts`, modeled on `src/lib/region-extractor.ts`:

```ts
export async function generateWorldFromGenre(
  genre: string,
  playerName: string | null,
): Promise<GeneratedWorld>
```

- **Model:** Haiku (`claude-haiku-4-5-20251001`) via `generateObject` — cheap, structured, consistent with the existing region-extractor pattern. Narrative richness still comes from the opening turn, which the narrator (Grok 4.3) writes afterward.
- **Output schema (Zod):**
  - `name` — short, evocative world title.
  - `premise` — one paragraph (matches the Advanced form's premise guidance: setting, era, tone, what's happening, who the protagonist is).
  - `location` — opening location string (same shape the Advanced form expects).
  - `time` — in-world opening time (e.g. "Day 1, morning").
  - `identity` — 1–2 sentence character description. Weaves in `playerName` when provided; otherwise an unnamed protagonist.
- **Failure handling:** the call is wrapped in try/catch. On failure it throws a typed error surfaced to the form as an error message ("Couldn't generate a world — try again or use Advanced"). Unlike region extraction (which degrades silently), a failed synthesis means there is nothing to create, so it must surface rather than swallow.

The genre passed to the generator is validated server-side against `GENRES` (allowlist) before the LLM call.

### New / changed files

- `src/lib/world-generator.ts` — `generateWorldFromGenre`, `GeneratedWorld` type, Zod schema. **New.**
- `src/lib/genres.ts` — `GENRES` const (shared by UI + validation). **New.** (Kept separate so the client picker can import it without pulling in server-only generator code.)
- `src/app/worlds/new/QuickStartForm.tsx` — client component: name input + genre grid + submit. **New.**
- `src/app/worlds/new/CreateModeTabs.tsx` — client tab toggle wrapping QuickStartForm + CreateWorldForm. **New.**
- `src/app/worlds/new/actions.ts` — add `createBasicWorldAction` alongside the existing `createWorldAction`. Validates `{ playerName?, genre }`, calls `generateWorldFromGenre`, then the shared creation tail. **Changed.**
- `src/app/worlds/new/page.tsx` — render `CreateModeTabs` instead of `CreateWorldForm` directly. **Changed.**

The creation tail (`createWorld` + `setSettingRegionForWorld` + `generateOpeningTurn` + `redirect`) is shared between the two actions — extract it into a small local helper in `actions.ts` to avoid divergence.

---

## Feature 2 — Archive / unarchive worlds

### Schema (migration v23)

```sql
ALTER TABLE worlds ADD COLUMN archived_at TEXT
```

- `null` = active, ISO timestamp = archived.
- Chosen over a boolean: records *when* archived, orders the archived list, matches existing `*_at` conventions.
- Registered as migration `version: 23` in `src/lib/migrations.ts` (current latest is 22).

### `src/lib/worlds.ts`

- `listWorlds()` — add `WHERE w.archived_at IS NULL` to the active list query.
- `listArchivedWorlds(): WorldSummary[]` — **new.** Same shape, `WHERE w.archived_at IS NOT NULL`, ordered `archived_at DESC`.
- `archiveWorld(id: number): void` — **new.** `UPDATE worlds SET archived_at = datetime('now') WHERE id = ?`.
- `unarchiveWorld(id: number): void` — **new.** `UPDATE worlds SET archived_at = NULL WHERE id = ?`.
- `WorldSummary` gains `archived_at: string | null` (used to render archived rows muted).

### Server actions

`archiveWorldAction(worldId)` / `unarchiveWorldAction(worldId)` — call the corresponding `worlds.ts` function then `revalidatePath('/')`. Location: co-located with the home page (e.g. `src/app/actions.ts` or a `src/app/worlds/actions.ts`), following existing server-action placement.

### Home page UI (`src/app/page.tsx`)

- **Active rows:** each world row gains a **"⋯" overflow menu** button (new small client component, e.g. `WorldRowMenu.tsx`) with a single **Archive** item. The row stays a full tap-to-play `Link`; the menu button sits *outside* the Link in the row container and stops event propagation so tapping it does not navigate. Archive triggers `archiveWorldAction`.
- **Archived section:** a collapsed disclosure at the bottom — **"Archived (N)"** — rendered only when N > 0. Expanding lists archived worlds, visually muted (dimmed), still tappable to play, each with an **Unarchive** action in its ⋯ menu. Implemented as a client component holding open/closed state.
- The header world count continues to reflect **active** worlds only.

### New / changed files

- `src/lib/migrations.ts` — add migration v23. **Changed.**
- `src/lib/worlds.ts` — filter `listWorlds`, add `listArchivedWorlds` / `archiveWorld` / `unarchiveWorld`, extend `WorldSummary`. **Changed.**
- `src/app/worlds/actions.ts` (or equivalent) — `archiveWorldAction`, `unarchiveWorldAction`. **New.**
- `src/components/WorldRowMenu.tsx` — ⋯ menu button + dropdown. **New.**
- `src/app/page.tsx` — render menu on active rows, add collapsed Archived section. **Changed.** (If the row/section grows past ~150 lines, extract `WorldRow` / `ArchivedSection` into their own files.)

---

## Out of scope

- Permanent deletion of worlds (explicitly cut — archiving is non-destructive only).
- Per-genre hand-authored templates (Basic uses pure LLM synthesis).
- Editing an existing world's premise/fields.
- Bulk archive/unarchive.
- Archiving controls inside the play page (home-page-only for this version).

## Done criteria

- `/worlds/new` shows Basic + Advanced tabs; Basic creates a playable world from name + genre and lands on a streamed opening turn in the browser.
- Advanced path behaves exactly as before.
- A world can be archived from the home row menu, disappears from the active list, appears under "Archived (N)", and can be unarchived back into the active list — verified end-to-end in the browser.
- Migration v23 applies cleanly; existing worlds remain active (`archived_at` null).
- `npm run lint` and `npm run type-check` pass.
- `package.json` + `package-lock.json` read `v0.6.16` on the release branch.
- Milestone doc updated per the version-bump rule in CLAUDE.md.

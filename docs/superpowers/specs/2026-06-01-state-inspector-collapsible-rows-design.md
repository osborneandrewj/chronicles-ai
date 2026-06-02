# State Inspector — Collapsible Rows + At-a-Glance Status

**Date:** 2026-06-01
**Status:** Approved (design); implementation pending
**Component:** `src/components/WorldInspector.tsx`

## Problem

The World Inspector drawer renders every entity fully expanded inline. The Wiki
tab (characters, places, scenes), the Now tab (present characters), and the Story
tab (threads, objectives, clues, resources) all dump complete detail at once, so
a world with many characters/scenes becomes a long scroll where nothing is
scannable at a glance.

## Goal

Collapse each entity into a button-like row that expands on press, and surface
its key status on the collapsed row so the overall list reads at a glance
(e.g. a scene that's active, a character who is dead / here / dormant).

## Decisions (locked with user)

- **Scope:** Everywhere — Wiki (characters, places, scenes) **+** Now (present
  characters) **+** Story (threads, objectives, clues, resources).
- **Expand behavior:** Accordion — one row open at a time, *per list*.
- **Character badges:** all four — player marker, life status, presence, agency.
- **No data/API changes.** Purely presentational over the existing
  `FullWorldState`. Fetch logic, `CharacterCard` body content, and `ArchivistView`
  are untouched.

## Design

### 1. `<Disclosure>` primitive (in `WorldInspector.tsx`)

A controlled disclosure row:

- A `<button>` header containing: chevron (▸ collapsed / ▾ open), a `title` slot,
  and a `badges` slot (right-aligned).
- A body rendered only when `open`.
- Props: `{ open: boolean; onToggle: () => void; title; badges?; children }`.
- Accessibility: `aria-expanded`, `aria-controls` pointing at the body's id,
  full keyboard operation (it is a real button), ≥44px tap target, reusing the
  existing amber focus-ring classes.

Controlled (not self-managed) so the parent list owns accordion state.

### 2. Accordion state — per list

Each rendered list holds a single `openId` (`useState<string | null>`):

- Wiki → characters, places, scenes (each its own `openId`).
- Now → present characters.
- Story → each group (threads, objectives, clues, resources) its own `openId`.

Opening a row sets `openId` to that row's id and closes its siblings *within the
same list only*. Opening a character never closes an open scene elsewhere.

### 3. Default-open — initial mount only

- **Scenes:** the active scene starts open.
- **All other lists:** start collapsed.
- Implemented as a `useState` initializer (not an effect), so the per-turn
  refetch (`refreshKey` / `localRefreshKey`) never re-opens or yanks a row the
  user has toggled. Open state survives refetch because rows keep stable `key`s
  (entity id) and the components do not remount.

### 4. Badge derivation — new pure module `src/lib/inspector-badges.ts`

Pure, unit-testable functions returning ordered badge descriptors
(`{ label, tone }`), with rendering left to the component:

- `deriveCharacterBadges(c, currentPlaceId)`:
  1. **player** — when `is_player === 1`.
  2. **life status** — `dead` (red tone) / `inactive` (muted); `active` → no badge.
  3. **presence** — `here` when `current_place_id === currentPlaceId` (and a
     current place exists); otherwise no badge.
  4. **agency** — `local` / `nearby` / `distant` / `dormant`; `npc` → no badge.
- `deriveSceneBadge(s)`: `active` (amber tone) / `done` (muted) from
  `status: 'active' | 'completed'`.
- Places: a `current` badge when the place is the active scene's `place_id`
  (derived in the view, not a stored field).
- Dossier rows: reuse existing kind/status meta as the collapsed-row tag
  (e.g. `quest`, `blocked`, `open`) — no new helper required.

`currentPlaceId` is derived once per view from
`scenes.find(s => s.id === currentSceneId)?.place_id` and threaded into rows that
need presence (Now + Wiki character rows). `CharacterCard` gains a
`currentPlaceId` prop.

### 5. Collapsed vs expanded content

- **Character (collapsed):** name + badges only.
  **(expanded):** the full existing card body — Mind / Now / History groups,
  reveries, memorable facts, player canon — moved verbatim into the disclosure
  body. No content changes.
- **Scene (collapsed):** `N. Title` + scene badge.
  **(expanded):** opened/updated timestamps + summary.
- **Place (collapsed):** name + optional `current` badge.
  **(expanded):** updated timestamp, description, player canon.
- **Dossier item (collapsed):** title + meta tag.
  **(expanded):** the summary/detail paragraph.

### 6. Component boundaries

- New `Disclosure` primitive + `Badge`/`BadgeRow` presentational helper in
  `WorldInspector.tsx` (consistent with the file's existing co-located
  sub-components; avoids an unrelated file-split refactor).
- Badge *logic* extracted to `src/lib/inspector-badges.ts` so it is testable
  without rendering — the one piece worth isolating.
- `CharacterCard`, scene `<li>`, place `<li>`, and `DossierItem` refactored to
  render header (always visible) + body (in the disclosure).

## Testing & "done"

- **Unit tests** (`tests/inspector-badges.test.ts`) for `inspector-badges.ts`:
  - character: active (no badge), inactive, dead; here vs off-scene; each agency
    level incl. `npc` (hidden); player marker; badge ordering.
  - scene: active vs completed.
- `npm run type-check` and `npm run lint` clean.
- **Browser verification (required):** open the drawer and confirm accordion
  behavior + badges render correctly across Now, Story, and all three Wiki
  sub-tabs, including the active scene auto-open and open-state surviving a turn.

## Out of scope

- No changes to `FullWorldState`, API routes, or persisted data.
- No change to the Archivist tab.
- No change to badge content beyond the four agreed character signals + scene +
  current-place.

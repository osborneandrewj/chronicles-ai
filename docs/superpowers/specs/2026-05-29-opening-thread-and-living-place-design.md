# Opening spine, threat threads, and place granularity

**Date:** 2026-05-29
**Branch:** release/v0.6.13
**Status:** Approved design

## Problem

A freshly created world ("Paris Treadstone 2026", world 7) opened with no story
thread after several turns, a thin ~200-word opening, and an inert living-place
simulation (place "Paris", `kind` empty → profile `generic` → anonymous
bystanders, zero encounter hooks). Root causes, established by inspecting the
live DB and the seed→opening→archivist flow:

1. **No thread bootstrap.** `story_threads` rows are only ever written by
   `archivist.ts`; nothing seeds one at world creation. Organic creation is
   stochastic (world 5 got one on turn 2; world 2 not until ~turn 197). On a
   brand-new world this reads as "broken."
2. **Archivist under-extracts threats.** On the opening turn and after, the
   archivist filed the pursuer ("The Figure in the Dark Overcoat", goal: follow
   the protagonist) as a `characters` row but never elevated the obvious
   "being hunted / reach Switzerland" situation into a `threat`/`quest` thread.
   `sanitizeArchivistPatch` does not strip threads — the model simply never
   proposed one.
3. **Coarse, untyped place.** `createWorld` inserts the place with name +
   description but no `kind`; `derivePlaceName` reduces the location to "Paris".
   `classify()` keys off `place.kind` via `KIND_ALIASES`, so an empty kind on a
   whole-city name returns `generic` and the population templates never match.
4. **No opening guidance.** `OPENING_DIRECTIVE` (opening-turn.ts:16) points the
   narrator at an "Opening a new world" section that does not exist in
   `narrator-system.md`, so the opening defaults to a medium-length beat.

## Changes

### A — Bootstrap a thread on the opening turn (LLM, reuse opening archivist)

- Add an options param to `extractPatch(premise, prior, recent, opts?)` in
  `src/lib/archivist.ts` with `{ isOpening?: boolean }`.
- When `isOpening`, append a mandatory instruction to the archivist user/system
  content: the opening turn MUST create at least one `story_thread` capturing the
  central goal/danger/tension implied by the premise, with an appropriate `kind`
  and 2–5 `relevance_tags`. Prefer `quest` for a goal the protagonist is
  pursuing, `threat` for a danger/clock.
- `generateOpeningTurn` (opening-turn.ts:69) passes `{ isOpening: true }`.
- No new LLM call; the opening archivist already runs.

### B — Archivist threat rule (prompt-only, every turn)

- Edit `prompts/archivist-system.md` (story_threads section, ~line 64): if you
  create or retain an NPC whose active goal is to pursue, follow, menace, or harm
  the protagonist — or any danger/clock bearing down — ensure a `threat` thread
  exists capturing it, with `relevance_tags`. Do not leave the danger recorded
  only as a character.

### C — Place granularity (C1 + C2, both only set `places.kind`)

- **C1 (seed, deterministic):** in `createWorld`, classify the location string
  into a profile-aligned kind using the same keyword logic as
  `place-population.classify()` and write it to `places.kind`. Export a small
  pure `classifyPlaceKind(text)` from `place-population.ts` (returns a concrete
  kind or `null` when no keyword matches) and reuse it so seed and inference
  agree. When it returns `null` (e.g. a bare "Paris"), leave kind unset — C2
  covers it.
- **C2 (opening archivist instruction):** in the `isOpening` instruction, also
  require the archivist to set the starting place's `kind` to the concrete locale
  kind where the scene opens (street, transit, bar, market, hospital, office,
  cafe, restaurant, park, …) via a `places[]` patch on the existing place. This
  populates `place.kind` so `classify()` resolves a real profile.
- No scene re-pointing; we deliberately avoid the v0.6.10 scene-transition
  surface. Occupancy reads the scene's place row, and these changes give that row
  a usable `kind`.

### Opening length — add "Opening a new world" to narrator-system.md

- Add a section instructing: opening turns run long & rich (~450–750 words),
  establish setting, tone, atmosphere, the protagonist's immediate situation and
  sensory grounding, and end on a beat that invites the first action without
  speaking or pre-empting the player. Stay fully diegetic; no fourth wall.

## Testing

- **C1 unit:** `classifyPlaceKind` returns the right kind for keyworded strings
  ("the docks at Marseille" → existing alias; "a dim tavern" → bar) and `null`
  for a bare city. `createWorld` writes `kind` when the location keyword matches
  and leaves it null otherwise. (Use the createWorld test gotcha: distinct place
  names + MAX+1 scene numbers.)
- **A unit:** `extractPatch(..., { isOpening: true })` includes the
  mandatory-thread instruction in the prompt it sends (assert on the assembled
  message), and the non-opening path does not. (Model output itself is not
  asserted — instruction presence is the testable contract.)
- **Prompt edits (B, opening):** covered by an end-to-end manual check, not unit
  tests.

## Done criteria

- `npm run type-check` and `npm test` pass.
- A newly created world streams a long, atmospheric opening and lands with ≥1
  `story_thread` row and a non-`generic` place profile when the locale supports
  one — verified by creating a fresh world end-to-end in the browser.
- No version bump: these are fixes within the unshipped v0.6.13 (PR #20 open to
  main). `package.json` stays at its current value.

# Release Notes / "What's New" UI

**Status:** planned · **Target version:** `v0.3.0` (feature → MINOR) · **Branch target:** `main` · **Authored:** 2026-06-11

## Goal

Give the player (and the dev) a curated, in-app view of what changed in each
release. The version string in the header (`packages/server/src/app/page.tsx:23`,
reading `pkg.version`) is already the load-bearing "what's running" trust signal —
this makes it *clickable* so that number resolves to a human-readable account of
what the version actually contains. Player-facing, plain-language; not a raw commit
log.

## Why now

We are shipping frequently (v0.2.0 → v0.2.5 in days) and the only at-a-glance
signal is the bare version number. A "What's New" surface (a) lets testers see what
landed without reading git, and (b) closes the loop on the existing "version is
load-bearing" release rule by giving each bump a visible payload.

## Locked-in scope (v1)

- **Player-facing, curated highlights** — hand-authored, plain language (no
  "depcruise", "use case", "tolerateNulls"). One short list of highlights per
  released version. NOT auto-generated from commit messages.
- **Surface:** the header version becomes a button that opens a "What's New" dialog
  listing recent versions newest-first. No separate route required in v1 (a
  `/whats-new` page is an optional later slice).
- **Static content, no backend.** Release notes are static presentational data; this
  is a driving-adapter (UI) concern only. No domain entity, no use case, no DB, no
  port. Keep it entirely in `app/` + `components/`.

## Decisions to confirm

1. **Source of truth — typed module vs `CHANGELOG.md`.**
   - **Recommended (v1): a typed data module** (e.g. `app/release-notes/data.ts`)
     exporting `RELEASES: { version: string; date: string; highlights: string[] }[]`.
     Type-safe, no markdown parser, trivial to render. The release-bump checklist
     gains one step: "prepend an entry."
   - Alternative: a root `CHANGELOG.md` (Keep-a-Changelog style) parsed at build.
     More idiomatic for git-diffable content, but adds a parser + a player/dev tone
     split (the changelog tends to drift technical). Defer unless we want a single
     doc that serves both audiences.
2. **Audience tone** — confirm player-facing curated copy (the recommendation), not
   a mirror of the dev changelog.
3. **"New since last visit" indicator** — optional (Slice 3). A small dot on the
   version chip when `RELEASES[0].version !== localStorage.lastSeenVersion`.

## Layering note

Pure presentation. The release data is a static module read by a Server Component;
the dialog is a small `"use client"` component (it needs `useState`/`localStorage`).
Nothing crosses into `domain/`, `application/`, or `infrastructure/`. No new ports,
no dependency-cruiser surface change.

## Implementation slices

### Slice 1 — data module + render (smallest valuable)
- New `app/release-notes/data.ts` (or `components/release-notes/data.ts`):
  `export const RELEASES = [...]`, seeded with the recent real history
  (v0.2.5 NPC fix, v0.2.4 item tracking, v0.2.2 NPC initiation, …).
- A presentational `ReleaseNotes` component rendering the list (version · date ·
  highlights), newest-first.
- *Done when:* the component renders the seeded entries (unit/RTL test or a
  temporary mount).

### Slice 2 — clickable header → dialog
- Make the version chip in `page.tsx:23` a button that opens a `"use client"`
  `WhatsNewDialog` (modal/popover) containing `<ReleaseNotes />`.
- Keep the header a Server Component; isolate interactivity in the dialog child.
- *Done when:* clicking the version in the browser opens the notes and closes
  cleanly; keyboard (Esc) + focus trap behave.

### Slice 3 — "new since last visit" dot (optional)
- `localStorage.lastSeenVersion`; show an unread dot on the version chip when the
  latest release is newer than last seen; clear on open.
- *Done when:* a fresh visitor sees the dot, it clears after opening, and it
  reappears only on the next version.

### Slice 4 — source from `CHANGELOG.md` (optional, only if decided)
- Replace the typed module with a parsed root `CHANGELOG.md`; add the parser + a
  build-time or runtime read. Only if we want one doc for both audiences.

## Process tie-in

Add one line to `docs/RELEASING.md` and the milestone exit-criteria pattern: **"add
a `RELEASES` entry for this version"** as part of every bump — so the header→notes
link never goes stale (mirrors the existing "bump the version" discipline).

## Files touched (anticipated)

**NEW** `app/release-notes/data.ts` · **NEW** `components/.../WhatsNewDialog.tsx` +
`ReleaseNotes.tsx` · `app/page.tsx` (make the version clickable) ·
`docs/RELEASING.md` (checklist line). No `domain/` / `application/` /
`infrastructure/` changes.

# Preventing duplicate-character drift (v0.6.15)

**Date:** 2026-05-29
**Target version:** v0.6.15 (v0.6.14 is already a reserved milestone)
**Branch:** new `release/v0.6.15` off the v0.6.13 line
**Status:** Approved design

## Problem

When an NPC tracked by a descriptor/title ("The Attendant at the Gates") reveals
a proper name ("Jérôme Moreau"), the archivist sometimes emits a brand-new
`characters` row instead of renaming the existing one — producing two rows for
one person. Observed live in world 8 (Geneva Protocol 2026): the apply-side
merge (`runAliasMerges`/`mergeCharacters`) is correct, but it only fires when the
archivist supplies an `aliases` link, and the model omitted it.

A prompt fix already shipped on the v0.6.13 line (a dedicated "A revealed name is
the same person" rule + de-conflicting the `aliases` caution). That lowers the
odds but cannot eliminate them — the archivist is a probabilistic Haiku
extraction. This spec adds **defense in depth**: make the right action easier for
the model, add a deterministic backstop that surfaces duplicates that still slip
through, and keep remediation a single command. No automatic merging (a wrong
merge fuses two real people and is hard to undo).

## Architecture

Three layers along the existing pipeline, no new migration, no persistence,
no auto-merge:

```
narrator prose
  → extractPatch        (Layer 1: mark descriptor placeholders in context)
  → Haiku
  → patch               (Layer 3: reveals_name_of channel)
  → applyArchivistPatch (Layer 3 routes through existing runAliasMerges)
  → characters table
  → findLikelyDuplicateCharacters (Layer 2, pure)
       ├─ getFullWorldState → inspector "Archivist" tab (live)
       ├─ chat route post-apply → console.warn (no LLM)
       └─ scripts/merge-characters.mjs --detect (mirrors rules in JS)
```

## Layer 1 — Mark descriptor placeholders in archivist context

- New pure `isDescriptorName(name: string): boolean`. Heuristic: leading article
  + role noun and no proper-noun token — `"The Attendant at the Gates"`,
  `"the bartender"`, `"A Man in a High-Vis Vest"` → true; `"Jérôme Moreau"`,
  `"Marcus Reeves"` → false. Location: `src/lib/character-identity.ts` (new, small,
  shared by Layers 1 and 2).
- In `extractPatch`'s prior-state block (`archivist.ts` ~304–315), add
  `descriptor_placeholder: true` to each present non-player character the helper
  flags, and add one point-of-use line to the user content near the cast: *"A
  figure marked `descriptor_placeholder` is an unnamed stand-in; if it is named
  this turn, rename that row (set its `name` + `reveals_name_of`) — do not create
  a new character."*
- Reinforces the existing prompt rule exactly where the model reads the roster.

## Layer 2 — Deterministic duplicate detector (flag only)

- New pure `findLikelyDuplicateCharacters(chars: Character[]): DuplicatePair[]` in
  `src/lib/character-dedup.ts`. `DuplicatePair = { aId, bId, aName, bName, reason }`.
- Recall-favoring rules (review-only, so a few false positives are acceptable; a
  miss is not). For each unordered pair of **active, non-player** characters, flag
  when any holds:
  - **(a) descriptor + named, same place:** both share a non-null
    `current_place_id`, exactly one is `isDescriptorName`. reason:
    `"descriptor + named at same place"`.
  - **(b) shared distinctive fact:** they share a normalized
    `memorable_facts`/`observations` line (provenance stripped, length-gated to
    avoid matching boilerplate). reason: `"shared memorable fact"`.
  - **(c) near-identical name key:** `canonicalCharacterKey(a) === canonicalKey(b)`
    but the display names differ. reason: `"near-identical name"`.
- Three consumers, one rule source in TS:
  1. `getFullWorldState(worldId)` adds `potentialDuplicates: DuplicatePair[]` to
     `FullWorldState` (computed live). `WorldInspector` renders a **Potential
     duplicates** section in the **Archivist** tab: each pair's names, ids,
     reason, and the exact `node scripts/merge-characters.mjs --world <id>
     --canonical <id> --dupe <id>` command.
  2. Chat route, after `applyArchivistPatch`: call the detector for the world and
     `console.warn('[dup-detector] world N: "A" (#x) ~ "B" (#y) — <reason>')` for
     any pair. Wrapped so it never blocks a turn. No LLM cost.
  3. `scripts/merge-characters.mjs --detect --world N` prints candidate pairs. The
     script mirrors the rules in JS, matching the existing convention where it
     already mirrors `mergeCharacters` (accepted duplication; the rules are small
     and a comment cross-links the TS source of truth).

## Layer 3 — A safe, dedicated rename channel in the patch schema

- Add `reveals_name_of: z.string().optional()` to `CharacterPatchSchema`,
  described as: *"the existing descriptor/title or prior name of the figure this
  row IS. Set when a figure you already track is given or reveals a proper name:
  put the proper name in `name` and the old descriptor here. The named existing
  row is renamed and merged into this one — the safe way to handle a name
  reveal."*
- In `applyArchivistPatch`'s character handling, a patch carrying
  `reveals_name_of` routes into the existing tested machinery:
  `runAliasMerges(worldId, patch.name, [patch.reveals_name_of])`. Same guards as
  `aliases` — ignored if it names a missing row, the player row, or resolves to
  the same row.
- Update the prompt's "A revealed name is the same person" rule to name
  `reveals_name_of` as the preferred field (clearer and lower-risk than
  `aliases`, which the model treats as dangerous).

## Error handling

- The detector is pure and best-effort; its runtime call is wrapped so a throw
  never blocks narration (mirrors the NPC-agent / occupancy degradation pattern).
- `reveals_name_of` pointing at a missing, ambiguous, or player row is silently
  ignored — no row is created or destroyed on a bad pointer.
- No automatic merges anywhere; the player/dev always confirms.

## Testing

- `isDescriptorName`: positives (descriptor/title names) and negatives (proper
  names, single mononyms like "Marcus").
- `findLikelyDuplicateCharacters`: flags the exact Attendant/Jérôme shape (rule a);
  flags a shared-fact pair (rule b); **does not** flag two distinct proper-named
  NPCs at the same place; does not flag a character against itself or the player.
- Apply path: `{ name: 'Jérôme Moreau', reveals_name_of: 'The Attendant at the
  Gates' }` collapses to one row, `local` agency preserved, descriptor carried as
  alias (reuses the merge assertions from the v0.6.13 regression test).
- Manual: open the inspector on a world with a seeded duplicate; confirm the
  Archivist tab lists it with a runnable merge command.

## Done criteria

- `npm run type-check` and `npm test` pass.
- A seeded descriptor→proper-name reveal that omits the alias is surfaced in the
  inspector and logged; supplying `reveals_name_of` collapses it to one row.
- `package.json` + `package-lock.json` read `0.6.15` on the `release/v0.6.15`
  branch (per the version-bump rule in CLAUDE.md); dev server restarted and the
  header confirmed.
- `docs/plans/milestones/v0.6.15.md` created with exit criteria following the
  milestone template.

## Out of scope (YAGNI)

- Automatic merging (structural or verifier-gated) — flag-only this round.
- Persisting flags / a `character_duplicate_flags` table — recompute live.
- Any change to the player-facing correction channel.

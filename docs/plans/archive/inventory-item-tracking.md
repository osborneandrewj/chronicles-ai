# Item / Inventory Tracking

**Status:** implemented (v0.2.4, 2026-06-10) · **Branch target:** `onion-arch-refactor` · **Authored:** 2026-06-10

> **Implemented in v0.2.4.** Slices 1–3 shipped: the drop-bug COALESCE→CASE fix
> (tri-state `held_by_name` / `location_name`; `clear_held_by` / `clear_location`
> on `UpdateStoryResourceInput`, mirrored in SQLite + Mongo); the pure
> `domain/services/inventory-resolution.ts` service (`resolvePossession`
> mutual-exclusion + `playerPossesses`) wired into `apply-archivist-patch`; an
> **ITEMS HERE** block and per-NPC `carries (authoritative)` line in
> `state-block.ts`; the narrator "Tracked Objects" rigidity rule and the archivist
> drop/store rule; and deterministic `extractItemMovements` (drops/gives) gated by
> `playerPossesses` in the `extractDeterministicPatch` pipeline. Slices 4
> (quantity/consumables) and 5 (NPC↔NPC autonomy) remain deferred. The optional
> narrator-guidance object-manipulation cue was intentionally skipped — the
> system-prompt rule plus the pinned state-block ledger carry the rigidity, and a
> blanket guidance cue had no clean access to possession state.

## Goal

Make item possession *rigid*: the player (and NPCs) cannot use an item they don't
have, and the narrator must not invent load-bearing objects from thin air — while
keeping the narrator's freedom over ambient set-dressing. The archivist tracks what
each character carries on their person, and where important items are stored or
dropped (room floor, locker, handed to another character).

## Headline finding

This is **~70% already built**. Migration 30 created a `story_resources` ledger; the
A4 follow-up (`migrations.ts:893-906`) added `held_by_character_id`,
`location_place_id`, and `salient`. The archivist already emits a
`StoryResourcePatchSchema` (`lib/archivist.ts:178`), a deterministic extractor
auto-promotes objects the player grabs, and the player's carried items are already
pinned into the narrator context every turn ("CARRIED / TRACKED OBJECTS",
`state-block.ts:82-89`).

We are **finishing and constraining** that ledger, not building inventory from scratch.

## The four real gaps

1. **Drops/stores are silently impossible.** `dossier-writer.sqlite.ts:155-156` wraps
   `held_by_character_id` and `location_place_id` in `COALESCE(?, …)`, so a `null`
   never clears a column. Requirement "track dropped/stored items" cannot work until
   this is fixed. **This is a live correctness bug.**
2. **The narrator can't see room contents or NPC-held items** — only the player's own
   carried list is rendered.
3. **No prompt rule** forbidding the narrator from inventing tracked items.
4. **No quantity** for consumables (deferred — see decisions).

## Possession model

An item row is in exactly one state:

| State | `held_by_character_id` | `location_place_id` |
|---|---|---|
| Carried by a character | set | NULL |
| Placed (floor, locker, …) | NULL | set |
| Lost / missing | NULL | NULL (+ `status='missing'`) |

Mutual exclusion is enforced by a new pure domain service, not by the schema.

## Rigidity model

Strictness keys off `salient`:

- **`salient = 1`** (weapons, keys, evidence, companions) → **hard**. The narrator
  must never invent one and must treat `held_by` as the single source of truth, even
  against older prose.
- **`salient = 0` / untracked** → **soft**. Ambient set-dressing the narrator may
  invent or mention freely. The instant the player *takes* an ambient object, the
  existing deterministic extractor promotes it to a tracked, held resource.

When a player reaches for an item they don't have, the narrator **narrates the
absence in-world** (reaches for it, finds it gone / never had it) — no hard block, no
turn rejection. The correction channel patches `story_resources` directly if it was a
genuine mistake.

## Locked decisions (2026-06-10)

- **Quantity / consumables: deferred.** Worlds are unique-object-centric. Slice 4 only
  if a survival/RPG world needs it.
- **Missing-item handling: in-world narration only.** No out-of-band UI hint in v1.
- **NPC item movement: player-centric.** NPCs can hold items and hand them over when
  the player/narrator drives it, but do **not** autonomously trade among themselves.
  (Slice 5 deferred.)
- **Item permanence: permanent.** A dropped key is still there on return. No GC in v1.

## Implementation slices

### Slice 1 — Fix the drop bug + render "ITEMS HERE" (smallest valuable slice)
- Tri-state `held_by_name` / `location_name` in `StoryResourcePatchSchema`
  (`lib/archivist.ts`): `undefined` = unchanged, `null` = clear, `string` = set.
- Add `clear_held_by` / `clear_location` flags to `UpdateStoryResourceInput`
  (`domain/ports/dossier-writer.ts`).
- Replace the COALESCE for those two columns with a
  `CASE WHEN ? THEN ? ELSE COALESCE(?, col) END` in
  `dossier-writer.sqlite.ts:155-156`; mirror in `dossier-writer.mongo.ts`.
- New pure service `domain/services/inventory-resolution.ts`: resolves item movements
  from prior rows + patch, enforces mutual exclusion, canonicalizes names (reuse the
  `normalize`/`containsAsPhrase` helpers in `patch-sanitizer.ts`), exposes
  `playerPossesses(prior, name)`.
- Wire it into `apply-archivist-patch.ts` `upsertStoryResource` inside the existing
  `unitOfWork.run` transaction (post-stream).
- Render an **ITEMS HERE** block in `state-block.ts` (after present-characters loop):
  resources where `location_place_id === currentPlace.id && held_by === null`,
  salient-first, cap ~6.
- *Done when:* a patch with `held_by_name:null, location_name:'Locker'` actually moves
  the row (unit test — currently silently no-ops); ITEMS HERE renders in a streamed
  browser turn.

### Slice 2 — Narrator rigidity prompt + NPC-held visibility
- Add the "Items the protagonist holds" + "What you may still invent" rules to
  `prompts/narrator-system.md` under the "State is Authoritative" guardrail.
- Render NPC-carried salient items per present NPC in `state-block.ts` (cap ~2/NPC).
- Optional one-line cue in `domain/services/narrator-guidance.ts` when the classifier
  flags object manipulation.
- *Done when:* a browser turn where the player tries to draw an untracked weapon
  produces graceful in-world narration, not invention.

### Slice 3 — Deterministic drop/give extraction
- Add `extractItemMovements()` alongside `extractObjectAcquisition()` in the
  `patch-sanitizer.ts` pipeline: detect drops ("I drop/leave/stash X") and gives
  ("I hand Torres X"), mirroring `object-acquisition.ts` patterns. Gates the Haiku
  call for common moves.
- *Done when:* pure unit tests — "I drop the key on the floor" → location-set patch;
  "I hand Torres the pistol" → holder=Torres.

### Slice 4 — Quantity / consumables (deferred)
- Migration v33: `addColumnIfMissing(db,'story_resources','quantity','INTEGER NOT NULL DEFAULT 1')`;
  add `quantity` to the Mongo `StoryResourceDoc` + mapper **in the same commit**.
- `quantity: z.number().int().min(0).optional()` in the patch schema; apply-path
  decrement / zero = spent; archivist prompt consumption rule.

### Slice 5 — NPC↔NPC autonomy (deferred)
- `item_transfer` on `NpcUpdateSchema` + reconciliation. Only after 1–3 prove out.

## Files touched (all verified to exist)

`lib/archivist.ts` · `prompts/archivist-system.md` · `prompts/narrator-system.md` ·
`domain/services/patch-sanitizer.ts` · `domain/services/object-acquisition.ts` ·
**NEW** `domain/services/inventory-resolution.ts` ·
`application/use-cases/apply-archivist-patch.ts` · `domain/ports/dossier-writer.ts` ·
`infrastructure/persistence/sqlite/dossier-writer.sqlite.ts` ·
`infrastructure/persistence/mongo/{models/index.ts,repositories/dossier-writer.mongo.ts,repositories/mappers.ts}` ·
`server/render/state-block.ts` · `domain/services/narrator-guidance.ts` (optional).
Slice 4: `lib/migrations.ts` (v33). Slice 5: `lib/npc-agent.ts`.

## Layering note

Deciding logic (movement resolution, mutual-exclusion, name canonicalization,
possession test) lives in the pure `inventory-resolution.ts` service run by the use
case. Adapters stay dumb CRUD; the COALESCE→CASE change is a mechanical port-shape fix.
No new cross-layer imports.

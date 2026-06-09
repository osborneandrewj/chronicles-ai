# Plan: Finish the MongoDB Cutover (P3 manual gate)

Status: **in progress** · 2026-06-09 · branch `onion-arch-refactor`

Make `PERSISTENCE=mongo` a fully working LIVE path for the whole app (create → play a
turn → archivist updates state → narrator context), without breaking the SQLite path.
The SQLite suite (`npm test`) stays byte-green AND `npm run test:mongo` stays green after
every phase. Blueprint target: two adapter sets behind one port set, store chosen in the
composition root; Mongo uses a `counters` collection (`nextSeq`) so every collection has a
monotone **integer** id — ordering never depends on `ObjectId`.

## Root cause (why a Mongo world shows Mevagissey)
Mid-migration **split-brain**: the homepage list + bounded-creation go through repository
PORTS (→ Mongo), but the play/narrator/opening/world-creation paths still call legacy
`lib/` modules that hit `better-sqlite3` directly. So a Mongo-created world's opening turn
+ state are written into SQLite under a colliding autoincrement id, and `/play` reads the
SQLite default world (#1 = "Mevagissey 1897"). The Mongo id model is fine; the **write
target** is wrong.

## The dominant gap: the archivist write surface
`lib/archivist.ts applyArchivistPatch` issues ~35 INSERT/UPDATE/DELETE across
`places, characters, scenes, worlds, story_threads, story_clues, story_objectives,
story_resources, timeline_events` directly on `db`. Existing repos expose only narrow CRUD
(`add`/`setPlace`/reads); there is **no mutation port for the dossier** and no UPDATE/DELETE
surface for characters/places/scenes. This is the biggest piece of work (Phase 4).

## SQLite-coupled `lib/` modules to strangle
`db.ts` (the singleton + most CRUD), `world-state.ts` (narrator-context assembler),
`worlds.ts` (`createWorld`/`createBoundedWorld`/cursor), `opening-turn.ts`, `archivist.ts`,
`npc-agent.ts`, `npc-intents.ts`, `npc-promotion.ts`, `reveries.ts`, `place-population.ts`,
`intent-reconciler.ts`, `place-resolver.ts`. (`classifier.ts`, `region-extractor.ts`,
`cost-cap.ts` are already store-agnostic / strangled.) The SQLite-coupled HEART of the turn
loop is `infrastructure/narrator/narrate-turn.ts`, which reaches across into all of the
above; under `PERSISTENCE=mongo` that whole path silently uses SQLite.

These lib modules CANNOT be made store-agnostic in place (they import the module-level
SQLite singleton). Strangler pattern: convert each into a use-case/domain-service taking
injected ports; the route/container wires the active store's adapter. SQLite adapters
DELEGATE to the existing `lib` SQL so the SQLite path stays byte-identical.

## Phases (lowest-risk first; SQLite + test:mongo green after each)

**Phase 0 — safety net (first).**
- Regression test (tests/mongo/): `createBounded → getWorld` round-trips an INTEGER id and
  `spatial_mode='bounded'`.
- New Mongo e2e harness (`tests/mongo/turn-pipeline.test.ts`, initially skipped/partial):
  boots the container with `PERSISTENCE=mongo`, seeds via ports, will assert a turn
  round-trips. Each later phase un-skips a slice.

**Phase 1 — strangle world CREATION onto a `CreateWorld` use case** (fixes the visible split).
- `WorldRepository.createOpen(input)` + `setSettingRegion` (port + both adapters; SQLite
  delegates to `lib/worlds.createWorld`, Mongo writes world + seed place/character/scene +
  cursor via `nextSeq`).
- `application/use-cases/create-world.ts`; repoint `new/actions.ts:createAndOpenWorld`.
- Verify: SQLite byte-green; Mongo creates an open world readable on homepage + `/play`.
- (Parallelizable with Phase 2 — different files.)

**Phase 2 — strangle READ state** (`getNarratorWorldState` + `recentTurns` reads) onto ports.
- Move the world-state assembler to take read ports (characters/places/scenes/dossier/
  occupancy/reveries/cursor). Repoint `narrate-turn.ts`/`opening-turn.ts` reads + the chat
  route's `activeSceneId` to the container.
- Verify: SQLite byte-green; Mongo narrator-context assembly returns the seeded world.

**Phase 3 — strangle the non-archivist post-stream writers** (turns, reveries, occupancy,
npc-intents, npc-promotion) onto their ports. Sequential after 2 (shares narrate-turn).
- `insertTurn`/`updateTurnMetadata` → `TurnRepository`; reveries → `ReverieRepository`;
  occupancy snapshots → `OccupancyRepository`; appearance/tier bumps → new
  `CharacterRepository` setters; intents → `NpcIntentRepository`.
- The four sub-strangles are independent port additions; stage as "each adds port+adapter,
  then ONE integration commit repoints narrate-turn".
- Verify after each: SQLite byte-green; Mongo e2e asserts those rows land in Mongo.

**Phase 4 — THE RISKY PHASE: strangle `applyArchivistPatch` onto ports.**
- New write surface: dossier write methods (threads/clues/objectives/resources) on
  `DossierRepository`/a `DossierWriter`; UPDATE/DELETE/merge on Character/Place/Scene repos;
  timeline via `TimelineWriter.append`. Each on port + both adapters (SQLite delegates to the
  existing archivist SQL).
- De-risk: (1) existing characterization tests (`archivist.test.ts`, `name-resolution`,
  `scene-transition`) are the frozen oracle and must stay byte-green; (2) wrap the patch in
  `UnitOfWork` (both stores have it; Mongo seq is session-aware); (3) convert to a use case
  `apply-archivist-patch.ts` taking the port bag; (4) STORE-strangle only — do NOT also do the
  NameResolution/NpcPromotion "MergePlan" rewrite here.
- Repoint `narrate-turn.ts` + `opening-turn.ts`.
- Verify: full SQLite suite + characterization tests byte-green; Mongo e2e asserts the
  archivist mutates Mongo dossier/characters/places after a turn.

**Phase 5 — strangle the opening turn + wire `narrate-turn` through the container** (last).
- `generateOpeningTurn` → use case taking ports; repoint `new/actions.ts`. Make
  `narrate-turn.ts` RECEIVE the port bag (injected by `chat/route.ts`) instead of importing
  `lib/*`. This makes the full Mongo create→opening→play→archivist loop Mongo.
- Verify: the Mongo e2e turn test is UN-SKIPPED and green; **a manual browser turn on
  `PERSISTENCE=mongo`** (the real exit criterion).

**Phase 6 — guard rails + cleanup.**
- Tighten the depcruise `better-sqlite3` allowlist; grep-guard that narrate-turn/opening-turn
  no longer import `@/lib/db`. Leave SQLite adapter + migrations (P7 deletion is a later gate).

## Sequencing
Strictly sequential: Phase 0 → all; Phase 2 → 3 → 4 → 5 (all share `narrate-turn.ts`).
Parallelizable: Phase 1 alongside Phase 2; the Phase-3 sub-strangles (with a single
narrate-turn integration commit). Phase-4 port DEFINITIONS can be designed early; the repoint
lands after Phase 3. **Riskiest = Phase 4** — de-risked by the frozen characterization tests,
`UnitOfWork`, and store-strangle-only discipline.

## Note
Delete the orphaned empty Mongo "Scout Vessel" world (created by the pre-fix stale container)
once the create flow is fully Mongo.

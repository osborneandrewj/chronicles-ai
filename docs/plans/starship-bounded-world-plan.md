# Plan: Bounded "Starship" Worlds + Player-less Pre-Sim

Status: **draft for review** · 2026-06-09 · branch `onion-arch-refactor`

A concrete, small instance of two capabilities the living-world roadmap parks as
"the hard parts": a **bounded spatial mode** (designed interiors, fixed topology)
and a **player-less forward simulation** (the world is alive before you arrive).
The starship is the ideal first instance because it is naturally small and closed.

## Goal

Create a new *type* of world — a small ship with **pre-defined, consistent
architecture** (bridge, crew quarters, sim deck, engine room, mess, med-bay) and
a stable room-connectivity graph; seed **3–5 crew NPCs**; run **~24–48 ticks** of
deterministic NPC life (movement, co-location, occasional conversation/planning
beats) *before any player turn exists*, so that when the player joins the world is
already mid-motion.

### Explicitly out of scope (now)
- **Map rendering.** We capture topology (rooms + connections + deck/layout hints)
  so a map is *possible*, but draw nothing yet.
- **Replacing open-world creation.** This is a new mode alongside today's open/OSM
  path, gated by `spatial_mode`.
- **LLM-driven per-tick NPC cognition.** Movement is pure code; LLM is reserved
  for threshold-gated beats only.

### Locked decisions (2026-06-09)
1. **Topology = authored templates + LLM dressing.** A small library of ship
   archetypes with hand-authored rooms + connectivity graph; the LLM only fills
   names, room descriptions, and crew. Guarantees a valid, consistent, map-able
   graph for free.
2. **Compact persistence.** Keep final NPC positions, the relationship graph, and
   a handful of notable beats as readable recent-history. Discard per-tick ambient
   movement.
3. **Deterministic moves + threshold-gated beats.** Pure-code movement/routines;
   LLM fires only when co-located NPCs have real tension and a cooldown elapsed.
   Target: < ~$1 and < ~3 min per world.

## Architecture overview

Two new use cases, a handful of pure domain services, three or four new ports, and
three migrations. Built in the onion layout (NOT `lib/`).

```
SeedBoundedWorld (use case)
  ├─ DeckPlanProvider port → authored template (rooms + graph + crew roles)
  ├─ writes places + place_connections (topology)
  ├─ LLM dressing/crew (Grok or Haiku) → characters + character_relationships + daily_loop
  └─ writes initial scene + spatial_mode='bounded' on world

SimulateWorldForward (use case, run via BackgroundTasks after seed)
  loop N ticks (a tick = one WorldTimeBand):
    ├─ npc-movement (pure)        : daily_loop + band + deck-graph → next room
    ├─ colocation (pure)          : group NPCs by current_place_id (reuse occupancy-sim)
    ├─ beat-gating (pure)         : tension(relationships) + cooldown → spend a beat?
    │     └─ DramaPort (Haiku)    : co-located group + goals/relationships → structured beat
    ├─ relationship-drift (pure)  : apply valence deltas from beat outcome
    └─ persist: current_place_id, character_relationships, timeline_events(sim_tick)

Player joins → opening turn assembled from sim end-state (positions + recent beats)
```

## Data model / migrations

Latest migration is **v25**. Add three, each idempotent DDL + a matching Mongoose
model in `infrastructure/persistence/mongo/models/`.

**v26 — bounded spatial mode + topology**
- `worlds.spatial_mode TEXT DEFAULT 'open'` (`open` | `bounded`)
- `worlds.template_id TEXT` (which deck-plan seeded it; null for open)
- `places.deck TEXT` (deck/level grouping for future map layering)
- `places.layout_hint TEXT` (nullable JSON `{x,y}`/zone for future map)
- `place_connections (id, world_id, from_place_id, to_place_id, kind TEXT,
  bidirectional INTEGER DEFAULT 1, created_at)` — `kind`: corridor/hatch/door/
  ladder/airlock. The topology graph.

**v27 — relationship graph** (the roadmap's "key missing table")
- `character_relationships (id, world_id, from_character_id, to_character_id,
  kind TEXT, valence REAL DEFAULT 0, note TEXT, updated_at)` — `kind`: rival/ally/
  mentor/romance/superior/subordinate/…; `valence` in −1..1 drives drift + beat
  gating.

**v28 — sim provenance on the timeline**
- `timeline_events.turn_id` → make **nullable** (sim events have no player turn).
- `timeline_events.sim_tick INTEGER` (nullable) + `provenance TEXT DEFAULT 'turn'`
  (`turn` | `sim`). Keeps ONE timeline the narrator already reads, instead of a
  parallel table. This is the concrete fix for the roadmap's "turn-coupled `[t:N]`
  provenance" landmine.

No new runtime-state table: final positions live on `characters.current_place_id`,
relationship state on `character_relationships`, history on `timeline_events`.

## New domain services (pure, `domain/services/`)
- `deck-graph.ts` — adjacency / neighbors / next-hop / **connectivity validation**
  (no orphan rooms; every room reachable from the bridge).
- `npc-movement.ts` — `(daily_loop, band, currentPlace, graph) → nextPlaceId`.
  Skeleton rule: move toward the routine's target room for this band (teleport for
  a 6-room ship; graph used for validation + future travel-time).
- `colocation.ts` — group NPCs by room this tick (lean on `occupancy-sim.ts`).
- `beat-gating.ts` — `(group, relationships, lastBeatTick) → boolean` tension +
  cooldown gate. Pure; the only thing that authorizes LLM spend.
- `relationship-drift.ts` — apply valence deltas from a beat outcome.

## New ports (`domain/ports/`) + adapters (`infrastructure/`)
- `deck-plan-provider.ts` — returns authored templates (rooms, graph, crew roles).
  Adapter reads from a `ship-templates/` constant or dir.
- `place-connection-repository.ts` — CRUD topology edges.
- `relationship-repository.ts` — CRUD `character_relationships`.
- `drama-port.ts` (the roadmap's `LlmDramaPort`) — `(group, relationships, threads)
  → structured beat`. Haiku-backed. Beats are structured event summaries (not full
  generated dialogue) per the "compact" decision.
- Timeline **write** access: today `dossier-repository` only reads. Add a
  `timeline-repository` write port (or extend dossier) so the sim can append events.

All four/five register in `composition/container.ts` (`Container` type + both the
SQLite and Mongo builders).

## Reuse map (don't rebuild)
- **Routines** → `characters.daily_loop` (v24) already models `WorldTimeBand →
  {activity, place}`. Seeding sets each crew member's loop to real rooms.
- **Time bands** → `world-clock.ts: worldTimeBand()`. A **tick = one band**, so
  ~4 ticks/in-world-day; 24–48 ticks ≈ 6–12 days.
- **Co-location / occupancy** → `occupancy-sim.ts` grouping + `occupancy-repository`.
- **Name → room snapping** → extend `name-resolution.ts: placesMatch()` to resolve
  against the fixed room manifest.
- **Reverie repeat-avoidance** (Jaccard) → reuse so beats don't repeat.

## Agent behavior forks (gated on `spatial_mode='bounded'`)
- **Narrator** (`prompts/narrator-system.md`): inject a **ship bible** (room
  manifest + current NPC positions) and a rule — *only reference known rooms;
  movement only across connections; never invent a deck.* Build the block in the
  context assembler (`lib/world-state.ts`, being strangled), appended for bounded
  worlds.
- **Archivist** (`prompts/archivist-system.md`): in bounded mode **do not create
  new top-level places** — snap mentioned locations to existing rooms. This inverts
  today's "places emerge from prose" assumption; it is the subtlest behavioral
  change and must be mode-gated so open worlds are unaffected.
- **Join hand-off**: a `BOUNDED_OPENING_DIRECTIVE` replacing today's "no history
  yet" — *the world is mid-motion; here is recent history and where everyone is;
  open in medias res.* The state block includes current positions + recent
  `provenance='sim'` timeline events.

## Cost model (sanity check)
- Crew + dressing: 1–2 LLM calls at seed.
- Sim: ~24–48 ticks, beats gated → estimate ≤ ~15 beats, Haiku, structured → cents.
- Comfortably under the < ~$1 / < ~3 min budget. The deterministic spine is free.

## Walking-skeleton sequencing
Each phase ends with a concrete, verifiable artifact. Per CLAUDE.md, a sim/narrator
change isn't "done" until a turn streams end-to-end in the browser.

- **P0 — schema + types.** Migrations v26–v28, entities, ports (no behavior). Boot
  applies clean; typecheck + `depcruise` green.
- **P1 — seed one hardcoded ship.** `DeckPlanProvider` returns a single "scout"
  template; `SeedBoundedWorld` writes places + connections + crew + relationships +
  daily_loops. Verify via an **offline script** (`scripts/seed-ship.mjs`, roadmap's
  "offline script first") that the DB holds a connected ship + 3–5 crew.
- **P2 — deterministic sim, no LLM.** `SimulateWorldForward` runs movement +
  co-location + drift for N ticks, logs deterministic events. Verify NPCs move
  sanely and end in plausible rooms; `deck-graph` validation passes.
- **P3 — threshold-gated beats.** Add `DramaPort` (Haiku); a few beats generate and
  persist as `provenance='sim'` timeline events. Verify spend stays in budget.
- **P4 — join hand-off.** Bounded opening directive + assembler surfaces positions
  and recent beats; **play a turn in the browser** and confirm it reads as alive.
- **P5 — harden + generalize.** Agent forks (narrator room-constraint, archivist
  snap-to-room), creation UI + "world warming up" state, Mongo model/repo parity,
  add a second ship template.

## P1 prerequisites (discovered during P0)
The live SQLite read paths delegate to legacy `lib/` modules whose row types
partially shadow the domain entities, masked by `as` casts — so a field added to a
domain entity is NOT automatically returned at runtime. P0 fixed the urgent one;
P1 must close the rest **before** seeding/branching on them:
- **World (fixed in P0):** `lib/worlds.ts` `getWorld`/`createWorld` now SELECT/RETURN
  `spatial_mode` + `template_id` so `world.spatial_mode === 'bounded'` is real, not
  `undefined`. The `WorldRepository` port uses `lib/worlds`' `World` (a re-export of
  the domain `World`), so this flows through.
- **Place (P1):** `PlaceRepository` reads through `lib/world-state`'s `Place` type,
  which does NOT carry the new `deck`/`layout_hint`. When seeding writes `deck` and
  the sim reads it, extend that read type + its SELECT (or give bounded worlds a
  dedicated place read), or `place.deck` will be `undefined` at runtime.
- **TimelineEvent (P3/P4):** same masked-cast risk for `sim_tick`/`provenance` on
  whatever path reads timeline rows for narrator context — verify the SELECT carries
  them before relying on `provenance === 'sim'`.

## P1 implementation spec (seed pipeline — binding for the build)
P0 left the write repos as ports only and the place/character repos read-only.
P1 adds the minimal write surface and the seed use case. Decisions are fixed here
so the implementation stays coherent.

**Write surface** (extend existing ports + add BOTH SQLite and Mongo adapters —
CRUD includes create):
- `WorldRepository.createBounded({ name, premise, initialStateJson, templateId }):
  Promise<{ id: number }>` — inserts ONLY a `worlds` row with `spatial_mode='bounded'`.
  It must NOT auto-seed a place/character/scene the way `lib/worlds.createWorld`
  does for open worlds (the seeder writes its own rooms/crew).
- `PlaceRepository.add({ world_id, name, description, kind, deck, layout_hint }):
  Promise<{ id: number }>`.
- `CharacterRepository.add({ world_id, name, description, is_player, current_place_id,
  role, active_goal, daily_loop }): Promise<{ id: number }>` (daily_loop is JSON text).
- `PlaceConnectionRepository.add` and `RelationshipRepository.upsert` already exist as
  ports — implement their SQLite + Mongo adapters (neither has one yet).
- Read-path fix: extend `lib/world-state`'s `Place` type + its SELECT to carry `deck`
  + `layout_hint` so seeded decks read back (the flagged Place prerequisite).

**CrewGenerator port** (`domain/ports/crew-generator.ts`) — the Grok seam:
- In: `{ template: DeckPlanTemplate, premise: string, playerName?: string }`.
- Out (Zod-validated in the adapter): `{ shipName, premise, roomDressing: [{ key,
  description }], crew: [{ role, name, persona, goal, homeRoomKey, dailyLoop }] (3-5),
  relationships: [{ fromRole, toRole, kind, valence (-1..1) }] }`.
- Impls: `GrokCrewGenerator` (`infrastructure/world-gen/`) — `generateObject` with
  `grok-4.3` via `@ai-sdk/xai`, model id from `infrastructure/llm/`, prompt from
  `prompts/crew-dressing.md`. Plus a deterministic `StubCrewGenerator` for tests +
  the offline script (no spend, no key).

**SeedBoundedWorld use case** (`application/use-cases/seed-bounded-world.ts`):
- Deps: `{ decks, crew, worlds, places, placeConnections, characters, relationships,
  clock }`. Pure orchestration — no SQL/SDK.
- Flow: getTemplate → createBounded world → write rooms (map `room.key` → new place id),
  apply roomDressing → write edges (map keys → ids) → crew.generate → write crew
  (`homeRoomKey` → `current_place_id`, daily_loop) → upsert relationships (role →
  character id) → validate with `deck-graph.isConnected` (throw if not) → return
  `{ worldId, placeIds, characterIds }`.

**Offline script** `scripts/seed-ship.mjs`: build the container, swap in
`StubCrewGenerator`, run `SeedBoundedWorld` against a temp SQLite DB
(`DATABASE_PATH=/tmp/...`), print rooms + graph + crew + relationships, assert the
graph is connected and crew count is 3-5. The real `GrokCrewGenerator` is wired in the
container; a live Grok smoke test is a manual follow-up, not part of the automated run.

**Deferred to P4:** the initial active scene + world cursor (needed for `/play`, not
for the P1 "DB holds a connected ship + crew" proof).

## P2 implementation spec (deterministic forward sim — binding)
The player-less sim loop, deterministic only (no LLM — beats are P3). Proves NPCs
move on their routines over N ticks and the world clock advances; persists compact
end-state (final positions + relationship drift + world time), per the locked decisions.

**New pure domain service** `domain/services/sim-clock.ts`:
- A tick = one `WorldTimeBand`. `tickToBand(tick): WorldTimeBand` cycles
  morning→midday→evening→night. `tickToWorldTime(tick, startDay=1): string` → a
  label like `Day 1 — morning` (so ~4 ticks/day; 24 ticks ≈ 6 days). Pure, tested.

**Add to `domain/services/relationship-drift.ts`:** `coLocationOutcome(valence:
number): BeatOutcome` — the deterministic drift trigger (valence ≥ 0 → 'positive'
i.e. allies bond when together; < 0 → 'negative' i.e. rivals chafe). Tested.

**Write surface** (ports + SQLite + Mongo adapters):
- `CharacterRepository.setPlace(characterId: number, placeId: number | null): Promise<void>`.
- `WorldRepository.setWorldTime(worldId: number, worldTime: string): Promise<void>`.
- Reuse the existing `RelationshipRepository.adjustValence(id, delta)` (delta-based) —
  no new relationship write.

**SimulateWorldForward use case** (`application/use-cases/simulate-world-forward.ts`):
- Deps: `{ characters, placeConnections, relationships, clock }`. Pure orchestration.
- Load: NPCs (`is_player=0`) with `current_place_id` + parsed `daily_loop` JSON
  projected to `ResolvedDailyLoop` (band → place_id); `place_connections` →
  `buildDeckGraph` → `neighborsOf`; relationships (held as a mutable working copy).
- Loop `tick = 0..N-1`: `band = tickToBand(tick)`; per NPC `nextPlaceId(...)` →
  update in-memory position; `coLocatedGroups(...)`; for each relationship whose
  both endpoints are co-located, `applyDrift(workingRel, driftFromOutcome(
  coLocationOutcome(workingRel.valence)))` (clamped in-memory).
- Persist ONCE at the end (compact): `setPlace` per NPC (final room),
  `adjustValence(id, finalValence − originalValence)` per drifted relationship,
  `setWorldTime(worldId, tickToWorldTime(N))`. No timeline events in P2 (beats=P3).
- Return `{ ticks: N, finalPositions, drifted }`.

**Offline proof** `scripts/sim-ship.mjs`: seed a scout (stub crew) → run
SimulateWorldForward for 24 ticks → print final positions + world time + drifted
relationships; assert every NPC's final room matches its routine for the final tick's
band and the clock advanced. (Extends the P1 seed-script pattern; stub crew, no spend.)

## P3 implementation spec (threshold-gated LLM beats — binding)
Adds the one LLM seam to the sim: when co-located NPCs have tension/bond and the
cooldown elapsed, spend ONE structured beat that records a timeline event and nudges
relationships. Deterministic co-location drift (P2) remains the default; a beat
SUPERSEDES it for that group/tick. Beats are **Haiku** (`HAIKU_MODEL`) per the
drama-port design + cost discipline — flagged for a possible Grok swap at P4.

**Adapters:**
- `HaikuDramaPort` (`infrastructure/world-gen/`) implementing `DramaPort.generateBeat`
  — `generateObject` with `HAIKU_MODEL` via `@ai-sdk/anthropic`, Zod-validated
  `DramaBeat` (title, summary, participant_ids, valenceDeltas), system prompt from
  `prompts/drama-beat.md`. Plus a deterministic `StubDramaPort` (tests + offline script).
- `TimelineWriter` SQLite + Mongo adapters (P0 left the port only) — INSERT a
  `timeline_events` row (turn_id null, sim_tick set, provenance='sim').

**SimulateWorldForward changes** — add deps `{ places: PlaceRepository, drama: DramaPort,
  timeline: TimelineWriter }` and config `{ cooldownTicks=3, tensionThreshold=0.3 }`:
- Load places.forWorld → `placeNameById`. Enrich the NPC roster with name + role
  (read WHERE P1's `characters.add` stored role — check the adapter) + goal (`active_goal`).
- Per tick, per co-located group: gather the relationships whose both endpoints are in
  the group; `shouldEmitBeat({ characterIds, relationships, currentTick: tick,
  lastBeatTick: lastBeatTickByPlace[place], cooldownTicks, tensionThreshold })`.
  - Gated TRUE → `drama.generateBeat(DramaBeatInput{ ... participants, relationships,
    threads: [] })` → `timeline.append({ provenance:'sim', sim_tick:tick, world_time:
    tickToWorldTime(tick), place_id, title, summary, importance })`; apply each
    `valenceDelta` to the matching working relationship edge via `applyDrift`; set
    `lastBeatTickByPlace[place]=tick`. (Skip deterministic drift for this group this tick.)
  - Gated FALSE → the P2 deterministic co-location drift for the group's edges.
- Persist end-state exactly as P2 (positions, net valence deltas, clock). Timeline beats
  are written as they occur (the only per-tick persistence; still compact — ambient moves
  are never logged).

**Wiring + proof:** container wires `drama` (HaikuDramaPort) + `timeline` (TimelineWriter).
`scripts/sim-ship.mjs` runs with `StubDramaPort` (no spend), prints the `provenance='sim'`
timeline beats written, and asserts ≥1 beat fired given the seeded tension. Live Haiku beat
smoke is manual (with the Grok crew smoke at P4).

## P3.1 — beat memory (anti-repetition; from the live smoke)
The live smoke (real Grok crew + Haiku beats) was strong — Grok scheduled a communal
rhythm (Mess at midday, Quarters at night) so beats fired — BUT 6/8 beats were the same
"medic presses captain for rest rotations" conflict, because `DramaPort` never saw prior
beats. Fix: give the generator GLOBAL memory (the repeated conflict spanned different
rooms, so per-room memory wouldn't catch it).
- `DramaBeatInput` gains `recentBeats: string[]` (the last N beats ship-wide as
  "title: summary").
- `SimulateWorldForward` keeps a rolling `recentBeats` list; each `generateBeat` call gets
  `recentBeats.slice(-5)` (the beats BEFORE this one), then pushes the new beat.
- `prompts/drama-beat.md` instructs: these already happened — do NOT restate; advance,
  escalate, resolve, or shift to a different dynamic among the participants.
- `StubDramaPort` accepts the field (no behavior change). Keep beats on Haiku (locked).
Verify offline (plumbing) with sim-ship; confirm actual variation with a live smoke re-run.

## P4a implementation spec (creatable + playable Starship — binding)
Make a bounded starship world reachable from the UI and land the player in it.
First-cut join-design defaults (flagged for browser review, easy to change):
- **Player** boards as a newcomer (identity "A newcomer just come aboard — name not
  yet established." or the entered name), placed in the **Bridge** (entry room).
- **Synchronous** creation for the first cut: seed (real Grok crew) → run the sim
  (SIM_TICKS≈12, real Haiku beats) → add player + scene + cursor → opening turn →
  redirect to /play. The "warming-up" background-task UX is the NEXT iteration.

**Write surface** (ports + SQLite + Mongo adapters, mirror P1 delegation):
- `SceneRepository.add({ world_id, place_id, title, scene_number, status }):
  Promise<{ id: number }>` (status 'active').
- `WorldRepository.setCursor(worldId: number, sceneId: number): Promise<void>` (sets
  current_scene_id; world_time is already set by the sim, clock-follows-positions).

**Orchestration** `application/use-cases/create-starship-world.ts`:
- Deps: the seed deps + sim deps (drama+timeline+places) + characters (add player) +
  scenes (add) + worlds (setCursor). Flow: seedBoundedWorld(crew=Grok) →
  simulateWorldForward(ticks=SIM_TICKS) → characters.add player (is_player=1, Bridge) →
  scenes.add (Bridge, active, scene_number 1) → worlds.setCursor(sceneId). Return
  { worldId, sceneId }. Pure orchestration (no SQL/SDK/lib).

**Driving adapter** `app/worlds/new/actions.ts` → `createStarshipWorldAction`:
- Build CreateStarshipWorld from the container (real Grok crew + Haiku drama), run it,
  then `generateOpeningTurn(worldId, premise)` (lib — adapters may use lib), redirect to
  /play. Catch + surface a friendly error on failure (Grok/Haiku flake already retried).

**UI** `app/worlds/new/QuickStartForm` (or a sibling): a DISTINCT section, visually set
apart from the amber genre grid — a **sky/cyan** accented "Living world" card ("A crewed
scout ship, already in motion before you board") with its own Launch button + pending
state ("Launching your ship…"), separate from the genre "Generate world" flow. Shares the
player-name field. Own server action (createStarshipWorldAction), own error surface.

## P5 (during play): the ship stays alive — a per-turn "living tick" (binding)
The forward sim ran only PRE-boarding; during play the turn pipeline skips off-scene
looped NPCs (`shouldSkipRoutineTick`) — an open-world cost optimization that is wrong for
a sealed 6-room ship. Decision (user, 2026-06-09): in a bounded world, ALL crew are active
every turn. Build a per-player-turn "living tick" reusing the pre-play sim machinery:
- New use case `application/use-cases/tick-living-world.ts` (pure orchestration over ports +
  the existing pure services + DramaPort + TimelineWriter). Input: { worldId, playerPlaceId }.
  - band = `worldTimeBand(world.world_time)` (the LIVE clock, not a separate sim clock).
  - For every OFF-scene NPC (current_place_id !== playerPlaceId): `nextPlaceId(dailyLoop[band],
    band, current, neighborsOf)` → `characters.setPlace`. Crew in the player's room are left
    to the narrator/archivist (no double-move). NO skip — all off-scene crew move.
  - `coLocatedGroups` over off-scene NPCs → `shouldEmitBeat` (per-room lastBeatTick + cooldown)
    → `drama.generateBeat` → `timeline.append({ provenance:'sim', sim_tick:<next> })` +
    `relationship-drift`. Sim_tick continues past the pre-play max.
- Integrate in `narrate-turn.ts` post-stream, bounded worlds only, FAIL-OPEN (like the other
  post-stream tasks). Surface the last ~2 off-screen sim beats into the narrator context so the
  player hears about them (needs a small timeline-read port method).
- Cost: ~4 NPCs, deterministic movement free, beats gated/rare. Works on both stores (ports).

## RESOLVED: clock follows positions
The earlier clock/position mismatch (sim persisted the arrival band while positions were
the last-lived band) is fixed: `SimulateWorldForward` now sets `world_time =
tickToWorldTime(ticks − 1)` (the last lived tick's band), so a joining player reads the
same moment the NPCs are positioned for. Decided by the user 2026-06-09.

## Risks / things to validate
- **daily_loop place references** must point at real seeded rooms, not free text —
  enforce at seed time.
- **Movement granularity**: teleport-to-routine-target is fine for 6 rooms;
  revisit hop-by-hop only if travel-time matters.
- **Mongo parity doubles persistence work** — every new table needs a Mongoose
  model + `.mongo` repo or the `PERSISTENCE=mongo` suite breaks.
- **Onion/CI**: no `lib/` imports from new code; `dependency-cruiser` enforces.
- **Timeline write port**: confirm whether the archivist already writes
  `timeline_events` through a seam we can reuse before adding a new port.
```

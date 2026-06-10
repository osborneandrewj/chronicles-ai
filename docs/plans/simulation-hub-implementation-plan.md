# Implementation Plan: Genre-Agnostic Simulation-Hub Redesign

Status: **draft for review** · 2026-06-09 · branch `onion-arch-refactor`
Design doc (the *why* and *what*): [`simulation-hub-redesign-plan.md`](./simulation-hub-redesign-plan.md)

Step-by-step build order for the four phases. Per the locked decision, **A→D land behind a
feature flag and are playtested once the arc coheres** — the phases are the build order
inside the flag, not separate releases. Phase A's craft/memory fixes are the exception:
they cannot leak the reveal and only improve quality, so they land **unflagged** (every
world benefits immediately); the flag gates the new player-facing path (concealed onboarding
→ simulation → hub) introduced in B/C/D.

## Conventions (apply to every step)

- **Layering (binding, CI-enforced):** `domain/` imports nothing outward; `application/`
  imports only `domain/`; adapters import inward; wiring only in `composition/container.ts`.
  No `Math.random()`/`Date.now()`/`fetch`/SDK/SQL in `domain/` or `application/` — inject a
  seed/port. Run `npm run depcruise` after any import change.
- **Dual persistence (definition of done):** every schema change is **both** a SQLite
  migration in `lib/migrations.ts` (next `version` = 30, increment per change) **and** a
  matching Mongo model/index edit in `infrastructure/persistence/mongo/models/index.ts`,
  with both adapter sets satisfying the same port. `npm test` (SQLite) **and**
  `npm run test:mongo` must pass.
- **New ports** get a type in `domain/ports/`, an entry in the `Container` type, and
  construction in **both** `buildSqlite()` and `initContainer()` (container.ts:127-207).
- **Prompts** are runtime-loaded `prompts/*.md` — edit the file, no redeploy of code needed.
- **Tests first** for every pure domain service (TDD): the service is pure, so a unit test
  is cheap and the contract is the spec.
- **Commits:** one logical step per commit; never push without the owner's go-ahead; branch
  off `onion-arch-refactor` is fine.

## The feature-flag seam (Step 0, do first)

```
env:
  SIM_HUB=1                     server-only. Gates the concealed onboarding + hub path.
```

- **NEW** `src/infrastructure/config/feature-flags.ts` (NOT `lib/` — CLAUDE.md forbids new
  `lib/` modules): `export const isSimHubEnabled = () => process.env.SIM_HUB === '1'`.
  Server-only; read only by inbound adapters.
- The legacy open-world path and the current bounded "Starship" path **keep working** when
  the flag is off. When on, the new genre-picker/hub onboarding replaces the
  `StarshipLaunch` entry point. No domain/application code reads the flag — only the inbound
  adapters (the creation action + the world-list/inspector query assembly) branch on it.

---

# Phase A — Narrator craft & memory (unflagged; benefits every world)

**Bar:** a fresh playthrough shows no shoulder/photo tic storm, the narrator honours held
objects across ≥20 turns, an off-screen NPC subplot reaches the page, three new worlds yield
three distinct name sets, and no fictional place is geocoded.

### Schema (SQLite v30; mirror in Mongo)

```sql
-- v30: tracked-object ledger gains possession + salience
ALTER TABLE story_resources ADD COLUMN held_by_character_id INTEGER;   -- NULL = world-level
ALTER TABLE story_resources ADD COLUMN location_place_id   INTEGER;    -- NULL = on a person
ALTER TABLE story_resources ADD COLUMN salient             INTEGER NOT NULL DEFAULT 0;
```

### Steps

- [x] **A1 — Reverie flare cooldown + decay.**
  `domain/services/reverie-flare.ts`: `computeReverieFlares` accepts `currentTurnId` and each
  candidate's `last_flared_turn_id`; exclude (or heavily penalize) any reverie flared within
  the last `K` turns (K≈4); apply intensity decay on flare. `narrate-turn.ts:163-180`: pass
  the turn id and the existing `last_flared_turn_id`; decay on `stampFlared`.
  *Test:* a reverie that matched 3 turns ago is suppressed; rotation occurs. *Accept:* the
  same snapshot text cannot flare two turns running.

- [x] **A2 — `memorable_facts` dedup + cap.**
  `domain/services/memorable-fact-provenance.ts`: before appending, strip `[t:N]` and compare
  normalized (case/space-insensitive, token-overlap) against existing lines; skip near-dupes.
  Cap stored lines (keep most-recent N + cornerstone). *Test:* verbatim repeat does not grow
  the block; cap enforced. *Accept:* no duplicate fact lines in a fresh world.

- [x] **A3 — Narrator anti-repetition prompt + de-template.**
  `prompts/narrator-system.md`: add "Description Variance & Established Detail" (establish a
  tic/object once, then let it recede); drop the implicit obligation to give every present
  NPC a posture line and to end on an ambient closer; vary turn shape by stakes.
  `server/render/state-block.ts`: stop surfacing a stale "salient object" as a forced closer.
  *Accept:* manual read of 10 turns shows varied turn endings, no per-turn roster sweep.

- [x] **A4 — First-class tracked-object ledger.** (schema above)
  `domain/entities/story.ts`: `StoryResource` gains `held_by_character_id`, `location_place_id`,
  `salient`. `domain/services/patch-sanitizer.ts` + a new pure
  `domain/services/object-acquisition.ts`: deterministic extractor (verb `take|pick up|grab|
  pocket|given|hand(ed)` + noun, mirroring `extractDestination`) → promote to a resource with
  `held_by = protagonist`. `application/use-cases/apply-archivist-patch.ts`: apply it and make
  freshest-field-wins cover object ownership (taking an item flips `held_by` + retires the
  prior holder's "possesses X" fact). `server/render/state-block.ts`: always render a pinned
  **CARRIED / TRACKED OBJECTS** subsection in the player block (`name — status` lines, not
  prose, not capped with world resources). `prompts/archivist-system.md`: add an
  "Item-State Continuity Check" rule. SQLite migration v30 + Mongo model.
  *Test:* take-item flips ownership; the block renders held items. *Accept:* the stolen-photo
  contradiction cannot recur (item taken from NPC never re-appears on the NPC).

- [x] **A5 — More narration in context.**
  `narrate-turn.ts:54-55,204-206,483-499`: replace the fixed `FULL_HISTORY_TURNS=6` /
  320-char split with a token-budget packer — fill full **assistant** turns newest-first up
  to a measured input budget (~4–5K of the 8K), then compact overflow; prioritize narrator
  turns over player turns when trimming. First-cut acceptable: raise to 10 full / 700-char
  compaction and measure. *Accept:* ≥8 full narrator turns reach the model on a normal turn.

- [x] **A6 — Geocoding gate for fictional interiors.**
  `narrate-turn.ts:112-115`: wrap `resolveUnresolvedPlaces` in
  `if (world.spatial_mode !== 'bounded')`. `application/use-cases/seed-bounded-world.ts`:
  seed places `geo_status='unavailable'`. `state-block.ts:182-189`: skip the
  "KNOWN PLACES (real-world geography)" block for bounded worlds. *Accept:* a new bounded
  world has zero geocoded rooms; no Nominatim call fires.

- [x] **A7 — Surface living-tick arcs on-screen.**
  NEW `domain/services/cluster-sim-arcs.ts` (pure): group `provenance='sim'` timeline events
  by participant/thread, detect a threshold-crossing arc. `domain/ports/timeline-reader.ts` +
  adapters: an arc-aware read (not `LIMIT 2`). `narrate-turn.ts:182,193-202`: promote a
  detected arc into the **authoritative** state block (attach a `StoryThread`, bump
  importance) instead of the 2-beat advisory; widen the window. *Test:* a 5-beat sim arc is
  clustered and promoted. *Accept:* an off-screen subplot is referenced in narration.

- [x] **A8 — Proactive NPCs.**
  `prompts/npc-agent-system.md`: add "Proactive NPC Behavior" (act on `active_goal`s
  independent of player input; talk to each other; initiate). Allow `tick-living-world` to
  inject an NPC intent on high-stakes turns. *Accept:* in a tense scene an NPC takes an
  unprompted action within a few turns.

- [x] **A9 — Single-player invariant + dedup of player rows.**
  `application/use-cases/apply-archivist-patch.ts` (`resolveCharacter`): route protagonist
  self-naming through `reveals_name_of`/alias-merge against the existing `is_player=1` row
  rather than inserting. `domain/services/character-dedup.ts:29`: flag multiple `is_player`
  rows. `lib/worlds.ts:135-140`: replace the `'Player'` default with a rename-wired `'You'`.
  *Test:* self-naming renames in place; second player row flagged. *Accept:* no stray
  non-player "Player" entity after self-naming.

- [x] **A10 — NPC name diversity.**
  NEW `domain/services/name-pool.ts` (pure) + a data table of names with culture/era tags;
  `sample(tags, n, { exclude, seed })` returns a shuffled candidate set (seed injected).
  `infrastructure/world-gen/grok-crew-generator.ts` + the open-world `world-generator`: inject
  a sampled candidate list + a **recently-used-surname avoid-list** into the prompt.
  `prompts/crew-dressing.md`: add "draw on provided names / same era; do not reuse listed
  names; avoid defaults". Expand `stub-crew-generator.ts` to draw from the pool.
  (Era-keying to genre presets rides in Phase B.) *Test:* avoid-list excluded; seeded sample
  deterministic. *Accept:* three new worlds → three distinct name sets, no recurring "Voss".

---

# Phase B — De-Starshipping + concealed onboarding (flag gates the new entry point)

**Bar:** the player picks a historical genre, gets an ambiguous codename ("Protocol 457"),
plays a turn, and nowhere in creation/join is the premise, "ship", or any simulation
vocabulary visible; grep finds no starship/scout/crew/deck in domain/application paths.

### Steps

- [ ] **B0 — Feature flag** (Step 0 above) if not already in.

- [ ] **B1 — Port/type renames** (mechanical; one commit per port; depcruise green each time).
  `domain/ports/crew-generator.ts → ensemble-generator.ts` (`CrewGenerator→EnsembleGenerator`,
  `GeneratedCrew→GeneratedEnsemble`, `GeneratedCrewMember→GeneratedCompanion`); container field
  `crewGenerator→ensembleGenerator` (container.ts:31,97,153,202); adapter classes
  (`GrokCrewGenerator→GrokEnsembleGenerator`, stub likewise). `domain/ports/deck-plan-provider.ts
  → world-archetype-provider.ts` (`DeckPlanProvider→WorldArchetypeProvider`,
  `DeckPlanTemplate→WorldArchetype`, `DeckPlanRoom→LocationNode`, `DeckPlanEdge→LocationConnection`,
  `DeckPlanCrewSlot→EnsembleSlot`); container field `decks→archetypes`. `domain/services/
  ship-clock.ts → world-clock` fn names (`minutesToShipTime→minutesToWorldTime`,
  `shipTimeToMinutes→worldTimeToMinutes`) — update `narrate-turn.ts:17,276-283` and
  `create-*-world.ts`. *Accept:* `npm run type-check`, `npm test`, `npm run test:mongo`,
  `npm run depcruise` all green; no behaviour change.

- [ ] **B2 — Data-driven archetype registry (multiple hubs).**
  NEW `infrastructure/world-gen/archetypes/` — one file per archetype (`scout-vessel.ts`
  [genericized from `scout-template.ts`], `research-facility.ts`, `monastery.ts`,
  `bunker.ts`, …) + `index.ts` exporting a `Map<string, WorldArchetype>`. `WorldArchetype`
  gains `isHub`, `simulationRoomKey`, `entryLocationKey`, `initialSceneTitle`,
  `defaultCharacterLabel`, `playerIntroTemplate`. `AuthoredWorldArchetypeProvider` reads the
  registry; NEW pure `domain/services/pick-hub-archetype.ts` selects a random `isHub`
  archetype (seed injected). DELETE the hardcoded single-template default.
  *Test:* registry resolves by id; `pickHubArchetype` deterministic under a seed.

- [ ] **B3 — Genre-preset registry (≥20 historical).**
  NEW `infrastructure/world-gen/genre-presets/` — `GenrePreset { id, label, hiddenPremise,
  eraTags, toneTags }`, the 24 settings from the design doc. The picker lists `label` only;
  `hiddenPremise` seeds the adventure and is **never** returned to a client.

- [ ] **B4 — Codename generator.**
  NEW pure `domain/services/codename.ts`: `generateCodename(seed)` → "Protocol 457",
  "Sequence Theta-9", … that does **not** encode the genre. *Test:* deterministic under seed;
  no genre token in output.

- [ ] **B5 — `CreateBoundedWorld` use case.**
  `application/use-cases/create-starship-world.ts → create-bounded-world.ts`: all
  player-visible strings ("Arrival", "Newcomer", "Bridge") come from the archetype; the
  **player-facing world name = codename**; the rich internal name/premise is stored for the
  narrator but not surfaced. Entry room = `archetype.entryLocationKey` (fallback `placeIds[0]`).

- [ ] **B6 — Concealed creation UI + action.**
  Replace `app/worlds/new/StarshipLaunch.tsx` with a **genre picker** that lists genre
  **labels only** — no premise, no "ship", no "bounded/sub-world" words, no blurb; on submit
  show the codename. `app/worlds/new/actions.ts:36-43`: `createStarshipWorldAction →
  createAdventureAction(genreId)` — looks up the preset, generates a codename, and (when
  `SIM_HUB` on) silently seeds the hub + session + drops into the simulation (wired in C10).
  *Accept:* DOM/markup of the creation flow contains none of: premise text, "ship", "hub",
  "simulation", "sub-world".

- [ ] **B7 — Generic prompts.**
  `prompts/crew-dressing.md → ensemble-dressing.md`, `prompts/drama-beat.md → ensemble-beat.md`:
  strip ship/crew/deck/watch/mess/vessel; inject genre/era. Update the loader paths in the
  Grok/Haiku adapters.

- [ ] **B8 — Era-keyed `NamePool`.** Extend A10's pool with the `eraTags` from the chosen
  `GenrePreset` so Rome→Roman names, Napoleon→French, etc.

- [ ] **B9 — Rename scripts.** `scripts/*-ship.mjs → *-bounded-world.mjs`; parameterize by
  `--template`. (Dev-only; low risk.)

---

# Phase C — Simulation-hub architecture + concealment + meta-story (flagged)

**Bar:** the player starts in a historical simulation, dies/awakens back into the hub's sim
room with identity intact, a hub meta-thread visibly bleeds into a simulation beat, and a
tester inspecting the world before awakening sees no hub, no `parent_world_id`, no simulation
room, and no hidden premise.

### Schema (SQLite v31; mirror in Mongo)

```sql
-- v31: world layering + the session pointer
ALTER TABLE worlds ADD COLUMN world_layer    TEXT NOT NULL DEFAULT 'standalone'; -- hub|subworld|standalone
ALTER TABLE worlds ADD COLUMN parent_world_id INTEGER;                            -- subworld → hub
ALTER TABLE worlds ADD COLUMN meta_story_json TEXT;                               -- hub-only MetaStoryBible

CREATE TABLE simulation_session (
  id                 INTEGER PRIMARY KEY,
  hub_world_id       INTEGER NOT NULL,
  subworld_world_id  INTEGER,                       -- NULL while in hub
  player_identity    TEXT NOT NULL,                 -- carries across sims
  status             TEXT NOT NULL DEFAULT 'in_subworld', -- in_hub|in_subworld
  has_awoken         INTEGER NOT NULL DEFAULT 0,    -- concealment gate
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
```

### Steps

- [ ] **C1 — World layering + bible column.** Migration v31 (SQLite) + Mongo model fields
  (`worldLayer`, `parentWorldId`, `metaStory`). `domain/entities/world.ts` +
  `domain/ports/world-repository.ts` + both adapters: expose the new fields. Per-`world_id`
  aggregates unchanged.

- [ ] **C2 — `SimulationSession` entity + repository.** NEW `domain/entities/session.ts`,
  `domain/ports/session-repository.ts`, SQLite + Mongo adapters, container wiring (both
  builders). CRUD + `getActiveForPlayer`, `flip(status)`, `setAwoken`.

- [ ] **C3 — `EnterSubworld` use case.** Seed/link a loose `open` simulation
  (`parent_world_id = hub`, the picked `GenrePreset.hiddenPremise`), drop the player in, set
  session `in_subworld`. The hub itself is seeded by `CreateBoundedWorld` with
  `pickHubArchetype()` (friendly-ensemble default) **silently** — never the first scene.

- [ ] **C4 — Session-driven route resolution.** The chat route resolves the **active**
  `world_id` from the session (sub-world while playing, hub after awakening); `advanceTurn`
  stays world-id-driven and untouched.

- [ ] **C5 — `detectSubworldExit` + post-stream wiring.** NEW pure
  `domain/services/detect-subworld-exit.ts` (death/awakening signals → `Exit | null`). Wire
  into `narrate-turn` post-stream alongside the other enrichers (fail-open).

- [ ] **C6 — `ReturnToHub` use case.** Reuse the drop-in recipe to place the player in the
  hub's `simulationRoomKey` room, open a scene, `setCursor`, flip session `in_hub`, set
  `has_awoken=true`. This is the reveal.

- [ ] **C7 — `concealmentView` gate (server-side).** NEW pure
  `domain/services/concealment-view.ts`: given session + world, decide visible scope. Apply in
  `application/use-cases/inspect-world.ts` and the **query port** so the inspector payload,
  world list, world title, and any route JSON are scoped to the sub-world until `has_awoken`.
  Hidden premise + `world_layer`/`parent_world_id`/session fields are filtered **out of the
  payload**, not hidden in CSS. *Test (the leak-surface checklist):* before awakening, the
  inspect/list/route responses contain no hub world, no parent id, no sim room, no premise;
  after `has_awoken`, the hub is inspectable.

- [ ] **C8 — Meta-Story Bible generation.** NEW `domain/entities/meta-story.ts`
  (`MetaStoryBible` shape: Question, Institution, HiddenTruth, Antagonist/Allies, escalation
  ladder, bleed motifs, endgame fork) + a data library `world-gen/arc-engines/` (Erased
  Operative / Memory Hunt / Drift / Black Program / Breach — structures, not IP). NEW
  `domain/ports/meta-story-generator.ts` + a Grok adapter; generation is a **multi-pass
  judge-panel `Workflow`** (architect → score/punch-up → coherence check) run once at hub
  creation. Store on the hub (`meta_story_json`), pin into narrator/archivist context, never
  rendered to player/inspector. *Accept:* a generated bible has a coherent ladder + ≥1 bleed
  motif + an endgame fork.

- [ ] **C9 — One-way bleed.** NEW pure `domain/services/select-bleed-threads.ts`: pick hub
  threads tagged `bleed` (keyed on relevance tags) for injection into the simulation's
  narrator state + the empty drama-beat `threads:[]` slot
  (`simulate-world-forward.ts:211`, `tick-living-world.ts:242`). Never write back to the hub.

- [ ] **C10 — Onboarding wiring (flag-gated).** `createAdventureAction` (B6): when `SIM_HUB`
  on → `CreateBoundedWorld(pickHubArchetype())` for the hub (+ bible C8) → create session →
  `EnterSubworld(genrePreset)` → player starts in the simulation. Friendly hub crew + player
  = newest member (revealed only post-awakening).

---

# Phase D — Reality-bending power growth + meta-story payoff (flagged)

**Bar:** across a session the player escalates from noticing an impossibility to acting on it
(tracked in state, gated to simulation-framing premises), a bleed motif recurs across two
different-era simulations, and the meta-story builds toward its reveal and choice.

### Schema (SQLite v32; mirror in Mongo)

```sql
ALTER TABLE simulation_session ADD COLUMN lucidity INTEGER NOT NULL DEFAULT 0; -- rule-violation track
```

### Steps

- [ ] **D1 — Lucidity track.** Migration v32 + Mongo. Surface `lucidity` to the narrator state
  block; a deterministic service bumps it on discovery/rule-violation beats.
- [ ] **D2 — Reality-fractures prompt.** `prompts/narrator-system.md`: optional "Escalating
  Player Power & Reality Fractures" section, gated on a simulation-framing premise (so plain
  genres are unaffected): early consistency → mid cracks → late affordances.
- [ ] **D3 — Escalation pacing.** Pace cracks→affordances by the bible's escalation ladder
  and the lucidity value; affordances (slow time / bend physics / rewrite a script) are
  earned by discovery, not arbitrary leveling.
- [ ] **D4 — Bleed recurrence + endgame fork.** Ensure a bleed motif recurs across simulations;
  make the endgame fork (master / free / expose / escape) reachable and stateful.

---

## Test strategy

- **Pure domain services** (reverie cooldown, memorable-fact dedup, object-acquisition,
  cluster-sim-arcs, name-pool, codename, pick-hub-archetype, detect-subworld-exit,
  concealment-view, select-bleed-threads): unit tests, deterministic via injected seed —
  these are the spec.
- **Use cases** (CreateBoundedWorld, EnterSubworld, ReturnToHub, InspectWorld+concealment):
  test with in-memory/stub ports; assert the session flips and the concealment scope.
- **Repositories:** the existing bounded-world repo suites get the new columns; run under
  **both** SQLite (`npm test`) and Mongo (`npm run test:mongo`).
- **Leak-surface test (critical):** an integration test that creates a concealed adventure
  and asserts every read surface (inspect use case, world list, route JSON) omits the hub,
  parent id, sim room, and premise until `has_awoken`.
- **Meta-story workflow:** smoke test the generator against the stub adapter (no live LLM in
  CI); the judge-panel quality pass is exercised manually.

## Exit criteria (when the flag flips on)

1. `npm run lint`, `npm run type-check`, `npm run depcruise` pass.
2. `npm test` **and** `npm run test:mongo` pass (incl. new domain/use-case/leak-surface tests).
3. Both SQLite migrations (v30–v32) apply cleanly on a fresh boot **and** an existing DB; the
   matching Mongo models are updated.
4. `npm run dev`, `SIM_HUB=1`: pick "Rome" → get a codename like "Protocol 457" → play a
   simulation → inspector shows **only** the simulation (no hub/premise) → trigger
   death/awakening → surface in the hub's sim room with identity intact → inspector now shows
   the hub → a hub meta-thread is observable bleeding into a later simulation.
5. `SIM_HUB=0`: the current open-world and bounded paths are unchanged.
6. Three fresh adventures → three distinct NPC name sets (no recurring "Voss"); a 20-turn
   simulation shows no shoulder/photo tic storm and honours carried items.
7. `package.json` version bumped on the release branch (workspace + root + lockfile together),
   dev server restarted, header verified.

## Explicit cuts (deferred)

- Map rendering of hub/simulation topology — still out of scope.
- Multiple selectable hubs — one canonical hub per playthrough (locked decision).
- Lightly-bounded simulations — simulations stay loose/`open` (locked decision).
- SQLite deletion / Mongo-only — separate manual gate (P7), untouched here.

## Suggested build order / dependencies

A (any order, ship-safe) → B0 flag → B1 renames → B2/B3/B4 registries+generators → B5/B6/B7
onboarding+prompts → C1/C2 schema+session → C3/C4 enter+route → C5/C6 exit+return → C7
concealment → C8/C9 bible+bleed → C10 wiring → D1–D4. A7+A8 (surfaced subplots + proactive
NPCs) and A4 (item ledger) are the highest-value craft items — do them early.

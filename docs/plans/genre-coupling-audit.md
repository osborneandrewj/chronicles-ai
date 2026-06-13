# Genre-Coupling Audit — Findings & Remediation Plan

**Status:** proposed (not started)
**Branch target:** `onion-arch-refactor` (or a feature branch off it)
**Problem:** The engine is meant to run *any* genre/setting, but code, prompts, schemas, and UI silently assume one setting (most often a sci-fi starship / "simulation hub"). This audit finds where that coupling breaks in contrasting settings (Sumerian village, medieval castle, Victorian manor, 1920s noir) and lays out a phased fix.
**Method:** Nine parallel finder agents swept each layer (prompts, domain services, entities/contracts, world-gen/archetypes, use cases/pipeline, UI, DB schema/migrations); every `breaks`-severity finding was adversarially re-verified against the actual code before inclusion. Raw findings: 98 → 27 confirmed breaks, 67 degrade/cosmetic, 4 rejected. False positives reviewed at the bottom.

---

## Executive summary

The engine is **substantially genre-coupled at the meta-frame layer, but cleanly abstracted at the storytelling layer.** Two truths sit side by side: (1) the narrator/archivist/ensemble-dressing prompts are genuinely genre-neutral and explicitly instructed to "never default to science-fiction tropes," and a Sumerian village or medieval castle plays correctly *when created as a standalone/open world*; (2) the moment a player uses the canonical "Begin an adventure" path (a genre preset like "Medieval England"), the engine silently wraps the story in a sci-fi simulation meta-frame — a concealed "hub," an "awakening," a "lucidity" reality-bending track, and "bleed motifs" — that is metaphysically incoherent in any pre-modern or grounded setting. So the engine *can* run a Sumerian village today via standalone creation, but it *cannot* run one through the genre-adventure flow without eventually telling the player they are inside a simulation run by a hidden institution. Beneath the meta-frame, a second tier of coupling exists in hardcoded English/modern/sci-fi vocabulary regexes (lucidity discovery, awakening detection, investigative/media/time/danger move classification, transient-NPC filtering, occupancy templates) that silently no-op for period-appropriate language, degrading narrator guidance and breaking core mechanics in non-modern genres. The archetype set is skewed toward containment models (vessel/facility/bunker, plus one monastery), with no fantasy/village/court coverage.

## The meta-frame question

The "simulation hub / subworld / awakening / lucidity / reverie" framing is **not a neutral engine abstraction — it is a specific sci-fi/techno-thriller genre (Westworld/Animus/Matrix) imposed as the mandatory spine of every adventure-mode story.** The audit is decisive on this: `prompts/meta-story.md` explicitly instructs the architect to "Build a Ludlum/Clancy/Crichton-grade conspiracy around a concealed home base that secretly runs immersive historical simulations." Acts are titled "First Awakening," "The Program," "Bending Reality." This is ontological, not cosmetic — every adventure-mode world is asserted to be a hollow simulation a player will wake out of.

Crucially, the framing is **two separable things**, and they should be treated differently:

- **The architecture (hub world ↔ subworld linkage, `world_layer`, sessions, the ability to move a player between linked worlds, off-screen ensemble simulation).** This is a *legitimate, reusable engine capability* — castles have rooms, dynasties span linked worlds, NPCs live off-screen. Keep it, but **rename and decouple it from the narrative reveal.** A "subworld" should be a *peer linked world*, not implicitly "a fake reality."
- **The narrative reveal (the player discovers they're in a simulation, climbs a lucidity ladder, bends reality, sees bleed motifs).** This is *one genre's story shape* and must become **opt-in, not default.**

**Recommendation: keep the architecture (renamed to neutral terms), re-architect the narrative reveal into an optional, genre-conditional `metaFrameKind` parameter.** Pure internal renames (e.g., `ship_clock_minutes`, `deck`, `crew`, `simulationRoomKey`) are the low-priority tail. The load-bearing work is: (a) make the simulation meta-story opt-in rather than auto-generated for every genre preset, and (b) gate the lucidity/reality/bleed machinery on that opt-in flag. Do **not** keep "awakening/lucidity/simulation" as the only multi-layer mode — that's the core defect.

## Confirmed breakages (must fix)

These are the audit's verified `breaks` (after re-verification; items the verifier downgraded to `degrades` are moved to the next section).

### Theme A — Meta-frame imposed on every adventure (the deepest coupling)

| File:location | Assumption | Breakage example | Fix |
|---|---|---|---|
| `prompts/meta-story.md` (lines 1–25) | Every adventure is a concealed institution running "immersive historical simulations"; player is a memory-wiped newcomer | A 1536 Tudor world: by act 3 the player is told the Tudor court is a simulation run by the "Cradle Program" — anachronistic, no in-fiction explanation | Make meta-story generation **opt-in** via a `metaFrameKind` param (`simulation` \| `grounded` \| `supernatural` \| `noir`). For non-simulation kinds, return a different bible structure (central mystery / stake) or skip it. Gate generation on explicit selection, not on picking a genre. |
| `src/domain/services/concealment-view.ts` (lines 26–36) + `src/infrastructure/narrator/narrate-turn.ts` (REALITY block, lines 278–300) | Every `world_layer==='subworld'` gets a `### REALITY\nstage: fixed` cue injected into **every** narrator turn; narrator interprets this as "a simulation-framing world… sensing the edges" | A Sumerian village created via adventure mode receives the REALITY block at turn 1 — narrator treats the village as a cracking illusion | Gate the REALITY block on a world feature flag (`world.has_reality_bending` / `metaFrameKind==='simulation'`), not on `world_layer`. Non-simulation subworlds omit it entirely. |
| `src/lib/migrations.ts` (v32 `simulation_session`: `has_awoken`, `lucidity`) | Multi-layer link is always a sim-awakening with a 0–5 reality-questioning track | A Victorian-manor→1920s-city branching story can't express the transition without forcing the "woke up in a simulation" flow | **DB migration:** generalize to a `world_session` with `world_link_kind`; move `lucidity`/`has_awoken` into an optional feature table referenced only by simulation-kind links. |
| `src/domain/entities/session.ts` (lines 8–21, `SimulationStatus`) | Session state is `in_hub`/`in_subworld` + `has_awoken` + `lucidity` as core entity | A medieval-castle hub with era subworlds shows `stage=cracks` in narrator context and an "Awakening" return scene | Reframe session status around `current_world_id` + `world_link_kind`; make lucidity/awakening optional per link kind. |

### Theme B — Hardcoded sci-fi/modern vocab regexes that silently no-op (break core mechanics)

| File:location | Assumption | Breakage example | Fix |
|---|---|---|---|
| `src/domain/services/lucidity.ts` (`DISCOVERY_PATTERNS`, lines 12–22; `lucidityDelta` gets no world param) | Player questions reality in sci-fi words ("the simulation", "glitch", "membrane") | Victorian player: "threads in a tapestry being rewoven" → zero regex matches → lucidity stuck at 0; mechanic non-functional in every non-sci-fi genre | Pass world/genre to `lucidityDelta`; make patterns data-driven per `metaFrameKind`, or detect *intent* (any reality-questioning) rather than keywords. **Re-test required.** |
| `src/domain/services/detect-subworld-exit.ts` (`AWAKENING_PATTERNS`, lines 33–38) | Exit = waking from a tank/cradle/pod/vat/capsule/rig; "surface from the simulation" | Medieval monastery hub: "I wake in the stone chapel, the curse broken" → no match → `has_awoken` never flips, hub stays concealed forever (silent failure of the concealment gate) | Supply exit-trigger language from the meta-story bible / per-kind config (sci-fi: tank/pod; fantasy: curse/spell/veil; historical: depart/return). |
| `src/domain/services/npc-promotion.ts` (`isTransientServiceNpc`, lines 33–52) | Transient walk-ons are modern service roles (`barista\|doordash\|rideshare\|cashier…`) | Medieval monastery postulant / traveling merchant never matches → incorrectly promoted to full agent NPC, breaking the walk-on containment tier | Move pattern to genre-parameterized config (`transientRolePatterns`); pass it in rather than baking it. (Note: no genre field exists on `World` yet — adding one is a prerequisite.) |
| `src/domain/services/narrator-guidance.ts` `isInvestigativeMove()` (226–239) | Investigation = analysis verb + sci-fi noun (`vox\|auspex\|cogitator\|scanner\|database…`) | "I examine the merchant's ledger for discrepancies" → false → narrator never told to "return a concrete result, partial match, contradiction, or new lead" | Parameterize `investigationTargets` per genre, or generalize to intent-only (any analyze/read/check verb fires). |
| `src/domain/services/narrator-guidance.ts` `isMediaFeedMove()` (252–264) | Public-info surfaces are modern (`twitter\|feed\|email\|podcast\|browser…`) | 1920s noir: "I check the morning newspaper" → false → narrator never told to put concrete diegetic content on the surface | Generalize to `media surfaces = feed\|news\|broadcast\|publication\|rumor\|gossip…`; parameterize era terms per preset. |

### Theme C — Archetype gaps and sci-fi-default selection

| File:location | Assumption | Breakage example | Fix |
|---|---|---|---|
| `src/infrastructure/world-gen/archetypes/index.ts` (line 13, `ALL`) + `pick-hub-archetype.ts` | Only 4 hub archetypes (scout-vessel, research-facility, bunker, monastery), all containment topologies, selected with **no genre coupling** (25% each) | A Medieval England adventure randomly draws SCOUT_VESSEL → player awakens into "Bridge / Crew Quarters / Med Bay" — a starship is the medieval home base | (1) **Genre-filter archetype selection** so non-sci-fi worlds never draw SCOUT_VESSEL/RESEARCH_FACILITY; (2) add fantasy/historical/village/court archetypes (Theme D below). |
| `src/infrastructure/world-gen/archetypes/scout-vessel.ts` (1–104) | Hardcoded "Bridge/Mess/Sim Deck/Med Bay/Engine Room" + roles captain/pilot/engineer/medic | Any non-sci-fi adventure that draws this archetype surfaces sci-fi room names sent verbatim to narrator + UI | Either parameterize room slots to era-mapped names, or exclude from non-sci-fi pools via genre filtering. Also pass genre context into the ensemble generator (currently only archetype name is passed). |

### Theme D — UI copy and hardcoded prose that leaks the meta-frame

| File:location | Assumption | Breakage example | Fix |
|---|---|---|---|
| `src/app/worlds/[worldId]/play/page.tsx` (lines 56–59) | Death→hub awakening prose is hardcoded sci-fi: "died inside a simulation… the facility's simulation room, the resident crew close by" | Player dies in a Medieval castle adventure → reads prose about dying in a simulation and waking in a facility — fully incoherent at a critical beat | Parameterize awakening prose by hub `template_id`/archetype (the hub object is already available at line 55), or gate behind `metaFrameKind==='simulation'`. |
| `src/app/worlds/new/StarshipLaunch.tsx` (lines 25–55) + `createStarshipWorldAction` in `actions.ts` (63–68, 286–297) | When `SIM_HUB` is OFF, the only quick-start bounded-world path is a hardcoded "Starship / board / launch the scout" | A user wanting a medieval bounded world from quick-start gets only a sci-fi starship; must fall back to Advanced | Replace/parameterize with a neutral "Living World" entry that uses the archetype system; or hide behind the flag and surface multi-genre archetypes equally. |

## Degradations (should fix)

Subtler immersion-breakers — real coupling, but either opt-in-scoped, soft (LLM can recover), or quality-degrading rather than mechanic-breaking. Several were **downgraded from `breaks` to `degrades` on re-verification** because they only fire in the opt-in adventure/concealed-onboarding path, never for standalone/open worlds.

**Meta-frame, scoped to adventure mode (downgraded `breaks→degrades`):**
- `src/domain/services/arc-engines.ts` (17–53) — all 5 arc spines are techno-thriller simulation conspiracies (Erased Operative, Memory Hunt, Drift, Black Program, Breach). Motifs leak into narration as "bleed" cues at lucidity ≥2. No grounded/supernatural/noir arc engines exist. Fix: add non-simulation arc engines keyed by `metaFrameKind`; gate bleed on simulation kind.
- `prompts/meta-story.md` "genre-neutral spine" claim (line 22) — aspirational but incompatible with the prompt's own sci-fi premise; only invoked in `createAdventureAction`, never for standalone worlds. Fix: same `metaFrameKind` parameterization.
- `src/application/use-cases/return-to-hub.ts` (10–17, 62) — hardcoded "Awakening" scene title + `simulationRoomKey`; correct only for sci-fi. Fix: dynamic title from hub archetype (`initialSceneTitle` is already parameterized — mirror it); decouple "awakening" semantics to the narrator.
- `src/domain/services/select-bleed-threads.ts` — cross-world "recurring wrongness" motifs presume a simulation; force artificial unity on grounded multi-region stories. Fix: gate on simulation kind.
- `src/domain/entities/world.ts` `WorldLayer` (6–9) — only hub/subworld/standalone; can't express dual-realm / episode-linked / grounded multi-location stories without forcing simulation semantics. Fix: widen the enum or decouple session-linkage from the layer label.
- `prompts/narrator-system.md` "Escalating Player Power & Reality Fractures" (63–70) — *verified not-a-finding* for standalone worlds (gated on `world_layer==='subworld'`), but `degrades` for subworlds because the cue text itself is sci-fi-framed ("cracks," "seams," "bend reality"). Fix: when reality-bending is enabled for non-sci-fi genres, supply ontology-appropriate language (magic for fantasy, case-cracking for noir).

**Narrator-guidance vocab (quality degradation — guidance silently omitted):**
- `narrator-guidance.ts` `isTimeCheckMove()` (241–250) — modern time devices (`watch\|phone\|laptop\|terminal`); "check the church bells" / "look at the sundial" never fire the exact-time hint. Parameterize `timeDeviceTerms` per genre.
- `narrator-guidance.ts` `isDangerMove()` (273–277) — contemporary/military danger words; misses "poison," "necromancer," "skeleton." Parameterize `dangerTerms`.
- `narrator-guidance.ts` `isSpectacleMove()` (273–292) — whitelist of objects (`car\|cruiser\|reactor…`) misses "ziggurat," "stained-glass window." Broaden or check any noun after a power verb.
- `narrator-guidance.ts` `repeatedAmbientAnchors()` (381–413) — European-temperate + modern anchor list (`wheat\|snow\|fluorescents`); misses "sand/palms" (Sumerian), "candlelight/mahogany" (Victorian) repetition. Parameterize `ambientAnchors`.

**Name-resolution & identity vocab:**
- `name-resolution.ts` `PLACE_DETAIL_WORDS`/`GENERIC_ROOM_KEYS` (46–86) — modern building vocab; "great hall," "ziggurat," "keep" mis-merge or fail to merge as places. Parameterize per genre.
- `stub-crew-generator.ts` (36–41) — offline/test generator hardcodes `['sci-fi','space','generic']` name pools, diverging from the live path which uses `template.eraTags`. A monastery test seeds "Vex Kaine," not "Brother Oswin." Fix: pass `template.eraTags` (one-line alignment with `grok-crew-generator.ts` line 111).

**Occupancy & world simulation:**
- `occupancy-sim.ts` `PROFILE_DEFS`/`KIND_ALIASES` (111–135) + `trafficBlock` (112–122, 419–432) — modern place kinds only (office/hospital/cafe/transit); no temple/castle/shrine/great-hall; "traffic" emits "vehicles/gridlock/idling engines" anachronistic to a medieval road or Sumerian plaza. Fix: per-genre occupancy preset registry; era-gate traffic language.
- `research-facility.ts` (1–93) — "Atrium/Immersion Lab/Data Archive/Server Vault" + Animus/Abstergo framing is anachronistic if drawn for a historical world. Fix: genre-filter selection (Theme C) or parameterize room slot names.

**Crew terminology in prompts (soft, LLM usually recovers but biases relationship generation):**
- `prompts/ensemble-dressing.md` `crew` field/wording, `prompts/ensemble-beat.md` "pre-play simulation" frame, `grok-crew-generator.ts` "SHIP: {name}" / "Dress this ship now" (137, 148) — bias generated relationships toward workplace/crew dynamics instead of kinship/community; a Sumerian village's priestess and herdsman become "rivals" not "mother-in-law and son-in-law." Fix: rename `crew`→`ensemble`/`residents` throughout prompts and pass `template.category` instead of hardcoding "ship."

## Cosmetic / internal naming (optional — no behavior change)

These are pure renames of internal identifiers, columns, and comments. **None affect runtime behavior** (the underlying values are free-form/generic); they only reduce sci-fi cognitive bias for developers and keep error logs coherent. Do them opportunistically when touching the file (per the blueprint's "move it one step toward the layering" rule), not as a dedicated effort.

- `world.ts` `ship_clock_minutes` → `bounded_world_clock_minutes` / `world_time_baseline_minutes` (+ `migrations.ts` v29 column; **schema rename = migration**).
- `character.ts` / `migrations.ts` v26 `places.deck` → `hierarchy_level` / `zone` (**schema rename = migration**).
- `deck-graph.ts` `DeckGraph`/`buildDeckGraph`/`orphanRooms` → `LocationGraph`/`buildLocationGraph`/`orphanPlaces`.
- `world-archetype-provider.ts` port `simulationRoomKey` → `specialLocationKey`/`ritualLocationKey`; `crew`→`residents`; `rooms`→`locations`; archetype `isHub` → `is_bounded_world_template` (decouple "authored interior" from "concealed sim installation").
- `lib/worlds.ts` `setShipClockMinutes()` → `setWorldClockMinutes()`.
- `create-bounded-world.ts` ports `decks`→`templates`, `crew`→`ensemble`; default scene "Arrival" → template-driven.
- `seed-bounded-world.ts`, `simulate-world-forward.ts`, `tick-living-world.ts`, `enter-subworld.ts` — comments/vars "crew"→"residents," "off-scene crew"→"background residents," "ship-wide beats"→"daily rhythm beats."
- `migrations.ts` v24 `npc_reveries`/`is_cornerstone` and `prompts/narrator-system.md` line 97 "reverie" — evocative but the narrator is already forbidden to surface it; rename only if doing a broader pass (`npc_associations`/`is_foundational_memory`). **Schema rename = migration.**
- Prompt framings: `time-passage.md` line 1 ("for a starship story's narrative clock"), `ensemble-dressing.md` "pre-play simulation," `action-classifier-rules.ts`/`narrator-guidance.ts` Warhammer terms (`auspex`/`cogitator`/`servo`) — strip the sci-fi-specific framing words (the logic is genre-neutral).
- `narrative-clock.ts` / `world-clock.ts` — 24h Western clock bands and English time-keyword parsing; acceptable as English-prose defaults, make `minutesPerDay`/`hourPhrase` overridable later only if user-authored clock systems are added.

## Archetype & preset coverage gap analysis

**Yes — the archetype set is sharply skewed toward containment/vessel/facility models.** `archetypes/index.ts` registers exactly four hubs, and three of them assume a sealed, compartmentalized, crewed installation:

- SCOUT_VESSEL — sci-fi spaceship (decks, bridge, crew roles)
- RESEARCH_FACILITY — modern corporate lab (Animus/Abstergo analogue)
- BUNKER — modern military/government facility
- MONASTERY — the *only* pre-modern option

All four are `isHub: true` containment topologies (rooms + edges + crew slots + a "simulation room" for awakening). The default fallback (`world-archetype-provider.ts` `DEFAULT_TEMPLATE_ID = 'scout-vessel'`) privileges sci-fi when no archetype is chosen.

**What's missing for fantasy/historical/village/court genres** (audit's named gaps):
- **Feudal village** — lord's hall + villager homes + market + shrine, overlapping daily routines (a *fluid settlement*, not a sealed location).
- **Castle / manor** — great hall, solar, barracks, courtyard, village approach.
- **Temple-state / ziggurat complex** (Sumerian) — shrine, archive, treasury, administrative hall, market entry.
- **Court / palace** — throne hall, antechambers, quarters, with social/faction roles (courtiers, retainers) rather than crew slots.
- **Tavern / caravanserai hub** — common room, lodgings, stable, road (transient population).
- **1920s hotel / speakeasy** — lobby, bar, back room, residential floors.

**Two structural gaps beyond "more archetypes":**
1. **No fluid-society / faction-network archetype.** Every archetype assumes fixed-geometry containment; villages and courts are social networks, not deck plans. The occupancy/topology model itself (`occupancy-sim.ts`, `deck-graph.ts`, `npc-movement.ts` teleport-in-tight-spaces assumption) presumes discrete adjacent rooms — questionable for open settlements.
2. **Archetypes can only be added at compile time** (the `ALL` array is hardcoded; a new archetype needs a code change + redeploy). Audit recommends migrating archetype data to JSON/DB for runtime registration, or genre-inferred/player-chosen selection rather than a random roll.

**Preset gap:** `genre-presets/presets.ts` `PRESET_LIST` is all historical-intrigue presets — there are no cozy/lighthearted/romance tones, so adding a "Cozy Adventure" today would still force it through the techno-thriller arc engines.

## Recommended remediation strategy

Ordered by leverage. Group items that should land together.

**Phase 1 — Make the meta-frame opt-in (highest leverage; fixes the majority of `breaks` at the root).**
This is the single change that converts "every adventure is secretly a simulation" into "simulation is one selectable story mode."
- Introduce a `metaFrameKind` (`grounded` | `simulation` | `supernatural` | `noir`) on world/session creation. `createAdventureAction` defaults non-sci-fi genre presets to `grounded`.
- Gate **all** of the following on `metaFrameKind==='simulation'`: meta-story bible generation (`meta-story.md`), the REALITY block injection (`narrate-turn.ts` 278–300), lucidity tracking (`lucidity.ts`), bleed threads (`select-bleed-threads.ts`), arc engines (`arc-engines.ts`), the death→hub awakening prose (`play/page.tsx` 56–59), and the "Awakening" return-scene title (`return-to-hub.ts` 62).
- For `grounded`/`supernatural`/`noir`, either skip the bible or generate a genre-appropriate one (central mystery / stake).
- **Generalization work, not a rename.** **Requires prompt re-test** (meta-story, narrator REALITY section) and a likely **DB migration** to carry `metaFrameKind` / `world_link_kind` (see Phase 4). *Done* = a Sumerian/medieval adventure plays end-to-end in-browser with zero simulation language and no REALITY cue.

**Phase 2 — Genre-filter archetype selection + add non-containment archetypes (fixes the "starship as medieval home base" break).**
- Filter `pickHubArchetype` by genre so non-sci-fi worlds never draw SCOUT_VESSEL/RESEARCH_FACILITY.
- Change `DEFAULT_TEMPLATE_ID` away from `scout-vessel` to a neutral/era-appropriate fallback (or require explicit selection).
- Add the missing archetypes (feudal village, castle/manor, temple-state, court/palace, tavern/caravanserai). Pass genre context into the ensemble generator.
- Align `stub-crew-generator.ts` to use `template.eraTags` (one-line fix, prevents sci-fi names in non-sci-fi tests).
- **Mostly data/generalization work.** A new archetype isn't *done* (per CLAUDE.md) until a real seed call produces era-appropriate rooms, names, and ensemble.

**Phase 3 — Parameterize the hardcoded vocab regexes (fixes silent mechanic failures + guidance gaps).**
Land together because they share a prerequisite: **there is currently no genre field on `World`** — add one (or a `GenrePreset` reference) first.
- Break-tier: `lucidity.ts` `DISCOVERY_PATTERNS` (pass world; data-drive), `detect-subworld-exit.ts` `AWAKENING_PATTERNS` (bible-supplied triggers), `npc-promotion.ts` `isTransientServiceNpc` (genre patterns), `narrator-guidance.ts` `isInvestigativeMove`/`isMediaFeedMove`.
- Degrade-tier: `narrator-guidance.ts` `isTimeCheckMove`/`isDangerMove`/`isSpectacleMove`/`repeatedAmbientAnchors`; `name-resolution.ts` place/title words; `occupancy-sim.ts` profiles + traffic.
- Mechanism: add per-genre fields to `GenrePreset` (`transientRolePatterns`, `investigationTargets`, `mediaTerms`, `timeDeviceTerms`, `dangerTerms`, `spectacleObjects`, `ambientAnchors`, occupancy presets) and pass them through. **Generalization work.** Several feed LLM prompts/guidance → **re-test the narrator** on at least one non-sci-fi genre.

**Phase 4 — Schema generalization (the meta-frame migration).**
- Generalize `simulation_session` → `world_session` with `world_link_kind`; move `lucidity`/`has_awoken` into an optional per-kind feature table; widen `WorldLayer` (or decouple session-linkage from the layer label) to allow dual-realm / episode-linked / grounded multi-location.
- **Requires a DB migration in `migrations.ts`** that applies cleanly on boot, with the matching Mongo model/index under `infrastructure/persistence/mongo/models` updated and queries still typechecking (per CLAUDE.md "done" rules). Sequence *after* Phase 1 so the application code already reads the new shape.

**Phase 5 — Cosmetic renames (lowest leverage; pure renames).**
- Crew→ensemble/residents in prompts and use-case vars; `ship_clock_minutes`/`places.deck`/`simulationRoomKey`/`DeckGraph`/`setShipClockMinutes` renames; strip starship framing from `time-passage.md`/`ensemble-dressing.md`/`ensemble-beat.md`.
- The **column renames are migrations** (`ship_clock_minutes`, `places.deck`, optionally `npc_reveries`); everything else is non-migration identifier/comment churn. Do opportunistically. No prompt re-test needed for pure renames, but the prompt-framing edits (ensemble/time-passage) should get a quick smoke test.

**Pure rename vs. real generalization, at a glance:** Phases 1–4 are genuine generalization (behavior changes, prompt re-tests, migrations). Phase 5 is pure renaming with no behavior change except where it's a DB column.

## False positives reviewed

The audit explicitly checked and **rejected or downgraded** several plausible-sounding findings, which raises confidence in the rest:

- **`prompts/narrator-system.md` REALITY section (63–70) — rejected as not-a-finding for standalone worlds.** The REALITY cue is gated to `if (world.world_layer === 'subworld')`; standalone/QuickStart/Advanced worlds default to `standalone` and never receive it. (It remains a `degrades` for subworlds, addressed in Phase 1.)
- **`meta-story.ts` `MetaStoryBible` entity — rejected.** It's an optional Phase C feature; standalone worlds never set `meta_story_json` and the type itself imposes no constraint on stories that don't use it. The narrator prompt explicitly says to ignore the REALITY section in grounded worlds.
- **`createAdventureAction` "always imposes a hidden hub" — rejected as a verified false positive.** The whole concealed flow is gated behind the `SIM_HUB` env flag, is one tab among several, and is never triggered by QuickStart (`createBasicWorldAction`) or Advanced (`createWorldAction`). A player can create "Medieval England" via QuickStart with zero hub involvement.
- **`migrations.ts` v31/v32 world-layering schema — downgraded to cosmetic.** The columns encode the sim meta-narrative but are feature-specific: standalone worlds default to `world_layer='standalone'` and never materialize a session or touch lucidity/awakening. It's design inflexibility (one hardcoded meta-pattern), not a cross-genre functional break.
- **Several `breaks` downgraded to `degrades` on re-verification** because they only fire in the opt-in adventure/concealed-onboarding path, never for standalone worlds: arc engines, the `createStarshipWorldAction` prominence (only when `SIM_HUB` is off), `create-bounded-world.ts` `decks`/`crew` identifiers (cosmetic — never user-visible), and the meta-story prompt's universality claim (correctly scoped to adventure mode).
- **`ensemble-dressing.md` (line 1) — affirmed as a strength, not coupling.** It explicitly instructs the model to adapt to era/tone and "never default to science-fiction tropes," and is cited as the model other prompt workflows should follow.

The throughline: the engine's *storytelling layer* is genuinely genre-neutral and well-guarded; the coupling is concentrated in the *adventure/simulation meta-frame* (opt-in but default-on for genre presets) and in *hardcoded vocab regexes* that no-op outside modern/sci-fi settings.

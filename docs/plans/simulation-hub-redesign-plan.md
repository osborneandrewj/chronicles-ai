# Plan: Genre-Agnostic Simulation-Hub Redesign

Status: **draft for review** · 2026-06-09 · branch `onion-arch-refactor`

Evaluation of the first long bounded-world playthrough ("Scout Vessel", world 1,
Mongo — 275 turns) and a plan to (a) strip every starship/genre-specific assumption
out of the engine, (b) re-frame the bounded world as a **simulation hub** that holds
multiple nested sub-world adventures (Matrix / Westworld / Assassin's-Creed Animus),
and (c) fix the narrator/character/item/context problems the playthrough exposed.

> **North-star constraint (owner):** *"I don't want code that is tied to specific
> genres but code that can be used across a wide spectrum of genres."* Every change
> below is genre-neutral; the starship becomes **one authored archetype among many**,
> not a special case in the code.

### Locked decisions (2026-06-09)

1. **Build A→D together behind a feature flag**, then playtest — *not* incremental ship.
   The full arc (craft fixes → de-Starshipping → hub architecture → meta-story + reality-
   bending) lands behind a flag and is played through once it cohere; the Part III phases
   are the **build order within the flag**, not independent releases.
2. **Simulations are loose / `open`** — the archivist grows places as the player explores;
   no authored map per genre; fictional geo-coding gated off. Only the **hub** is fixed
   authored geometry.
3. **One canonical, randomly-typed hub per playthrough** — a single concealed home base
   (`pickHubArchetype()`); selectable/multiple hubs deferred.
4. **Hub tone = Westworld/Crichton dark secret** — the crew is genuinely friendly and the
   player is the newest member, but the institution harbors a meta-secret revealed
   gradually after the first awakening; this is the spine the Meta-Story Bible builds on.
5. **Concealment is a server-side invariant** (join UI, world title, premise, *and the
   inspector* — even for test users) until the in-fiction awakening flips `has_awoken`.
6. **The hub is never special-cased in code** — it is one `isHub` row in a data-driven
   archetype registry; the ship is row 1, not a privileged path.

---

# Part I — Evaluation of the "Scout Vessel" playthrough

275 turns, 11 characters, 9 places, 20 off-screen sim beats, 3 world-corrections.
Read end-to-end (prose + full world/story state). The single most important finding:

### 1. The player drove the engine straight into the target meta-narrative — by hand

With no built-in support, the player used the *correction* mechanism to declare the
ship a **Matrix-style simulation** ("The ship exists in a simulation... Only myself
and Elena are real"), granted himself **reality-bending power** ("I have the power to
bend the rules of the Matrix, even to slow time or change physics"), manifested
cascading-ring / multiplying-photograph distortions, and finally **awakened from a
medical simulation tank** (turn 275). The narrator embraced all of it with vivid,
high-commitment prose. **The Matrix/Westworld/Animus framing is not a stretch for
this engine — it is what an imaginative player reaches for unprompted.** The redesign
should make it native.

### 2. Autonomous characters already exist — but they are invisible

The off-screen "living tick" generated a genuinely good **14-beat autonomous subplot**:
Marcus and Lena, off-screen, formed a *silent conspiracy* (hand-held in the dark →
concealing a systems anomaly from the player → "the choice unmade, the silence
unbroken"). This is exactly the *"characters do things without the player prompting"*
behaviour the owner wants — **and it works today.** The problem is the pipe:
`OFF_SCREEN_BEATS = 2` (narrate-turn.ts:59) surfaces only the last 2 beats, walled off
as a soft *"OFF-SCREEN (elsewhere on the ship)"* advisory that drops first under
budget. A fully-recorded subplot never reaches the page.

### 3. The repetition tics are real, measurable, and mechanical

Across 138 narrator turns: **"shoulder" ×82, "rigid" ×78, "photograph/picture" ×64,
"data pad" ×54, "grip" ×44, "jaw" ×23, "pocket" ×23.** Three consecutive opening turns
(seq 9, 11, 13) each describe Elena's shoulders. The photograph-in-pocket beat recurs
~11 times as a bolted-on closing tag; the "17-Gamma blip pulses once more" closer
appears in ~18 turns even after the plot left the bridge. Root causes (all confirmed in
code):

- **Reverie flares have no cooldown or decay** (`reverie-flare.ts:36-79`): a reverie
  whose tags match the standing scene wins its NPC's slot every turn and re-injects the
  *identical* snapshot text ("shoulders locked, data pad glowing"). `last_flared_turn_id`
  exists and is stamped but never consulted.
- **`memorable_facts` is an unbounded append-only blob** (`memorable-fact-provenance.ts:11-20`):
  each append carries a unique `[t:N]` suffix so even verbatim duplicates never collapse;
  the narrator only sees the last 3 lines, so recent facts repeat while older ones scroll out.
- **A per-turn full-roster posture sweep + mandatory ambient closer** is the templating
  engine: every present NPC gets a tension line (almost always shoulders), every turn ends
  on the same environmental motif.
- **No prompt rule** against re-describing an established tic or object.

### 4. Item/object memory is structurally unreliable

Only **one** object (the stunners) was ever promoted to `story_resources`. The
photograph, ring, data pad, chainsword, and bolt pistol lived **only** in prose
`memorable_facts`. Consequences seen in the transcript:

- **Stolen-photo contradiction:** the player takes the photo from Elena's pocket
  (seq 72-73, "pocket visibly empty"), yet seq 87/93 revert to "still hidden in her
  pocket / presses against her ribs." Stale "NPC possesses X" fact overrode a state
  change the narrator itself made.
- **Data-pad duplication:** player pockets Torres's pad (seq 39); it reappears in
  Torres's hand (seq 87+) with the same 17-Gamma log.
- **Weapon-identity slip:** chainsword rendered as "stunner" mid-fight (seq 263).

There is **no structured "carried/tracked objects" block** the narrator is guaranteed
to see each turn (`state-block.ts` shows only the last 3 `memorable_facts` lines).

### 5. Characters are overwhelmingly passive

NPCs "watch", "freeze", "remain rigid", "lock posture" and almost never initiate.
During a live auto-destruct + an oxygen-venting murder, four crew are present and not
one acts. The lone exceptions (Chen reaching for the override seq 53; Marcus refusing to
kneel seq 205) **land precisely because they break the pattern** — proof the system
*can* write agency but defaults to frozen-witness mode whenever the player holds initiative.

### 6. The "frozen clock" became an accidental plot point — but it was a bug

The ship chronometer stuck at 0321 (the pre-ship-clock-work freeze) was *narratively*
woven into the simulation reveal ("time itself has stopped"), but it was the symptom the
recent ship-clock commits addressed. Worth noting: the prose-driven clock then **resumed
ticking after the awakening** (seq 275), re-asserting the simulation the narrator had just
dissolved — a state-boundary failure (see #8).

### 7. Real-world geocoding leaked into a sealed fictional interior

Bounded-ship rooms were geocoded to real coordinates — **"Bridge, Canterbury, Kent",
"Sim Deck → Sky100 Hong Kong", "Med Bay → Bay Pines Medical Center, Florida"** — and
then rendered to the narrator as *"KNOWN PLACES (real-world geography — authoritative)"*.
Cause: `resolveUnresolvedPlaces` (narrate-turn.ts:112-115) runs for **every** world with
no `spatial_mode` gate.

### 8. State boundaries are soft

- The awakening (seq 273, tanks/plugs/"no viewport") was immediately overwritten by the
  simulated bridge (seq 275) — the most important transition in the story was lost.
- A **duplicate player entity** exists: "Andrew Osborne" (#5, `is_player:1`) *and* a
  stray "Player" (#10, `is_player:0`) holding the Matrix `player_notes`. The dedup
  detector explicitly skips `is_player` rows, so it was never flagged.
- **Place duplication / weak titling:** "Crew Quarters corridor" (#7) vs "Corridor (Crew
  Quarters path to Mess)" (#8); every scene titled "Arriving at X".

### What worked (must be preserved)

- **Sentence-level prose is strong** — the photograph hand-off (seq 11-13), the
  72-hour-unchanged telltale, gravity "a fraction heavier than standard".
- **The reality-bending set-pieces are excellent** — the ring cascade, wet-ink
  inscriptions evolving across turns, the tank awakening. The engine says *"yes-and"* to
  surreal player assertions; the failure was **memory/state, not imagination**.
- **Physical-consequence continuity** (injuries, vented engine room, credit balances,
  ship loadout) is tracked accurately.
- **Costed, voiced NPC dialogue** (Elena's "each word measured like a ration").

> **Diagnosis in one line:** the engine's *imagination* and *physical-state continuity*
> are strong; its *descriptive variety*, *object memory*, *character initiative*, and
> *state-boundary discipline* are weak — and all four are fixable without touching the
> good parts.

---

# Part II — Design

## A. The simulation-hub model (genre-agnostic)

The engine already has two world shapes, and they map onto the owner's vision with almost
no conceptual stretch:

| Owner's concept | Existing primitive | Change needed |
|---|---|---|
| **Hub** — fixed geometry, defined architecture, a friendly resident crew, its own meta-story | `spatial_mode = 'bounded'` world from an authored archetype (today's scout vessel) | genericize the archetype; mark it the hub |
| **Sub-world / simulation** — looser geometry, its own story, any genre | a separate world (`open` or lightly-bounded), places grown as explored | enter it *from* the hub; tag it as a sub-world |
| **Death / awakening → back to the hub's sim room** | the drop-in recipe in `create-*-world.ts:63-82` | re-run it against the hub on exit |
| **Meta-story bleeds into sub-worlds** | the always-empty `threads:[]` slot in drama beats | a one-way curated injection |
| **Player grows power to bend reality** | the emergent Matrix playthrough | a tracked "lucidity" escalation |

**Why this is low-risk:** every aggregate is keyed by `world_id` and the turn pipeline
runs *inside one world at a time*. A hub is **just another bounded world**. We never nest
places under one `world_id`; we relate **worlds to each other** and let a session pointer
say which one is live.

### The hub is not always a ship — it is randomly designated (owner's ask)

The home base must **not** always be a starship. Like Assassin's Creed (an Animus in an
Abstergo lab, a hidden-order chapterhouse, a research compound), the hub is **one of several
authored fixed-geometry archetypes, chosen at random at world creation.** Because the hub is
concealed until the awakening, the random type is also a replay/variety lever — two players,
or the same player twice, awaken into different "real worlds".

- Each **hub archetype** is a fixed-geometry `WorldArchetype` flagged `isHub: true`, with a
  designated `simulationRoomKey` (the tank / Animus chair / loom / cradle room the player
  surfaces into on awakening), a **friendly resident ensemble**, and its own meta-story seed.
- Creation calls a pure **`pickHubArchetype()`** that randomly selects from all `isHub`
  archetypes (deterministic in tests via an injected source — recall `Math.random()` is
  banned in domain code, so the selection seed is injected through a port/param).
- Seed pool (authored data; expand freely — the registry is data-driven):
  1. **Deep-space scout vessel** (today's scout, genericized)
  2. **Corporate research facility** (Animus-style lab — the Abstergo analogue)
  3. **Cliffside monastery / hidden-order chapterhouse**
  4. **Cold-War underground bunker**
  5. **Deep-sea research station / submarine**
  6. **Orbital space station**
  7. **Remote arctic outpost**
  8. **Repurposed lighthouse / signal station**
- All hub archetypes share the same *contract* (rooms + topology + ensemble +
  `simulationRoomKey` + meta-story seed); only the dressing differs. Nothing in the code
  privileges the ship — it is row 1 of a registry, not a special case.

### New persistence (architecture audit)

- `worlds`: add `world_layer ENUM('hub','subworld')` (default keep existing as standalone)
  + nullable `parent_world_id`. (SQLite migration in `migrations.ts` **and** the Mongo
  model — both, per CLAUDE.md "done" definition.)
- New **`simulation_session`** entity: `hub_world_id`, `subworld_world_id` (nullable),
  `player_identity`, `status ENUM('in_hub','in_subworld')`. This is the durable "where is
  the player right now" pointer; the route resolves the active `world_id` through it, and
  `advanceTurn` stays world-id-driven and untouched.
- Keep each world's clocks independent. Reconcile **only** at the session edge: record hub
  `world_time` at drop-in/respawn and treat the gap as hub time elapsed (the Animus framing
  — minutes in the chair, days in the simulation).

### New domain services + use cases (all pure / orchestration)

- `detectSubworldExit(narration, state) → Exit | null` — pure: detects death/awakening
  signals. Wired into `narrate-turn` post-stream alongside the other enrichers (fail-open).
- `ReturnToHub` use case — reuses the existing drop-in recipe to place the player in the
  hub's simulation room, open a scene, set the cursor, flip the session to `in_hub`.
- `EnterSubworld` use case — seeds/links a sub-world (`parent_world_id = hub`), drops the
  player in, flips the session to `in_subworld`.
- `clusterSimArcs(events) → Arc[]` — pure: groups `provenance='sim'` timeline events by
  participant/thread and detects a threshold-crossing arc (so the Marcus/Lena conspiracy
  becomes one promotable thread instead of 14 loose beats).
- `selectBleedThreads(hubThreads) → Thread[]` — pure: picks hub meta-story threads tagged
  `bleed`, keyed on relevance tags, for one-way injection into the sub-world.

### Onboarding & concealment (owner's explicit ask)

**The player must never know, at creation time, that the world resolves to a ship/hub.**
The simulation truth is revealed *diegetically* (first death/awakening), never in the UI.

- **The player picks a genre, not a "sub-world".** Creation presents a **list of historical
  settings** ("Rome", "Napoleonic Wars", …). The word "sub-world", "simulation", "hub",
  "ship", or "Animus" appears **nowhere** in the creation flow. As far as the UI is
  concerned, the player is choosing an adventure to play.
- **Ambiguous codename, not a descriptive title.** The adventure is named with an opaque
  designator — **"Protocol 457", "Sequence Theta-9", "Archive 12", "Cycle 88",
  "Designation Vesper"** — generated so the player **cannot infer the genre or meaning from
  the title.** (Diegetically, the facility refers to simulations by protocol number, not
  content — this *is* the concealment, and it pays off at the reveal.) This replaces the
  hardcoded player-visible "Scout Vessel".
- **The premise/description is hidden from the player.** The rich genre premise still exists
  internally (it seeds the narrator/archivist), but it is **never rendered** in the join UI.
  No "A crewed scout ship, already in motion before you board." The player sees a genre
  choice and a codename — nothing that spoils the setting or the simulation frame.
- **The player is dropped into the chosen genre adventure first.** The **hub is seeded
  silently behind the scenes** (its crew, geometry, simulation room) but never surfaced; the
  first and only thing the player experiences is the historical adventure they picked.
- The hub crew are **friendly**; the player is the **newest member of the crew** — but this
  is only revealed *after* the first awakening, when the hub becomes visible. (The hub seed
  gets a *friendly-ensemble* default; antagonism lives in the simulations and the meta-story,
  not the home base.)
- On death/awakening, the player surfaces in the hub's **simulation room** (the literal
  tank/Animus/loom room — an authored room in the hub archetype). **This is the moment of
  reveal**: the codename and the hidden architecture suddenly make sense.

#### Concealment is a first-class invariant, enforced server-side

The reveal must not be spoiled by *any* surface, including the **world inspector** and
debug/test views — *"even test users [must] be unaware of the 'real world' until they are
awoken."* Concealment is therefore enforced **at the query/use-case layer, not the UI**, so
no view can leak it:

- A pure **`concealmentView(session, world)`** gate decides what is visible. While the
  session is `in_subworld` **and the player has not yet awoken** (a `has_awoken` flag on the
  session, default false), every read surface is scoped to the **sub-world only**:
  - **Inspector (`InspectWorld` + the query port):** returns only the active sub-world's
    characters/places/scenes/dossier. The hub world, `parent_world_id`, `world_layer`,
    the simulation room, and any hub characters/threads are **filtered out** before they
    reach the component — they are not "hidden in CSS", they are not in the payload.
  - **Hidden premise:** never returned to any client view (join *or* inspector); it lives
    only in the narrator/archivist context assembly.
  - **No `world_layer` / `parent_world_id` / session fields** are exposed in any
    player-or-tester-reachable API response while concealed.
  - **Codename only** for the world title everywhere it renders.
- Once `has_awoken` flips true (set by the same `detectSubworldExit` → `ReturnToHub` path),
  the gate relaxes and the hub becomes a legitimate, inspectable world.
- **Leak-surface checklist** (every one must pass `concealmentView`): join/creation UI,
  world list, world title/header, world inspector, any dossier/timeline panel, route JSON
  responses, and any dev/debug endpoint. A leak on *any* of these is a bug, not a polish item.

### Historical genre catalogue (≥20, owner's ask)

The genre picker is **data-driven** — each entry is a `GenrePreset` (display label + hidden
internal premise + tone/era tags), so adding a setting is a data edit, not code. Seed set
(expand freely; the engine is genre-agnostic, so non-historical settings can be added the
same way later):

1. Ancient Rome — late Republic, Caesar's shadow
2. Napoleonic Wars — Grande Armée, 1805–1815
3. Ancient Egypt — the Nile, the Pharaoh's court
4. Classical Greece — Athens vs Sparta, the Peloponnesian War
5. Feudal Japan — Sengoku-era samurai and warlords
6. The Viking Age — Norse raiders and longships
7. Medieval England — knights and the Wars of the Roses
8. The Crusades — the Holy Land, 12th century
9. The Mongol Empire — Genghis Khan's steppe conquest
10. Renaissance Italy — Florence and Venice, the Medici and Borgias
11. The American Revolution — 1776, redcoats and rebels
12. The American Civil War — 1861–1865, North and South
13. The Wild West — the American frontier, 1870s
14. Victorian London — gaslight, industry, and intrigue
15. Tudor England — the court of Henry VIII and Elizabeth I
16. The Ottoman Empire — Constantinople under Suleiman
17. The French Revolution — the Terror, 1793
18. Imperial China — the Ming dynasty and the Forbidden City
19. Conquistador Mesoamerica — Aztec empire and the Spanish arrival
20. The Golden Age of Piracy — the Caribbean, early 1700s
21. Ancient Persia — the Achaemenid Empire, Xerxes' court
22. World War II — occupied Europe, resistance and espionage
23. World War I — the trenches of the Western Front
24. Cold War Berlin — divided city, 1961, spies and defectors

> Each preset carries a hidden premise (the part that *was* "A crewed scout ship…") and an
> ambiguous-codename generator; the player sees only the genre label, then a codename.

### The reality-bending track (Matrix / Westworld / Animus)

- A per-player **lucidity / rule-violation** value in authoritative state, surfaced to the
  narrator. Early: world feels fixed. Mid: cracks (an NPC glitches, a believed rule breaks).
  Late: the player gains *mechanical affordances* (slow time, bend physics, rewrite a
  script). Each step is **earned by discovery**, not arbitrary leveling.
- Narrator prompt gains an **optional** "Escalating Player Power & Reality Fractures"
  section, gated on a simulation-framing premise (so non-simulation genres are unaffected).
- Hub meta-story elements **bleed** into sub-worlds via `selectBleedThreads` → the empty
  drama-beat `threads:[]` slot + the narrator state block.

## B. De-Starshipping (rename + data-drive)

Structural shape is already generic; only naming and the single hardcoded instance leak.

- **Ports:** `CrewGenerator → EnsembleGenerator`; `DeckPlanProvider → WorldArchetypeProvider`.
  Types: `DeckPlanTemplate → WorldArchetype`, `DeckPlanRoom → LocationNode`,
  `DeckPlanEdge → LocationConnection`, `DeckPlanCrewSlot → EnsembleSlot`,
  `GeneratedCrew → GeneratedEnsemble`. Internal shapes unchanged.
- **Archetype registry:** replace the single `scout-template.ts` constant with a
  data-driven `world-gen/archetypes/` registry holding **multiple hub archetypes** (scout
  vessel, research facility, monastery, bunker, … — Part II.A pool, proving the ship is not
  special). New fields: `entryLocationKey`, `initialSceneTitle`, `defaultCharacterLabel`,
  `playerIntroTemplate`, `isHub`, `simulationRoomKey`. The provider reads from the registry
  by `templateId`; **`pickHubArchetype()` selects a hub at random** (injected seed) at
  creation — no hardcoded default ship.
- **Use case:** `CreateStarshipWorld → CreateBoundedWorld`. All player-visible strings
  ("Arrival", "Newcomer", "Bridge", "A newcomer just come aboard") come from the archetype.
- **Codename, not a descriptive name (player-facing):** the world the player sees is no
  longer "Scout Vessel" or any genre-revealing title. A pure `generateCodename()` mints an
  **ambiguous designator** ("Protocol 457", "Sequence Theta-9") that does not encode the
  genre. The rich, evocative internal name/premise still exists for the narrator but is
  **never shown** in the join UI (see Onboarding & concealment). This resolves *"the name
  should be something more like Protocol 457… so the user can't derive the meaning"* and
  *"make the description hidden as well."*
- **Genre-preset registry:** a data-driven `world-gen/genre-presets/` (≥20 historical
  settings, Part II.A catalogue). Each preset = display label + **hidden** premise + era/
  tone tags. The picker lists labels only; the chosen preset's hidden premise seeds the
  adventure and (silently) the hub.
- **Clock:** `ship-clock.ts → world-clock` naming (`minutesToShipTime → minutesToWorldTime`);
  logic already genre-agnostic.
- **UI:** `StarshipLaunch.tsx → an adventure/genre picker` that lists **genre labels only**
  — no premise, no "ship", no "bounded/sub-world" vocabulary, no descriptive blurb. On
  submit it shows the generated codename. All concealment lives here: the UI must not leak
  the architecture.
- **Prompts:** `crew-dressing.md → ensemble-dressing.md`, `drama-beat.md → ensemble-beat.md`;
  strip "ship/crew/deck/watch/mess/vessel". Genre vocabulary is injected, not baked.
- **Scripts:** rename `*-ship.mjs → *-bounded-world.mjs`, parameterize by `--template`.

## C. Cross-cutting craft fixes (genre-agnostic; benefit every world)

1. **More narration in context** (narrate-turn.ts:54-55): raise `FULL_HISTORY_TURNS`
   6→~10 and the compaction slice 320→~700; ideally replace the fixed split with a
   token-budget packer that fills full **assistant** turns newest-first up to a measured
   input budget, then compacts overflow. Narration is canonical — prioritize it over user
   turns when trimming.
2. **Subtler recurring motifs:**
   - Reverie flare **cooldown + intensity decay** using `last_flared_turn_id`
     (reverie-flare.ts) so motifs rotate and soften.
   - `memorable_facts` **dedup-on-append + cap** (memorable-fact-provenance.ts).
   - Narrator prompt: **"Description Variance & Established Detail"** — establish a tic/
     object once, then let it recede unless it changes.
   - Drop the obligatory full-roster posture sweep and mandatory ambient closer; only
     NPCs who do/feel something new appear; vary turn shape by stakes.
3. **First-class item tracking:**
   - Give `story_resources` a `held_by` / `location` / `salient` distinction (single
     genre-neutral object ledger).
   - **Deterministic** object-acquisition extractor (take/pick-up/grab/pocket/given +
     noun, mirroring `extractDestination`) so tracking doesn't depend on the LLM opting in.
   - Always render a pinned **"CARRIED / TRACKED OBJECTS"** block in the player state
     section as `name — status` lines (never paraphrased prose).
   - Archivist **"Item-State Continuity Check"** rule; extend freshest-field-wins to cover
     object ownership (kills the stolen-photo contradiction).
4. **Proactive characters:**
   - npc-agent prompt **"Proactive NPC Behavior"** — NPCs pursue `active_goal`s
     independent of player input, talk to each other, initiate; vary react-vs-pursue.
   - **Surface the living-tick arcs on-screen:** `clusterSimArcs` promotes a detected arc
     (bump importance + attach a `StoryThread`) into the **authoritative** state block, not
     the 2-beat advisory; widen the window; let the narrator dramatize co-located NPC action.
   - Allow the living tick to inject an NPC intent on high-stakes turns (NPCs act under danger).
5. **Geo-coding gate:** wrap `resolveUnresolvedPlaces` in `if (world.spatial_mode !==
   'bounded')`; seed bounded places `geo_status='unavailable'`; skip the KNOWN-PLACES render
   for bounded worlds. (Add a per-world `geo_enabled` flag for fictional *open* worlds too.)
6. **State-boundary + identity discipline:**
   - Treat a player-declared reality/scene transition as a **hard boundary** that flushes
     and rewrites the scene anchor/location (so the awakening can't be overwritten).
   - **Single-player invariant:** route protagonist self-naming through `reveals_name_of`/
     alias merge against the existing `is_player=1` row; flag multiple `is_player` rows.
   - Place name-resolution / dedup; archetype-driven scene titling (kill "Arriving at X").
7. **NPC name diversity & era-appropriateness:**
   - **Root cause:** `crew-dressing.md` asks Grok for *"a fitting personal name"* with no
     pool and no avoid-list, so the LLM falls back on a narrow band of defaults — *"Voss"
     appears in almost every story* (the Scout captain was Elena **Voss**). The open-world
     `world-generator` has the same gap.
   - A pure **`NamePool`** service keyed on the genre/era tags carried by the `GenrePreset`
     (Roman names for Rome, French for Napoleon, Norse for Vikings, …) — diversity *and*
     period authenticity in one move. It exposes `sample(tags, n, { exclude, seed })`
     returning a fresh, shuffled candidate set (seed injected — no `Math.random()` in the
     domain).
   - **Inject a sampled candidate list + an avoid-list into the prompt each generation** so
     the LLM anchors on fresh, era-correct names instead of its defaults; the avoid-list
     carries **recently-used surnames** (across recent worlds) so the same names don't recur.
     The prompt gains an explicit rule: *"Draw on the provided names or names of the same
     era/culture; do not reuse the listed recently-used names; avoid generic defaults."*
   - Expand `stub-crew-generator`'s `FIXED_NAMES` and make it draw from the same pool
     (seeded) so tests/offline runs are diverse too.

## D. The meta-story engine — make it epic

The over-arching story (why the facility runs these historical simulations, who the player
really is, what the friendly crew is hiding, what the player is becoming) must be
**incredible** — a genuine techno-thriller, not a generic "it's a simulation" shrug. It is
generated, genre-agnostic, and built for production value.

### A pinned, generated **Meta-Story Bible** per hub

At hub creation, a high-tier pass produces a durable `MetaStoryBible` (stored on the hub
world, pinned into narrator/archivist context, never shown raw to the player). It contains:

- **The Question** — the personal hook (Ludlum): who is the player, why are they really
  here, whose memory/identity is this? (The "newest crew member" is the surface; the truth
  is bigger.)
- **The Institution** — the facility/order/program and its *true* purpose behind the
  friendly face (Crichton/Westworld hubris; Clancy black-program secrecy).
- **The Hidden Truth & the Cost** — what running the simulations is really *for* and what it
  is doing to people/reality; the ticking consequence if it continues.
- **The Antagonist & the Allies** — who inside the institution will burn the player to stay
  hidden, and who is secretly on their side.
- **The Escalation Ladder (acts)** — a beat map from *"a friendly new posting"* →
  *first glitch* → *first awakening/reveal* → *discovering the program* → *learning to bend
  reality* → *the choice*. Tied to the lucidity track (Part II.A).
- **Bleed Motifs** — a recurring figure / phrase / symbol / impossible object that crosses
  *every* simulation regardless of era (the thread that says "something is wrong with all of
  this"), feeding `selectBleedThreads`.
- **The Endgame Fork** — master the system / free it / expose it / escape it.

### A library of **arc engines** (structures, not IP)

A small data library of techno-thriller *structures* distilled from the masters, selected
aptly (or at random, seed injected) for the hub and then richly instantiated by the LLM:

- **The Erased Operative** (Ludlum / *Bourne*): the player is a made asset with wiped memory;
  the simulations are conditioning *and* retrieval; the program will sacrifice anyone to stay
  buried.
- **The Memory Hunt** (Animus): the simulations mine recorded/ancestral memory for a hidden
  key, location, or name; rival factions race for it.
- **The Drift** (Crichton / *Westworld*): the simulated people are beginning to *wake*; the
  controllers are losing the line between real and constructed — and so is the player.
- **The Black Program** (Clancy): a strategic threat is encoded in history; the facility is a
  deniable program decoding it before a rival power; betrayal runs to the top.
- **The Breach** (Crichton / *Andromeda*/*Jurassic Park*): the technology has a catastrophic
  flaw; every simulation accelerates a countdown to collapse.

These are genre-neutral spines — they instantiate equally well whether the hub is a starship,
an Abstergo-style lab, or a monastery, and whichever historical genres the player picks.

### Built for quality (generation, not a single prompt)

Because "epic" is the bar, the bible is produced by a **multi-pass generation** at hub
creation, not one cheap call:

1. **Architect** pass — a strong system prompt ("you are a techno-thriller story architect…
   build a Ludlum/Clancy/Crichton-grade conspiracy around this hub and these genres") emits a
   candidate bible.
2. **Judge/punch-up** pass — score candidates for stakes, originality, coherence, and the
   strength of the reveal; synthesize the best, grafting the sharpest ideas from runners-up.
3. **Coherence check** — verify the escalation ladder, bleed motifs, and endgame fork are
   internally consistent and seed-able into state.

This is a natural fit for a generation **workflow** (judge panel) run once at creation — the
cost is one-time and the payoff is the spine of the entire playthrough.

> Concealment still holds: the bible seeds the narrator and the bleed channel, but is **never
> rendered** to the player or the inspector (Part II.A) — it is *revealed only through play*.

---

# Part III — Phased plan

**Per the locked decision, A→D land together behind a feature flag and are playtested once
the arc coheres** — the phases below are the **build order inside the flag**, not separate
releases. Ordering rationale: **craft fixes first** (foundation every world uses) →
**genericize** (unblocks all genres) → **hub architecture** → **meta-narrative + reality-
bending layer**. The flag gates the new hub/concealment/onboarding path; the existing
open-world and current bounded path keep working until the flag flips.

### Phase A — Narrator craft & memory (no architecture change)
*Highest ROI; fixes every visible complaint in Part I.*
- Reverie flare cooldown + decay; `memorable_facts` dedup + cap.
- Narrator prompt: Description-Variance rule; drop roster-sweep/forced-closer.
- First-class item ledger (`held_by`/`salient`) + deterministic acquisition extractor +
  pinned CARRIED OBJECTS block + archivist continuity rule + object freshest-field-wins.
- More narration in context (budget-driven packer).
- Geo-coding gate for bounded worlds.
- Surface living-tick arcs on-screen (`clusterSimArcs` → state block) + proactive-NPC prompt.
- Single-player invariant + player-dup fix.
- **NPC name diversity:** `NamePool` + sampled-candidates + recently-used avoid-list wired
  into the crew-dressing and world-generator prompts (era-keying to genre presets lands in
  Phase B; the diversity/avoid-list mechanism lands here).
- **Done when:** a fresh bounded playthrough shows no shoulder/photo tic storm, the
  narrator honours held objects across ≥20 turns, an off-screen NPC subplot appears in the
  prose, no place is geocoded, and **three freshly-created worlds produce three distinct,
  non-overlapping name sets (no recurring "Voss").**

### Phase B — De-Starshipping / genericization + concealed onboarding
- Rename ports/types/use case/clock/UI/prompts/scripts per Part II.B.
- Data-driven archetype registry + ≥1 non-sci-fi archetype; **genre-preset registry (≥20
  historical settings)**.
- **Concealed creation:** genre-label-only picker; `generateCodename()`; hidden premise
  (never rendered in the join UI).
- depcruise green; `npm test` + `npm run test:mongo` green; both migrations apply on boot.
- **Done when:** the player picks a genre, gets an ambiguous codename (e.g. "Protocol 457"),
  plays a turn, and **nowhere in the creation/join UI** is the premise, "ship", or any
  simulation vocabulary visible; grep finds no "starship/scout/crew/deck" in domain/
  application code paths.

### Phase C — Simulation-hub architecture
- `world_layer` + `parent_world_id` (SQLite + Mongo); `simulation_session` entity + route
  resolution.
- `EnterSubworld` / `ReturnToHub` use cases; `detectSubworldExit` wired post-stream.
- Onboarding: friendly hub crew, player = newest member, **drop into a sub-world first**,
  awaken → hub simulation room. **`pickHubArchetype()` randomly designates the hub type**
  (ship / facility / monastery / …) at creation, concealed until the awakening.
- **Meta-Story Bible generated at hub creation** (multi-pass / judge-panel workflow, arc-
  engine library) and pinned into context; bleed motifs feed the bleed channel.
- One-way meta-story bleed (`selectBleedThreads` → drama `threads:[]` + narrator state).
- **`concealmentView` gate + `has_awoken` flag** enforced at the query/use-case layer;
  inspector and all read surfaces scoped to the sub-world until awakening.
- **Done when:** player starts in a historical sub-world, dies/awakens back into the hub's
  sim room with identity intact, a hub meta-thread visibly bleeds into a sub-world beat,
  **and a tester inspecting the world before awakening sees no hub, no `parent_world_id`,
  no simulation room, and no hidden premise** — the leak-surface checklist passes.

### Phase D — Reality-bending power growth + meta-story payoff
- Lucidity / rule-violation track in state; narrator "Reality Fractures" optional section.
- Earned escalation: cracks → affordances (slow time / bend physics / rewrite a script),
  paced by the **Meta-Story Bible's escalation ladder**.
- Bleed motifs recur across simulations; the **endgame fork** (master / free / expose /
  escape) becomes reachable.
- **Done when:** across a session the player demonstrably escalates from noticing an
  impossibility to acting on it (tracked in state, gated to simulation-framing premises),
  a bleed motif visibly recurs across two different-era simulations, and the meta-story
  builds toward its reveal and choice rather than feeling like set dressing.

---

## Resolved (2026-06-09) — see Locked decisions

1. **Sub-world geometry** → loose / `open` (authored geometry only for the hub).
2. **Hub count** → one canonical, randomly-typed hub per playthrough.
3. **First cut** → build A→D together behind a feature flag, then playtest.
4. **Friendly-crew premise** → Westworld/Crichton: friendly crew, dark institutional secret
   revealed after the first awakening.

## Next step

The design is locked. The natural next move is to turn this plan into a concrete,
step-by-step **implementation plan** (file-level tasks, migrations for SQLite + Mongo, the
feature-flag seam, port renames, and the generation workflow), following the milestone
convention in `docs/plans/_template-milestone.md` — on the owner's go-ahead.

# Westworld-Style Shared World Design Notes

**Date:** June 1, 2026  
**Status:** Reference exploration, not an implementation plan  
**Scope:** Shared AI-authored worlds, living NPCs, fictional geography, hidden human/NPC control, and player adaptation

These notes capture a product and architecture exploration around making
Chronicles feel like a living "park": a shared fictional world with consistent
geography, authored pressure, autonomous NPCs, and multiple users moving through
the same canon.

The central conclusion is:

```text
AI invents.
Database remembers.
Director reconciles.
Narrator dramatizes.
Archivist commits.
```

The system should not be "chat history plus generation." It should be a shared
simulation database with prose rendered on top.

---

## 1. Product Vocabulary

The project needs stable language because terms like "adventure", "world",
"park", and "story" imply different product and architecture boundaries.

Recommended usage:

```text
World
  The main player-facing container.

Park
  Internal design metaphor for a living, authored simulation experience.

Story
  The emergent record of what happened.

Adventure
  A bounded arc inside a world, not the world itself.
```

### Primary Noun: World

Use **world** as the primary player-facing product noun:

```text
Choose a world.
Enter a world.
Create a character in this world.
Explore the world.
```

Why:

- It works across fantasy, historical fiction, sci-fi, horror, and town-scale play.
- It does not overfit to the Westworld metaphor.
- It supports both a one-town setting and a continent-scale historical setting.
- It matches the existing codebase vocabulary (`worlds`, `world_id`,
  `WorldSummary`, etc.).

### Internal Metaphor: Park

Use **park** mainly in internal design language:

```text
The first park is one town.
The Roman park is a mega-park.
Park design includes geography, NPC routines, factions, and entry points.
```

Why:

- It is useful when discussing the Westworld-like pattern: authored simulation,
  hosts/guests, routines, secrets, controlled entry points, and hidden machinery.
- It becomes awkward in player-facing historical or serious fiction contexts.
- It should not leak into UI unless the fiction literally is a park.

### Output, Not Container: Story

Use **story** for the emergent record of play:

```text
Your story in Harrowmere.
The story so far.
This scene becomes part of the world's story.
```

Avoid making "story" the top-level creation object for shared simulation. "Create
a story" implies a private authored narrative rather than a persistent shared
world.

### Bounded Arc: Adventure

Use **adventure** for a contained arc, mission, scenario, or thread cluster:

```text
The Ashen Road adventure.
A Senate intrigue adventure.
A frontier patrol adventure.
```

Do not use "adventure" as the top-level object. In a persistent shared world, one
player's adventure may overlap with another player's, and both may affect the
same world.

### Glossary

```text
World
  A persistent shared setting with geography, characters, factions, history, and rules.

Character
  Any person in the world. Controller type is hidden: human, proxy, or NPC.

Scene
  A local moment of play with a place, participants, and immediate action.

Thread
  An unresolved pressure: mystery, quest, threat, relationship, rumor, faction move.

Event
  A committed world-state change that can affect other places or players.

Chronicle
  The written record of play: narration, scenes, and history.

Adventure
  A bounded arc or thread cluster inside a world.

Park
  Internal term for a designed living-world experience, especially when discussing
  Westworld-like simulation.
```

Recommended UI nouns:

```text
Worlds
Characters
Scenes
Threads
Chronicle
Map
```

Recommended internal nouns:

```text
Park
World Template
World Instance
World Event
World Director
World Simmer
```

Clean product sentence:

```text
Players create characters and enter worlds. Their scenes generate a chronicle.
Their choices advance threads and create events that can reshape the world.
```

---

## 2. World Creation Direction

The project currently supports two creation paths:

- **Quick start:** player name + genre -> generated world.
- **Advanced:** user-curated premise, location, time, and character details.

Both are useful, but they should not be the primary shared-world product surface.

For shared multiplayer worlds, the stronger model is:

```text
Predefined shared worlds as the main experience.
Quick-generated worlds for solo/private play and internal drafting.
Advanced creation for admin/world-builder workflows.
```

Why:

- Shared worlds need coherent canon, authored pressure, and stable social context.
- Fully random worlds vary too much in quality and are hard to make multiplayer-safe.
- One player's onboarding choices should not define global canon for everyone else
  unless that player is explicitly creating a private instance.
- Westworld-style play works best when players enter a world that already has
  history, secrets, routines, and unresolved tension.

Recommended product model:

```text
World Template
  immutable authored/generated seed canon:
  premise, geography, places, factions, NPCs, secrets, rules, starting pressure

World Instance
  mutable shared canon:
  timeline, turns, discovered places, promoted NPCs, changed relationships

Player Character
  per-user:
  name, identity, inventory, private knowledge, relationships, current scene

Scene / Party / Local Thread
  scoped multiplayer activity:
  who is present, what is happening here, what can safely mutate now
```

The player-facing path should be:

1. Choose a rich predefined world.
2. Create or claim a character.
3. Enter through an authored entry point.
4. Let the narrator expand local texture while the world preserves global canon.

---

## 3. AI Seeding Before Players Enter

AI should help seed the world, but it should generate **structured playable
pressure**, not just lore prose.

Recommended offline pipeline:

```text
World Bible Generator
  creates premise, regions, factions, rules, major places, and instability

Casting Director
  creates major NPCs, public roles, private wants, fears, secrets, relationships,
  routines, and first moves

Situation Graph Builder
  converts lore into active story threads, clues, rumors, objectives, resources,
  threats, and hidden timers

World Simmer
  runs a short autonomous prelude where NPCs and factions make unresolved moves

Archivist / Director
  commits selected output into structured canon

Entry Point Generator
  creates several playable doors into the pressure
```

The important rule:

```text
Autonomous pre-simulation should create tension, not resolve it.
```

Bad simmer:

```text
The mayor investigates the cult, exposes the leader, and ends the crisis.
```

Good simmer:

```text
The mayor investigated the cult, vanished, and three NPCs now have conflicting
explanations. One is lying.
```

This gives the world momentum before the first player arrives.

---

## 4. Fictional Geography Consistency

For fake worlds, geography must be structured canon. The narrator should not
remember mountains by free-form prose alone.

Use three layers:

```text
Landmark
  durable physical thing: mountain range, river, city, moon, forest

Perspective / Visibility
  how that landmark appears from known places

Discovery Layer
  facts learned by players or NPCs over time
```

Example landmark:

```json
{
  "id": "ashen_spine",
  "name": "The Ashen Spine",
  "kind": "mountain_range",
  "global_description": "A jagged black mountain range with two snow-bright peaks and a vertical notch like a missing tooth.",
  "invariants": [
    "visible from most western valleys",
    "two tallest peaks are snow-capped",
    "a dark central cleft breaks the skyline",
    "stone appears charcoal-black from a distance"
  ],
  "unknowns": [
    "what lies inside the central cleft",
    "whether the smoke seen at dusk is volcanic or inhabited",
    "which passes are survivable"
  ]
}
```

Example place view:

```json
{
  "place": "Harrowmere",
  "landmark": "ashen_spine",
  "bearing": "east",
  "distance_band": "far",
  "visible_profile": "The Ashen Spine cuts the eastern horizon: black teeth, two white summits, and the same dark notch visible even through rain."
}
```

Exploration should add facts without overwriting distant descriptions:

```text
Known from afar:
- black jagged range
- two snow peaks
- central cleft
- possible smoke at dusk

Discovered later:
- the black color comes from basalt glass
- the central cleft is a pass
- warm air rises from vents near the pass
- the "smoke" may actually be steam from hidden settlements
```

New geography details must pass a consistency check:

```text
Does this new detail contradict a landmark invariant or known perspective?
```

If yes, reject it, revise it, or frame it as an in-world misconception.

Possible schema concepts:

```text
landmarks
  id, world_id, name, kind, global_description, invariants_json, unknowns_json

place_landmark_views
  place_id, landmark_id, bearing, distance_band, visible_profile,
  visibility_conditions_json

discoveries
  world_id, subject_type, subject_id, discovered_by, visibility, fact,
  source_turn_id
```

Narrator state should include:

```text
VISIBLE LANDMARKS FROM CURRENT PLACE
- The Ashen Spine, east, far: black jagged range, two white peaks, central cleft.

KNOWN DISCOVERIES ABOUT THE ASHEN SPINE
- The black color is basalt glass.
- Warm air rises from vents near the central pass.
```

The narrator may vary light, weather, tone, and emotional framing. It may not
move the landmark, change its invariant silhouette, or contradict known facts.

---

## 5. Visual World Maps

The visual map should be a rendered view of structured geography, not the source
of truth.

Recommended architecture:

```text
Structured Map Data
  regions, places, landmarks, routes, borders, distances, visibility

Map Renderer
  turns the data into SVG/canvas/image UI

Narrator / Archivist
  update structured data as users explore
```

Viable map levels:

### Abstract Node Map

Fastest and safest:

```text
Harrowmere -- Old Road -- Foothill Shrine -- Ashen Spine Pass
     |
South Fen
```

Good for early versions because it preserves consistency without pretending
precise distances are known.

### Generated Atlas Image

Useful for atmosphere, but risky as the only map source. AI-generated images are
hard to update consistently. Use this as a decorative or export layer.

### Procedural Vector Map

Best long-term option. Store coordinates and render SVG/canvas.

```json
{
  "places": [
    { "id": "harrowmere", "x": 120, "y": 340, "kind": "town" },
    { "id": "ashen_spine", "x": 620, "y": 210, "kind": "mountain_range" }
  ],
  "routes": [
    { "from": "harrowmere", "to": "foothill_shrine", "kind": "road" }
  ],
  "regions": [
    { "name": "Western Valleys", "polygon": [[80, 300], [240, 280], [260, 420]] }
  ]
}
```

Render mountains as ridges, rivers as curves, roads as lines, settlements as
icons, unexplored areas as fog, and discoveries as labels/tooltips.

Rule:

```text
The database is the map.
The image is only a rendering.
```

---

## 6. Westworld-Style Shared World Architecture

To make a living park for multiple users, the system needs a shared simulation
core beneath the narrator.

Recommended layers:

```text
World Template
  authored/generated seed canon

World Instance
  mutable shared world state

Player Characters
  per-user state inside that world

Simulation Layer
  NPCs, factions, clocks, travel, discovery

Narrator Layer
  renders local scenes into prose

Archivist Layer
  commits what changed back into structured state
```

World template content:

- geography: regions, towns, roads, landmarks, distances
- places: saloon, church, mine, train station, hidden sites
- NPCs: public identities, private goals, routines, relationships, secrets
- factions: sheriff, outlaws, company, townsfolk, cult, rebels
- story threads: disappearances, debts, betrayals, elections, raids
- physical invariants: "the mesa is west of town"
- tone and rules: technology level, violence level, supernatural limits

World instance state:

- current world time
- known/discovered locations
- active scenes
- NPC locations and goals
- relationship changes
- timeline events
- clues discovered
- faction state
- world-level consequences

NPCs need more than descriptions:

```text
identity
public role
current location
daily loop
private goals
relationships
secrets
resources
fear / wound / desire
current plan
memory / reveries
agency level
```

Only a small number of NPCs should be high-agency at any moment. Most are cheap
background until promoted by contact, relevance, or story pressure.

---

## 7. Multiplayer State Boundaries

Multiple users require clear separation between global, local, and private state.

Global state:

```text
town burned down
NPC died
mayor was exposed
bridge collapsed
new route discovered
```

Player-specific state:

```text
inventory
wounds
private knowledge
relationships
current scene
character history
```

Shared-but-local state:

```text
three players are in the saloon scene
one player is at the mine
two players are traveling together
```

Do not run one global chat log for everyone. Use scenes, locations, and parties:

```text
World
  Scene A: saloon, players 1 and 2
  Scene B: mine, player 3
  Scene C: road ambush, players 4 and 5
```

Each scene can have its own narrator turns, but all meaningful changes commit
back through controlled world events.

Recommended event log:

```text
PLAYER_DISCOVERED_PLACE
NPC_MOVED
NPC_KILLED
RELATIONSHIP_CHANGED
CLUE_REVEALED
FACTION_CLOCK_ADVANCED
WORLD_FACT_DISCOVERED
SCENE_OPENED
SCENE_CLOSED
```

The prose is the readable book. The event log is the simulation truth.

Conflict handling:

- Lock high-impact NPCs or places during active scenes.
- Use world-time windows.
- Queue global mutations through a World Director.
- Let local scenes run freely until they attempt a global change.
- Require reconciliation before committing contradictory canon.

---

## 8. Human Characters, NPCs, and Identity Opacity

The desired player experience is:

```text
Players interact with characters, not accounts.
```

A player should not know whether a character is:

- a human online,
- a human offline represented by an authorized proxy,
- or a pure NPC.

All three must pass through the same visible interface:

```text
User input
  -> scene intent
  -> character response source
  -> narrator dramatization
  -> archivist/state commit
```

Internal response sources:

```text
Human online
  owner supplies intent

Human offline
  proxy agent supplies bounded intent from that character profile

NPC
  NPC agent supplies intent
```

The narrator is always the visible speaker. Humans and agents are hidden intent
providers.

Identity opacity requirements:

- No online indicators on characters.
- No player usernames attached to characters in-world.
- No different UI for NPCs and player characters.
- No "waiting for Bob" text.
- No visible typing indicators unless all character types use the same diegetic delay.
- No metadata leaks in notifications, logs, inspect panels, or APIs.
- Character sheets reveal only in-world facts, never controller type.

Core invariant:

```text
No scene renderer may reveal controller type.
```

---

## 9. Player Character Proxy and Agency

The narrator may portray another user's character only inside boundaries the
owning player has authorized.

Control modes:

```text
Manual
  Owner must respond directly.

Proxy-light
  System may handle greetings, small talk, routine refusals, basic factual answers.

Proxy-full
  System may roleplay within standing instructions, but cannot make major commitments.

Unavailable
  Character is present but non-participatory, distracted, asleep, traveling, etc.
```

Each player character needs standing proxy instructions:

```text
voice / style
boundaries
relationships
secrets they protect
goals
things they would never do
auto-response preferences
combat/social risk tolerance
```

Risk classification:

```text
Green: automatic
- greetings
- tone-consistent small talk
- answering public facts
- routine refusals
- noncommittal reactions

Yellow: allowed only if user opted in
- sharing minor private info
- agreeing to meet
- lending small help
- mild emotional vulnerability

Red: owner approval required
- romance/sexual content
- violence
- betrayal
- revealing secrets
- accepting major quests
- spending scarce resources
- changing faction allegiance
- leaving a scene under pressure
- death, injury, capture, permanent consequences
```

If a player is offline and another character addresses them, the proxy may answer
green or permitted yellow moves. For red moves, it should deflect diegetically and
notify the owner.

Example:

```text
Alice asks Marcus: "Why did you lie about the mine?"

Offline proxy-safe answer:
Marcus admits he lied, but refuses to say who told him to.

Red-zone deflection:
Marcus's face closes. "Not here."
```

Possible data model:

```text
player_characters
  user_id, character_id, control_mode

character_proxy_profiles
  character_id, voice, boundaries_json, goals_json, auto_response_rules_json,
  forbidden_actions_json, risk_tolerance

scene_participants
  scene_id, character_id, user_id, presence_status, last_seen_at

player_intents
  scene_id, user_id, character_id, raw_input, parsed_intent, status

proxy_decisions
  character_id, source_intent_id, generated_response, risk_level,
  approval_status

notifications
  user_id, type, scene_id, payload
```

Player consent requirement:

```text
Your character may be encountered while you are offline.
The system may portray your character within configured boundaries.
Other players will not be told whether a character is human-controlled or AI-controlled.
High-impact decisions require your approval unless you opt in.
```

---

## 10. Online and Async Scene Handling

When both users are online, the narrator should mediate rather than invent both
sides from scratch.

Flow:

```text
Alice intent:
  "I ask Marcus why he lied."

Bob receives addressed prompt:
  Alice is confronting Marcus. How does Marcus respond?

Bob intent:
  "Marcus admits he withheld part of it, but not the reason."

Narrator renders:
  Alice steps close...
  Marcus answers...
```

For simultaneous input, use a scene queue:

```text
Scene Turn 42
- Alice intent submitted
- Bob intent submitted
- NPC sheriff intent submitted
- narrator resolves order and renders one scene beat
```

Resolution modes:

- Real-time-ish: 30-90 second action windows, or resolve when all active
  participants have acted.
- Async: resolve whenever a user acts, proxying absent participants inside their
  permissions.

The system should never expose whether a delay was caused by a human, proxy, or
NPC agent. If delays are visible, make them diegetic and uniform across character
types.

---

## 11. User Playstyle and Preference Profiles

The system should build a profile, but it should be a **playstyle and preference
profile**, not a psychological dossier.

Useful signals:

```text
likes investigation
follows NPC relationships closely
avoids combat unless cornered
responds to moral ambiguity
tests authority
prefers slow-burn mystery over immediate action
dislikes being railroaded
```

Separate three profile types:

```text
User Profile
  cross-world play preferences and boundaries

Player Character Profile
  what this specific character knows, wants, fears, owns, and has done

World Relationship Profile
  how this character is perceived by NPCs and factions in this world
```

The existing `player-profile.ts` organizes character facts such as gear,
condition, people, discoveries, and commitments. That is useful, but it is not a
user preference model.

Future profile categories:

```text
Explicit preferences
  tone, pacing, content boundaries, desired themes

Observed playstyle
  investigates, fights, negotiates, explores, socializes, trades, deceives

Narrative appetite
  mystery, danger, romance, politics, horror, comedy, survival, spectacle

Agency preference
  open-ended exploration vs clear objectives

Social behavior
  trusts NPCs, tests NPCs, protects others, manipulates, avoids groups

Risk tolerance
  accepts danger, avoids irreversible consequences, pushes forbidden doors

Engagement signals
  hooks pursued, ignored, abandoned, revisited
```

Possible schema concepts:

```text
user_play_profiles
  user_id
  explicit_preferences_json
  inferred_preferences_json
  content_boundaries_json
  pacing_preference
  agency_preference
  updated_at

playstyle_observations
  user_id
  world_id
  character_id
  signal_type
  signal_value
  confidence
  source_turn_id
  created_at
```

Example observation:

```json
{
  "signal_type": "hook_affinity",
  "signal_value": "investigation",
  "confidence": 0.82,
  "source": "pursued clues across 5 turns"
}
```

Rules:

- Store game-relevant preferences, not real-world psychological claims.
- Avoid inferring sensitive traits.
- Let users inspect and edit explicit preferences.
- Separate "the user likes this" from "the character did this."
- Do not use the profile to remove surprises or feed only comfort zones.
- Use the profile to create better pressure, not easier outcomes.

Invariant:

```text
Learn what makes play better.
Do not pretend to know who the person really is.
```

---

## 12. AI Agent Roles

The long-term system likely needs several specialized AI roles:

```text
World Designer
  creates template canon

Cartographer
  creates geography, landmarks, routes, visibility, and map layout

Casting Director
  creates NPCs, relationships, secrets, routines, and voice profiles

World Simmer
  advances pre-player NPC/faction activity

NPC Agent
  decides important NPC behavior during play

Player Proxy Agent
  supplies bounded intent for offline player characters

Narrator
  renders a local scene as prose

Archivist
  extracts state changes from narration

World Director
  approves, rejects, queues, or reconciles global consequences
```

The World Director is the multiplayer pressure valve. It prevents separate local
narrators from independently mutating shared canon into contradiction.

---

## 13. Scale Tiers and Historical Mega-Parks

The first shared park should probably be small: one town, one valley, one station,
or one tightly bounded district. That is the right place to prove:

- structured geography,
- NPC routines,
- shared canon,
- identity opacity,
- event logs,
- scene queues,
- and controlled global consequences.

But the architecture should not assume all parks are town-sized. Larger parks,
such as a historical fiction world set in Europe during the 1st century AD, need
a different scaling strategy.

The rule for large parks:

```text
Generate local detail on demand.
Simulate large forces abstractly.
Propagate consequences through routes, offices, factions, and time.
```

Do not generate 1st-century Europe in exhaustive detail. Seed it hierarchically:

```text
Empire Layer
  emperor, senate, major wars, laws, grain, treasury, succession pressure

Province Layer
  governors, legions, local elites, tax pressure, unrest, client rulers

Route Layer
  roads, ports, rivers, military roads, courier/travel times

Local Layer
  city, villa, frontier fort, market, shrine, tavern, household

Scene Layer
  current room, present NPCs, immediate tension
```

Only render detailed places where players or major NPCs are active. Every local
detail inherits constraints from the layers above.

For historical parks, split canon into two classes:

```text
Historical Canon
  sourced or curated real facts:
  geography, emperors, provinces, legions, offices, known events

Fictional Overlay
  generated NPCs, intrigues, invented towns, local scandals, secret societies
```

The fictional overlay can bend around history, but should not casually contradict
it. A Roman park should be anchored to a specific start date and region, not the
entire 1st century in the abstract. For example:

```text
Rome and the western provinces in AD 60 under Nero
```

That gives the system concrete constraints: which provinces exist, which frontiers
matter, which legions are stationed where, and what political pressure is already
in the air.

### Event Propagation

Large parks need consequences that travel. One user's action in the Roman Senate
should not instantly rewrite every frontier scene, but it should create downstream
effects that arrive through plausible channels.

Example event:

```text
SENATE_SCANDAL
  location: Rome
  date: AD 60, March
  actors: Senator A, Senator B, player character
  effect_tags: succession, grain, military_funding, provincial_governance
  severity: high
```

Propagation channels:

```text
Official edict
  Rome -> provincial capitals by courier

Rumor
  Rome -> ports -> merchants -> cities

Military orders
  Rome -> legates -> frontier forts

Economic pressure
  treasury / grain policy -> tax contractors -> local markets
```

Each channel has latency and distortion. A player in Rome sees consequences
immediately. A player on the Rhine frontier may hear a garbled rumor weeks later.
A governor in Hispania may receive an official letter later still.

Possible schema concept:

```text
regional_impacts
  event_id
  target_region_id
  arrives_at_world_time
  channel
  public_summary
  private_directives_json
  severity
  status
```

When another user is in a province, the narrator state includes only arrived,
locally relevant impacts:

```text
RECENT IMPERIAL PRESSURE
- A courier from Rome arrived three days ago.
- The governor has been ordered to review grain contracts.
- Local merchants believe a senator's faction is falling.
```

This makes the world feel connected without simulating every village.

### Factions and Offices

For large historical parks, do not model every individual. Model powers,
institutions, and offices:

```text
Emperor / imperial household
Senate factions
Praetorian Guard
Provincial governors
Legions
Tax contractors
Local aristocracies
Client kings
Tribal confederations
Merchant networks
Religious cults
```

Each should have:

```text
resources
goals
fears
current pressure
relationships
regional influence
active clocks
response policy
```

Then run faction ticks:

```text
If a Senate scandal weakens faction X:
  governor aligned with X becomes cautious
  rival faction pushes accusations
  tax collectors delay payments
  frontier commander lacks funding
  local rebels sense opportunity
```

The large-park architecture becomes:

```text
World Event Bus
  records meaningful events

Impact Classifier
  decides which regions and factions care

Propagation Engine
  applies route, distance, channel, delay, and distortion

Faction Simulator
  updates faction clocks and responses

Regional Context Assembler
  injects locally relevant consequences into narrator state
```

The town-scale park and Roman-scale park are not different products. They are
different scale settings over the same core model:

```text
Town park
  most consequences propagate through direct witnesses, gossip, local NPCs,
  and a few institutions.

Imperial park
  consequences propagate through offices, roads, ports, factions, legions,
  governors, couriers, rumor networks, and time.
```

The first park should keep the surface small, but the underlying event and
context model should be compatible with later large parks.

---

## 14. Practical MVP Sequence

Do not try to build the full park simulation at once. A staged path:

1. **Single shared world template**
   One carefully seeded town/park with structured places, landmarks, NPCs, and
   story threads.

2. **Per-user player characters**
   Multiple users can exist in the same world, initially in separate scenes.

3. **Shared geography and NPC canon**
   Everyone sees the same town, same NPCs, same landmarks, same discovered facts.

4. **World event log**
   Every meaningful change becomes a structured event.

5. **Limited global consequences**
   Only selected actions affect shared canon at first: discovering places,
   updating NPC state, resolving story threads.

6. **Scene/party multiplayer**
   Allow multiple users in the same scene with scene queues and intent windows.

7. **Offline player-character proxy**
   Let other players interact with absent player characters inside authorized
   proxy boundaries.

8. **Identity opacity**
   Remove all player/NPC control-source leakage from UI, logs, and narration.

9. **Autonomous world clock**
   Let NPCs and factions advance between player actions through controlled jobs.

10. **Visual map**
    Render structured geography as a map with fog, discoveries, and stable
    landmark views.

11. **Scale-tier hooks**
    Keep world events tagged with affected places, factions, regions, routes,
    and severity so a later propagation engine can reuse the same event stream.

12. **Large-park prototype**
    After the town park works, test a constrained historical park with one city,
    one province, one frontier route, and a small set of abstracted factions.

---

## 15. Hard Invariants

These are the principles that should survive implementation changes:

```text
Public players interact with characters, not accounts.
```

```text
World is the primary player-facing container.
Park is an internal simulation-design metaphor.
Story is the emergent record.
Adventure is a bounded arc inside a world.
```

```text
Controller type is private implementation detail.
```

```text
The database is the source of world truth; narration is the dramatic rendering.
```

```text
Fictional geography must be structured canon before it becomes prose.
```

```text
AI seeding should create unresolved pressure, not solved lore.
```

```text
Offline player-character proxy must be consented, bounded, and risk-gated.
```

```text
Global consequences require reconciliation before becoming shared canon.
```

```text
User profiling should improve play, not infer real-world psychology.
```

```text
The narrator may render a character's surface behavior when authorized.
It should not own that character's will.
```

```text
Small parks and large parks should share the same event model.
Scale changes propagation, not the core truth system.
```

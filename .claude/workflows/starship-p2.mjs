export const meta = {
  name: 'starship-p2',
  description: 'Implement P2 deterministic forward sim: sim-clock, drift trigger, setPlace/setWorldTime write surface, SimulateWorldForward use case + offline proof',
  phases: [
    { title: 'SimCore', detail: 'sim-clock service, coLocationOutcome, setPlace/setWorldTime adapters' },
    { title: 'UseCase', detail: 'SimulateWorldForward loop + fake-port unit test' },
    { title: 'WireAndScript', detail: 'sim-ship.mjs: seed (stub) + sim 24 ticks against temp DB' },
    { title: 'Verify', detail: 'type-check + depcruise + full vitest + sim proof, bounded repair' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are implementing P2 (deterministic forward simulation) of the bounded "starship"
feature in chronicles-ai, an onion-architecture Next.js app. Working dir: ${SERVER}
(src paths are packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/starship-bounded-world-plan.md — the section "P2 implementation
  spec (deterministic forward sim — binding)" fixes every decision. Follow it exactly.
- ${ROOT}/CLAUDE.md — architecture + style.
Read the actual files you edit before editing.

P0+P1 ALREADY EXIST (built + committed). Relevant existing pieces — read them for exact
signatures before calling them:
- domain/services/npc-movement.ts → nextPlaceId({ dailyLoop: ResolvedDailyLoop | null,
  band: WorldTimeBand, currentPlaceId: number | null, neighborsOf: (id)=>number[] }).
  ResolvedDailyLoop = Partial<Record<WorldTimeBand, number | null>> (band → place id).
- domain/services/colocation.ts → groupByPlace / coLocatedGroups(positions) (>=2 occupants).
- domain/services/relationship-drift.ts → driftFromOutcome(outcome)/applyDrift(rel, delta),
  BeatOutcome = 'positive'|'negative'|'neutral'. (You ADD coLocationOutcome here in P2.)
- domain/services/deck-graph.ts → buildDeckGraph(connections)/neighbors(graph, id).
- domain/services/world-clock.ts → WorldTimeBand type + worldTimeBand(). The four bands
  are morning/midday/evening/night.
- ports: place-connection-repository (forWorld), relationship-repository (forWorld +
  adjustValence(id, delta) — DELTA-based, clamping is the caller's concern),
  character-repository (forWorld/inPlace/add — you ADD setPlace), world-repository
  (you ADD setWorldTime). Character rows carry daily_loop as JSON text written by P1's
  SeedBoundedWorld as Record<band, { activity, place_id }> — the sim parses + projects it
  to ResolvedDailyLoop (band → place_id).
- application/use-cases/seed-bounded-world.ts and scripts/seed-ship.mjs are the patterns to
  mirror for the new use case + offline script (read them).

ONION RULES (CI-enforced — violations fail the build):
- domain/ imports nothing outward. application/use-cases import only domain/ (NO lib/, NO
  SQL/SDK). adapters import inward only. Wiring only in composition/container.ts.
- better-sqlite3 only under persistence/sqlite/; mongoose only under persistence/mongo/.

CODE STYLE: 2-space, single quotes, NO semicolons, trailing commas multiline, named
imports alphabetized, explicit return types on exports, camelCase/PascalCase. Match siblings.

VERIFY locally (cd ${SERVER}): npm run type-check, npm run depcruise. Single test without
the depcruise pretest: npx vitest run <path> --root ${SERVER}. Make real edits.
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'testsPass', 'simProved', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    simProved: {
      type: 'boolean',
      description: 'Whether scripts/sim-ship.mjs ran, advanced the clock, and ended NPCs at routine-correct rooms',
    },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
phase('SimCore')

const s1 = await agent(
  `${RULES}

STAGE 1 — sim core + write surface (per the plan's P2 spec). Implement ALL:

1) NEW pure service domain/services/sim-clock.ts:
   - tickToBand(tick: number): WorldTimeBand — cycles morning→midday→evening→night
     (tick 0 = morning). Import WorldTimeBand from world-clock.
   - tickToWorldTime(tick: number, startDay?: number): string — e.g. 'Day 1 — morning',
     advancing the day every 4 ticks (startDay defaults to 1).
   Add a colocated test file: band cycling, day rollover at tick 4/8, startDay offset.

2) ADD to domain/services/relationship-drift.ts:
   coLocationOutcome(valence: number): BeatOutcome — valence >= 0 → 'positive', else
   'negative'. Extend that service's existing test file with cases.

3) Write surface (port + SQLite adapter + Mongo adapter each):
   - CharacterRepository.setPlace(characterId: number, placeId: number | null): Promise<void>
     (UPDATE characters SET current_place_id = ? ...). Delegate via lib/db like sibling
     character writes if that is the existing pattern, else implement in the adapter.
   - WorldRepository.setWorldTime(worldId: number, worldTime: string): Promise<void>
     (UPDATE worlds SET world_time = ? WHERE id = ?). There is already a cursor setter in
     lib/worlds.ts — add a minimal world_time-only setter beside it and delegate.
   Add focused SQLite-adapter tests (in-memory DB, migrations run — copy an existing adapter
   test's setup): setPlace round-trips current_place_id; setWorldTime updates world_time.

Run type-check + depcruise + your new tests. Do NOT touch container.ts or write the use case
yet. Return every new/changed signature, files changed, and local gate results.`,
  { label: 'P2: sim-clock + drift + write surface', phase: 'SimCore' },
)

// ---------------------------------------------------------------------------
phase('UseCase')

const s2 = await agent(
  `${RULES}

Stage 1 (sim core + write surface) is done. Its report:
---
${s1}
---

STAGE 2 — the SimulateWorldForward use case (application/use-cases/simulate-world-forward.ts),
per the plan's P2 spec. PURE orchestration — deps injected, no SQL/SDK/lib imports.

Deps: { characters: CharacterRepository, placeConnections: PlaceConnectionRepository,
relationships: RelationshipRepository, clock: Clock }.
Input: { worldId: number, ticks: number }.

Flow:
- Load NPCs via characters.forWorld(worldId), keep only is_player === 0 (or 0/false per the
  Character type). For each, parse its daily_loop JSON text (Record<band,{activity,place_id}>)
  into a ResolvedDailyLoop (band → place_id); tolerate null/missing/malformed daily_loop
  (treat as empty loop → the NPC stays put).
- Build the graph: placeConnections.forWorld(worldId) → buildDeckGraph → neighborsOf(id) =
  neighbors(graph, id).
- Load relationships.forWorld(worldId) into a mutable working copy (Map by id), remember each
  original valence.
- Maintain in-memory positions (Map characterId → placeId|null) seeded from current_place_id.
- Loop tick 0..ticks-1: band = tickToBand(tick); for each NPC set positions[id] =
  nextPlaceId({ dailyLoop, band, currentPlaceId: positions[id], neighborsOf }); compute
  coLocatedGroups from positions; for every relationship whose from AND to are both in the
  same co-located group, working = applyDrift(working, driftFromOutcome(coLocationOutcome(
  working.valence))).
- Persist ONCE at the end (compact): characters.setPlace(id, finalPlace) per NPC;
  for each relationship whose working.valence !== original, relationships.adjustValence(id,
  working.valence - original); worlds? NO — world time is set via the WorldRepository.
  Wait: deps has no worlds. ADD worlds: WorldRepository to deps and call
  worlds.setWorldTime(worldId, tickToWorldTime(ticks)).
- Return { ticks, finalPositions: Array<{ characterId, placeId }>, drifted: Array<{
  relationshipId, from, to, valence }> }.

TEST with IN-MEMORY FAKE ports (plain objects recording calls): seed a tiny 3-room line graph,
2-3 NPCs with daily loops that send them to specific rooms per band, and a relationship between
two who co-locate; run e.g. 8 ticks; assert final positions match the routine for the final
band, setPlace was called with those, the co-located allies' valence drifted positive (and was
persisted via adjustValence), and setWorldTime got the right label. Also assert an NPC with a
null/malformed daily_loop stays at its start room.

Run type-check + depcruise + your test. Do NOT touch container.ts yet.
Return the use-case signature + deps, files changed, gate results.`,
  { label: 'P2: SimulateWorldForward use case', phase: 'UseCase' },
)

// ---------------------------------------------------------------------------
phase('WireAndScript')

const s3 = await agent(
  `${RULES}

Stages 1-2 are done. Stage 2 report:
---
${s2}
---

STAGE 3 — the offline sim proof. (No container changes needed unless the use case requires a
new adapter not already wired; SimulateWorldForward is built from existing repos — confirm and
only touch container.ts if genuinely required.)

Create scripts/sim-ship.mjs, mirroring scripts/seed-ship.mjs (same temp-DB-before-import
pattern, same --conditions=react-server --tsconfig invocation — copy its header EXACTLY incl.
the --tsconfig flag):
- point at a fresh temp DB, build the SQLite container, seed a scout via SeedBoundedWorld with
  the StubCrewGenerator,
- construct SimulateWorldForward from the container parts and run it for 24 ticks,
- read back via the repos and PRINT: world time after the run, each NPC's final room, and the
  relationship valences (before → after),
- ASSERT (exit non-zero on failure): the world time advanced past the start; every NPC's final
  room equals what its daily_loop assigns for tickToBand(24); at least one relationship valence
  changed from co-location drift. End with a clear "OK: simulated N ticks; crew ended on routine"
  line.

RUN it (npx tsx --conditions=react-server --tsconfig packages/server/tsconfig.json
packages/server/scripts/sim-ship.mjs) and confirm the OK line. Fix root causes if it fails.

Return: whether the OK line printed (quote it), the final world time, files changed, gate results.`,
  { label: 'P2: sim-ship script', phase: 'WireAndScript' },
)

log(`Sim script stage: ${s3.slice(0, 240)}`)

// ---------------------------------------------------------------------------
phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.testsPass && v.simProved
}

const verifyPrompt = `${RULES}

STAGE 4 — full verification gate. In order (cd ${SERVER}, repo root for the script):
1) npm run type-check
2) npm run depcruise
3) npm test  (full Vitest incl. the new P2 sim-clock/use-case/adapter tests)
4) Re-run the sim proof: npx tsx --conditions=react-server --tsconfig
   packages/server/tsconfig.json packages/server/scripts/sim-ship.mjs against a fresh temp DB,
   and confirm the "OK: simulated ... crew ended on routine" line.

If anything fails, fix ONLY genuine issues you introduced (no weakening tests, no suppressing
depcruise). Re-run the failing gate. Report honestly — simProved only true if you saw the OK
line this run.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify P2', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

The P2 verification gate is failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE of each (no weakening tests, no suppressing depcruise). Re-run the affected
gate (and the sim script if relevant). Report what you changed.`,
    { label: `P2 repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify P2 #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`P2 final gate: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} tests=${verify.testsPass} sim=${verify.simProved}`)
return verify

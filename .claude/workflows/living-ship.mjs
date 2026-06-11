export const meta = {
  name: 'living-ship',
  description: 'During-play "living tick" for bounded worlds: every off-scene crew member moves on their routine + gated off-screen beats, each player turn',
  phases: [
    { title: 'UseCase', detail: 'tick-living-world use case (reuse pre-play sim services) + timeline read for sim-tick/recent + unit test' },
    { title: 'Integrate', detail: 'narrate-turn runs the living tick post-stream (bounded only, fail-open) + surfaces recent off-screen beats to the narrator' },
    { title: 'Verify', detail: 'npm test (byte-green) + test:mongo + an offline proof that crew move + a beat fires across living ticks' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are building the during-play "living tick" for bounded "starship" worlds in chronicles-ai
(onion-architecture Next.js). Working dir: ${SERVER} (src paths are packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/starship-bounded-world-plan.md — the section "P5 (during play): the ship
  stays alive — a per-turn 'living tick'". Follow it exactly.
- ${ROOT}/CLAUDE.md.
Read the files you edit.

WHY: the forward sim ran only PRE-boarding; during play off-scene crew freeze (the turn pipeline
skips off-scene looped NPCs — an open-world optimization). On a sealed 6-room ship ALL crew should
stay active every turn. This per-turn living tick reuses the pre-play sim machinery.

REUSE (do NOT reinvent) — these already exist:
- domain/services: npc-movement.nextPlaceId, colocation.coLocatedGroups, beat-gating.shouldEmitBeat,
  relationship-drift.{applyDrift,driftFromOutcome,coLocationOutcome}, deck-graph.{buildDeckGraph,neighbors},
  world-clock.worldTimeBand.
- application/use-cases/simulate-world-forward.ts — the PRE-play sim; the new use case mirrors its
  per-tick body but (a) drives the band off the LIVE world clock, (b) processes only OFF-scene crew,
  (c) runs exactly ONE tick. Read it for the parseDailyLoop helper + the beat/drift wiring.
- ports: characters (forWorld, setPlace), placeConnections (forWorld), relationships (forWorld,
  adjustValence), worlds (cursor, getWorld), places (forWorld), drama (DramaPort), timeline (TimelineWriter).

ONION RULES (CI-enforced): domain imports nothing outward; application imports only domain/; adapters
import inward only; wiring only in composition. CODE STYLE: 2-space, single quotes, no semicolons,
explicit return types, alphabetized imports. Match siblings. SQLite must stay BYTE-GREEN (adapters
delegate); new behavior is additive (a new post-stream task), guarded to bounded worlds.

VERIFY (cd ${SERVER}): npm run type-check, npm run depcruise, npm test, 'npm run test:mongo' (root).
`

phase('UseCase')

const s1 = await agent(
  `${RULES}

STAGE 1 — the use case + the timeline read it needs.

1) Timeline READ: add a read for recent + max sim-tick of provenance='sim' timeline events. Either
   extend the existing dossier/timeline read port or add a small method (e.g. DossierRepository or a
   TimelineReader): recentSimEvents(worldId, limit) returning the latest provenance='sim' events
   (newest first) AND a way to get the current max sim_tick. Add it to the port + BOTH adapters
   (SQLite delegates to a lib/db query mirroring existing timeline reads; Mongo reads the collection).

2) application/use-cases/tick-living-world.ts: tickLivingWorld({ worldId, playerPlaceId }, deps).
   PURE orchestration (deps injected). Deps: characters, placeConnections, relationships, worlds,
   places, drama, timeline (+ the recentSimEvents/maxSimTick read), clock; optional config
   { cooldownTicks=2, tensionThreshold=0.25 }.
   Flow (ONE tick, off-scene crew only):
   - world = worlds.getWorld(worldId); cursor = worlds.cursor(worldId); band = worldTimeBand(world_time
     from cursor/world). nextTick = (max existing sim_tick for the world) + 1.
   - Load NPCs (characters.forWorld, is_player===0), parse daily_loop → ResolvedDailyLoop (mirror
     simulate-world-forward.parseDailyLoop). Build the deck graph from placeConnections.forWorld.
     Load relationships into a mutable working copy (remember original valence).
   - OFF-SCENE = NPCs whose current_place_id !== playerPlaceId. For EACH off-scene NPC (NO skip —
     all of them): next = nextPlaceId({ dailyLoop, band, currentPlaceId, neighborsOf }); if changed,
     characters.setPlace(id, next); track in-memory positions.
   - coLocatedGroups over the OFF-scene NPC positions. For each group: shouldEmitBeat({ characterIds,
     relationships-in-group, currentTick: nextTick, lastBeatTick: per-place last sim beat tick (from
     recent sim events) , cooldownTicks, tensionThreshold }); if gated -> drama.generateBeat(
     DramaBeatInput with recentBeats from recentSimEvents) -> timeline.append({ provenance:'sim',
     sim_tick: nextTick, world_time, place_id, title, summary, ... }) -> apply valenceDeltas to working
     relationships. Else: deterministic co-location drift for the group (as in the pre-play sim).
   - Persist drifted relationships via relationships.adjustValence(id, working - original).
   - Return { movedCount, beatsWritten, finalPositions }.

   Do NOT move crew who are present with the player (current_place_id === playerPlaceId) — they are the
   narrator/archivist's job.

UNIT TEST with in-memory fake ports: a 3-room line graph, the player in room A, two off-scene NPCs
whose loops put them in room B at the current band; assert they move to B (setPlace called), the
present-with-player NPC is NOT moved, and (with a tension relationship + cooldown satisfied) a beat is
generated + a provenance='sim' timeline event appended; assert an NPC already at its band target stays.

Run type-check + depcruise + your test. Do NOT touch narrate-turn yet. Return the use-case signature +
deps, the timeline read added, files changed, gate results.`,
  { label: 'living: tick-living-world use case', phase: 'UseCase' },
)

phase('Integrate')

const s2 = await agent(
  `${RULES}

Stage 1 done. Report:
---
${s1}
---

STAGE 2 — integrate into the turn pipeline.

1) infrastructure/narrator/narrate-turn.ts: in the POST-STREAM section (alongside the other
   best-effort enrichers — occupancy/npc-agent/reverie), when the world is BOUNDED
   (world.spatial_mode === 'bounded'), build tickLivingWorld's deps from getContainer() and call it
   with the player's current place id (the player character's current_place_id). FAIL-OPEN:
   .catch(console.error) and continue (never block the turn). Do NOT run it for open worlds.
2) Surface off-screen life to the narrator: in narrate-turn's PRE-stream context assembly, for bounded
   worlds, read timeline.recentSimEvents(worldId, 2) and include them in the narrator context (a short
   "OFF-SCREEN (elsewhere on the ship):" block appended to the state/context the narrator prompt gets),
   so the narrator can reference what the rest of the crew have been doing. Keep it small + bounded.
   (This turn shows beats from PRIOR living ticks; this turn's tick runs post-stream — a natural 1-turn
   lag.) If the narrator prompt is assembled by a formatter, add the block there guarded to bounded.

Run type-check + depcruise + 'npm test' (byte-green: open-world turns unchanged) + 'npm run test:mongo'.
Return files changed + where exactly the tick runs + how beats reach the narrator + gate results.`,
  { label: 'living: integrate into narrate-turn', phase: 'Integrate' },
)

log(`Integrate: ${s2.slice(0, 200)}`)

phase('Verify')

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'sqliteTestsPass', 'mongoTestsPass', 'livingProved', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    sqliteTestsPass: { type: 'boolean', description: 'npm test byte-green (open-world turns unchanged)' },
    mongoTestsPass: { type: 'boolean' },
    livingProved: { type: 'boolean', description: 'an offline proof shows off-scene crew MOVE across living ticks and a beat fires' },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.sqliteTestsPass && v.mongoTestsPass && v.livingProved
}

const verifyPrompt = `${RULES}

STAGE 3 — verification. Write scripts/living-ship.mjs (mirror scripts/sim-ship.mjs's temp-DB +
--conditions=react-server --tsconfig invocation, StubCrewGenerator + StubDramaPort, no spend): seed a
scout, set the player in one room, then call tickLivingWorld several times (advancing/keeping the band)
and PRINT off-scene crew positions before/after + the sim beats written; ASSERT (exit non-zero on
failure) that at least one off-scene crew member MOVED toward its routine room and at least one beat
fired, and that a crew member co-located with the player was NOT force-moved. End with an OK line.

Then run the gates (cd ${SERVER}; root for the rest):
1) npm run type-check
2) npm run depcruise
3) npm test            — SQLite byte-green (open-world turns must be unchanged)
4) npm run test:mongo
5) the living-ship script -> OK line.

Fix ONLY genuine issues introduced (no weakening tests, no suppressing depcruise; SQLite byte-identical).
Report honestly per-gate; livingProved only true if you saw the script's OK line this run.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify living', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

Living-ship gate failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE (no weakening tests; SQLite byte-identical). Re-run the affected gate. Report.`,
    { label: `living repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify living #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`living final: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} sqlite=${verify.sqliteTestsPass} mongo=${verify.mongoTestsPass} proved=${verify.livingProved}`)
return verify

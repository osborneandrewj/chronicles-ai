export const meta = {
  name: 'starship-p3',
  description: 'Implement P3 threshold-gated LLM beats: Haiku DramaPort + Stub, TimelineWriter adapters, beat integration into SimulateWorldForward + offline proof',
  phases: [
    { title: 'BeatAdapters', detail: 'HaikuDramaPort + StubDramaPort + prompt; TimelineWriter SQLite/Mongo' },
    { title: 'Integrate', detail: 'beats into SimulateWorldForward loop + fake-port unit test' },
    { title: 'WireAndScript', detail: 'container wiring + sim-ship.mjs shows/asserts beats' },
    { title: 'Verify', detail: 'type-check + depcruise + full vitest + beat proof, bounded repair' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are implementing P3 (threshold-gated LLM "beats") of the bounded "starship" feature
in chronicles-ai, an onion-architecture Next.js app. Working dir: ${SERVER} (src paths are
packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/starship-bounded-world-plan.md — the section "P3 implementation spec
  (threshold-gated LLM beats — binding)" fixes every decision. Follow it exactly.
- ${ROOT}/CLAUDE.md — architecture + style.
Read the actual files you edit before editing.

P0+P1+P2 ALREADY EXIST (built + committed). Relevant existing pieces — read for exact shapes:
- domain/ports/drama-port.ts → DramaPort.generateBeat(input: DramaBeatInput): Promise<DramaBeat>.
  DramaBeatInput { world_id, sim_tick, world_time, place_id, place_name, participants:
  DramaParticipant[] {character_id,name,role,goal}, relationships: CharacterRelationship[],
  threads: string[] }. DramaBeat { title, summary, participant_ids, valenceDeltas:
  {from_character_id,to_character_id,delta}[] }.
- domain/ports/timeline-writer.ts → TimelineWriter.append(event: TimelineEventInput) where
  TimelineEventInput { world_id, turn_id, thread_id, world_time, title, summary, importance,
  sim_tick, provenance }.
- domain/services/beat-gating.ts → shouldEmitBeat({ characterIds, relationships, currentTick,
  lastBeatTick, cooldownTicks, tensionThreshold }): boolean.
- domain/services/relationship-drift.ts → applyDrift(rel, delta) (clamped).
- application/use-cases/simulate-world-forward.ts → the P2 use case you EXTEND (read it fully).
- infrastructure/world-gen/grok-crew-generator.ts + stub-crew-generator.ts → the adapter +
  stub PATTERN to mirror (generateObject, prompt loaded from prompts/, Zod, server-only).
- infrastructure/llm/model-registry.ts → HAIKU_MODEL = 'claude-haiku-4-5-20251001'. @ai-sdk/anthropic
  is the Haiku provider (see how lib/world-generator.ts or an existing Haiku call site uses it).
- The P1 characters.add stored each crew member's ROLE somewhere (it is not a dedicated
  column) — find which field (e.g. current_focus / recent_activity) by reading the P1
  character add path, and read it back for DramaParticipant.role. goal = active_goal.
- scripts/sim-ship.mjs → the offline proof you extend.

ONION RULES (CI-enforced): domain/ imports nothing outward; application/use-cases import only
domain/ (NO lib/, NO SQL/SDK); adapters import inward only; wiring only in container.ts.
better-sqlite3 only under persistence/sqlite/; mongoose only under persistence/mongo/; model
IDs only from infrastructure/llm/.

CODE STYLE: 2-space, single quotes, NO semicolons, trailing commas multiline, alphabetized
named imports, explicit return types on exports. Match siblings.

VERIFY locally (cd ${SERVER}): npm run type-check, npm run depcruise. Single test:
npx vitest run <path> --root ${SERVER}. Make real edits.
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'testsPass', 'beatsProved', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    beatsProved: {
      type: 'boolean',
      description: 'Whether sim-ship.mjs ran and showed >=1 provenance=sim timeline beat written',
    },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
phase('BeatAdapters')

const s1 = await agent(
  `${RULES}

STAGE 1 — the beat adapters (per the plan's P3 spec). Implement ALL:

1) HaikuDramaPort (infrastructure/world-gen/haiku-drama-port.ts) implementing DramaPort:
   - generateObject with HAIKU_MODEL via @ai-sdk/anthropic, system prompt loaded at runtime
     from a NEW prompts/drama-beat.md (git-diffable; mirror how grok-crew-generator loads
     prompts/crew-dressing.md), Zod schema matching DramaBeat (title/summary/participant_ids/
     valenceDeltas). Build the user prompt from DramaBeatInput (place, participants with
     role+goal, the relationships among them). The beat is a SHORT structured event summary
     (compact persistence — NOT full dialogue). server-only at top.
   - Constrain valenceDeltas to participants in the group; delta in a small range (e.g. -0.4..0.4).
2) StubDramaPort (infrastructure/world-gen/stub-drama-port.ts): deterministic DramaBeat from
   the input (e.g. title from place + participant names, one small positive valenceDelta
   between the first two participants). No LLM. server-only.
3) TimelineWriter SQLite adapter (infrastructure/persistence/sqlite/) + Mongo adapter
   (persistence/mongo/repositories/): append() INSERTs a timeline_events row (turn_id null,
   sim_tick set, provenance='sim'). Stamp created_at like sibling adapters. Read the
   timeline_events schema (migrations v11 + v28) for the exact columns.

TESTS: unit-test StubDramaPort (returns a valid DramaBeat with participant-scoped deltas) and
the TimelineWriter SQLite adapter (in-memory DB, migrations run; append writes a row readable
with provenance='sim' and the right sim_tick/world_time/title).

Run type-check + depcruise + your tests. Do NOT touch the use case or container yet.
Return new signatures, files changed, gate results.`,
  { label: 'P3: drama adapters + timeline writer', phase: 'BeatAdapters' },
)

// ---------------------------------------------------------------------------
phase('Integrate')

const s2 = await agent(
  `${RULES}

Stage 1 (beat adapters) is done. Its report:
---
${s1}
---

STAGE 2 — integrate gated beats into SimulateWorldForward
(application/use-cases/simulate-world-forward.ts), per the plan's P3 spec. Keep it PURE
orchestration (deps injected; no SQL/SDK/lib). Preserve all P2 behavior except where a beat
supersedes deterministic drift.

- Add deps: places: PlaceRepository, drama: DramaPort, timeline: TimelineWriter.
- Add input config (optional, with defaults): cooldownTicks = 3, tensionThreshold = 0.3.
- Load places.forWorld(worldId) → Map place_id → name. Enrich the NPC roster with name, role
  (from the field P1 stored it in — read the P1 character add path to find it), goal
  (active_goal). Keep the P2 daily_loop parsing.
- Track lastBeatTickByPlace: Map<number, number>.
- In the per-tick loop, for each co-located group (coLocatedGroups):
  * relationshipsInGroup = working relationships whose from AND to are both in the group.
  * if shouldEmitBeat({ characterIds: group.characterIds, relationships: relationshipsInGroup,
    currentTick: tick, lastBeatTick: lastBeatTickByPlace.get(placeId) ?? null, cooldownTicks,
    tensionThreshold }):
      - build DramaBeatInput (world_id, sim_tick: tick, world_time: tickToWorldTime(tick),
        place_id, place_name, participants from the group's NPCs {character_id,name,role,goal},
        relationships: relationshipsInGroup, threads: []),
      - beat = await drama.generateBeat(input),
      - await timeline.append({ world_id: worldId, turn_id: null, thread_id: null,
        world_time: tickToWorldTime(tick), title: beat.title, summary: beat.summary,
        importance: <a sensible small int>, sim_tick: tick, provenance: 'sim' }),
      - for each valenceDelta, find the working relationship edge matching (from,to) and
        applyDrift it; ignore deltas with no matching edge,
      - lastBeatTickByPlace.set(placeId, tick).
      (Do NOT also apply the deterministic co-location drift to this group this tick.)
  * else: apply the P2 deterministic co-location drift to this group's edges (unchanged).
- End-state persistence is unchanged from P2 (setPlace, adjustValence net deltas, setWorldTime).
  Add the beats count to the result.

UPDATE the existing tests/simulate-world-forward.test.ts: add fake DramaPort (records calls,
returns a canned beat with a valenceDelta) + fake TimelineWriter (records appends) to the fakes.
Add a test asserting: with cooldown/threshold set so a beat fires, drama.generateBeat is called,
a provenance='sim' timeline event is appended with the right sim_tick, the beat's valenceDelta
moved the relationship (and deterministic drift was NOT also applied that tick), and lastBeatTick
cooldown suppresses a second immediate beat in the same room. Keep the existing P2 assertions
passing (set threshold high / cooldown so the original test's scenario still behaves, or adjust
fakes deliberately — do NOT weaken the P2 movement/clock assertions).

Run type-check + depcruise + the use-case test. Do NOT touch container yet.
Return the new deps/config, files changed, gate results.`,
  { label: 'P3: integrate beats into sim', phase: 'Integrate' },
)

// ---------------------------------------------------------------------------
phase('WireAndScript')

const s3 = await agent(
  `${RULES}

Stages 1-2 done. Stage 2 report:
---
${s2}
---

STAGE 3 — wiring + the offline beat proof.

1) composition/container.ts: add drama (the REAL HaikuDramaPort) and timeline (the
   TimelineWriter SQLite/Mongo adapter) to the Container type + BOTH builders. Follow existing
   wiring. Keep type-check green.

2) Update scripts/sim-ship.mjs: construct SimulateWorldForward with the StubDramaPort + the
   real TimelineWriter (so it runs free + deterministic), set cooldownTicks/tensionThreshold so
   beats fire given the seeded ally tension, run 24 ticks, then read back timeline_events WHERE
   provenance='sim' and PRINT them (sim_tick, world_time, title). ASSERT (exit non-zero on
   failure) that >=1 sim beat was written. Keep the existing P2 assertions (positions/clock/drift).
   End with an "OK: simulated ... N beats" line.

3) RUN it (npx tsx --conditions=react-server --tsconfig packages/server/tsconfig.json
   packages/server/scripts/sim-ship.mjs) and confirm the OK line + that beats printed. Fix root
   causes if it fails.

Return whether beats printed (quote the OK line + a sample beat), files changed, gate results.`,
  { label: 'P3: wire + beat proof', phase: 'WireAndScript' },
)

log(`Beat script stage: ${s3.slice(0, 240)}`)

// ---------------------------------------------------------------------------
phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.testsPass && v.beatsProved
}

const verifyPrompt = `${RULES}

STAGE 4 — full verification gate. In order (cd ${SERVER}, repo root for the script):
1) npm run type-check
2) npm run depcruise
3) npm test  (full Vitest incl. new P3 adapter + updated use-case tests)
4) Re-run the beat proof: npx tsx --conditions=react-server --tsconfig
   packages/server/tsconfig.json packages/server/scripts/sim-ship.mjs against a fresh temp DB;
   confirm the OK line and that >=1 provenance=sim timeline beat printed.

Fix ONLY genuine issues you introduced (no weakening tests, no suppressing depcruise). Re-run
the failing gate. Report honestly — beatsProved only true if you saw beats written this run.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify P3', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

The P3 verification gate is failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE of each (no weakening tests, no suppressing depcruise). Re-run the affected
gate (and the sim script if relevant). Report what you changed.`,
    { label: `P3 repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify P3 #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`P3 final gate: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} tests=${verify.testsPass} beats=${verify.beatsProved}`)
return verify

export const meta = {
  name: 'ship-clock',
  description: 'Prose-driven ship-clock for bounded worlds: a Haiku reads the narration to estimate elapsed in-world time, advancing a narrative clock so the band shifts + crew circulate',
  phases: [
    { title: 'ClockCore', detail: 'migration v29 ship_clock_minutes + ship-clock render service + WorldRepository clock read/write + tests' },
    { title: 'Estimator', detail: 'TimePassageEstimator port + Haiku adapter + stub + prompt; narrate-turn integration + CreateStarshipWorld init' },
    { title: 'Verify', detail: 'npm test (byte-green) + test:mongo + offline proof that prose advances the clock + shifts the band' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are building the PROSE-DRIVEN ship-clock for bounded "starship" worlds in chronicles-ai
(onion-architecture Next.js). Working dir: ${SERVER} (src paths are packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/starship-bounded-world-plan.md — section "P6: the ship-clock — PROSE-DRIVEN
  narrative time (binding)". Follow it exactly.
- ${ROOT}/CLAUDE.md.
Read the files you edit.

INTENT (the user's steer): lean NARRATIVE, not simulation. Time flows from the STORY: a small
step reads the narration prose and estimates how much in-world time it covered; the clock advances
by THAT (not a fixed per-turn amount). Render time-of-day narratively ("Day 3 — early morning"),
not a minute readout. Keep this SEPARATE from the archivist (do not touch lib/archivist.ts or
apply-archivist-patch.ts time handling).

REUSE: domain/services/world-clock.ts (WorldTimeBand + worldTimeBand + bandForHour). The migration
pattern is in lib/migrations.ts (latest is v28; addColumnIfMissing helper exists). The Haiku adapter
pattern is infrastructure/world-gen/haiku-drama-port.ts (generateObject, HAIKU_MODEL via
@ai-sdk/anthropic, withObjectRetry, prompt loaded from prompts/*.md, server-only). Ports + BOTH
SQLite and Mongo adapters; SQLite stays BYTE-GREEN (delegate); Mongo via camelCase fields.

ONION RULES (CI-enforced) + CODE STYLE (2-space, single quotes, no semicolons, explicit return
types, alphabetized imports). Match siblings.

VERIFY (cd ${SERVER}): npm run type-check, npm run depcruise, npm test, 'npm run test:mongo' (root).
`

phase('ClockCore')

const s1 = await agent(
  `${RULES}

STAGE 1 — the clock representation + render. Implement ALL:

1) Migration v29 'ship_clock_minutes' in lib/migrations.ts: addColumnIfMissing(worlds,
   'ship_clock_minutes', 'INTEGER'). Nullable (set for bounded worlds; null for open).
   Add the column to the World entity (domain/entities/world.ts) as ship_clock_minutes: number | null,
   the SQLite world read (lib/worlds.ts getWorld/createBounded SELECT/RETURN) AND the Mongo world
   model + mapWorld (shipClockMinutes <-> ship_clock_minutes). Keep getWorld byte-green for open
   worlds (null).

2) NEW pure service domain/services/ship-clock.ts:
   - minutesToShipTime(minutes: number): { worldTime: string; band: WorldTimeBand } — minutes since
     a Day-1 00:00 baseline → a NARRATIVE render. day = floor(minutes/1440)+1; hour = floor((minutes
     %1440)/60). band = bandForHour(hour) (import from world-clock). worldTime is a natural
     time-of-day phrase like 'Day 3 — early morning' / 'Day 3 — afternoon' / 'Day 3 — late night'.
     CRITICAL: the worldTime string MUST round-trip through worldTimeBand() back to the SAME band
     (the living tick parses world_time), so the phrase must contain a token worldTimeBand maps to
     that band (e.g. include the band word, or append a subtle '~HHMM'). Assert this round-trip in a test.
   - shipTimeToMinutes(worldTime: string | null): number — parse a 'Day N — ...(~HHMM)' string back
     to minutes (best-effort; default Day 1, midday if unparseable) for init/backfill.

3) WorldRepository: add setShipClockMinutes(worldId, minutes): Promise<void> (port + SQLite + Mongo).
   getWorld already returns the field. SQLite delegates to a lib/worlds setter.

TESTS: ship-clock unit test (render examples + the worldTimeBand round-trip + shipTimeToMinutes); a
SQLite adapter test that setShipClockMinutes round-trips via getWorld; and confirm an open world's
getWorld still returns ship_clock_minutes null (byte-green).

Run type-check + depcruise + 'npm test'. Return new signatures + files changed + gate results.`,
  { label: 'ship-clock: schema + render service', phase: 'ClockCore' },
)

phase('Estimator')

const s2 = await agent(
  `${RULES}

Stage 1 (clock core) done. Report:
---
${s1}
---

STAGE 2 — the prose estimator + integration.

1) Port domain/ports/time-passage-estimator.ts: estimate(input: { narration: string; priorWorldTime:
   string | null }): Promise<{ elapsedMinutes: number }>.
2) HaikuTimePassageEstimator (infrastructure/world-gen/): generateObject with HAIKU_MODEL via
   @ai-sdk/anthropic + withObjectRetry, Zod { elapsedMinutes: int, 0..2880 }, system prompt from a
   NEW prompts/time-passage.md. The prompt: read the narration; estimate how much IN-WORLD time it
   covered — a brief exchange ~2-5 min, an activity/meal/repair ~30-90, "later"/a watch change a few
   hours, sleep/"next morning" jump to that point. Lean toward time flowing naturally; never 0 for a
   real beat, never wildly long for a short exchange. server-only. Plus a deterministic
   StubTimePassageEstimator (e.g. a fixed small number) for tests/scripts.
3) Integration in infrastructure/narrator/narrate-turn.ts — bounded worlds, POST-stream, and BEFORE
   the living tick (so the tick sees the advanced band). FAIL-OPEN:
   - current = world.ship_clock_minutes ?? shipTimeToMinutes(world.world_time)  // backfill-on-null
   - elapsed = await estimator.estimate({ narration: trimmed, priorWorldTime: world.world_time })
   - next = current + elapsed; const { worldTime } = minutesToShipTime(next)
   - await worlds.setShipClockMinutes(worldId, next); await worlds.setWorldTime(worldId, worldTime)
   Build the estimator from getContainer(). Order it before the tickLivingWorld call.
4) CreateStarshipWorld (application/use-cases/create-starship-world.ts): after the sim, init
   ship_clock_minutes from the sim's final world_time via shipTimeToMinutes + setShipClockMinutes,
   so the boarding clock is seeded.
5) Wire the estimator into composition/container.ts + the Mongo builder (the real Haiku one).

TESTS: unit-test the Stub + that the estimator wires; an integration-ish assertion is fine via the
offline proof in Stage 3. Keep open-world turns byte-green (no estimator, no clock).

Run type-check + depcruise + 'npm test' + 'npm run test:mongo'. Return files changed + where the
clock advances + gate results.`,
  { label: 'ship-clock: estimator + integration', phase: 'Estimator' },
)

log(`Estimator: ${s2.slice(0, 200)}`)

phase('Verify')

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'sqliteTestsPass', 'mongoTestsPass', 'clockProved', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    sqliteTestsPass: { type: 'boolean', description: 'npm test byte-green (open worlds unchanged)' },
    mongoTestsPass: { type: 'boolean' },
    clockProved: { type: 'boolean', description: 'an offline proof shows estimated elapsed prose-time advancing the clock + shifting the band across several turns' },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.sqliteTestsPass && v.mongoTestsPass && v.clockProved
}

const verifyPrompt = `${RULES}

STAGE 3 — verification. Write scripts/ship-clock.mjs (mirror scripts/sim-ship.mjs's temp-DB +
--conditions=react-server --tsconfig invocation; StubTimePassageEstimator + StubDramaPort, no spend):
seed a scout, set ship_clock_minutes near a band boundary (e.g. late 'night'), then simulate a few
turns where the estimator returns a chunk of elapsed minutes each time; advance the clock via
minutesToShipTime + setWorldTime + setShipClockMinutes, and PRINT the world_time + band after each
step. ASSERT (exit non-zero on failure): the clock advances each step, the band SHIFTS across at
least one boundary (e.g. night -> morning), and minutesToShipTime's band matches worldTimeBand(the
rendered string). End with an OK line.

Then run the gates (cd ${SERVER}; root for the rest):
1) npm run type-check
2) npm run depcruise
3) npm test            — SQLite byte-green (open worlds unchanged)
4) npm run test:mongo
5) scripts/ship-clock.mjs -> OK line.

Fix ONLY genuine issues introduced (no weakening tests; SQLite byte-identical). Report honestly
per-gate; clockProved only true if you saw the OK line this run.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify ship-clock', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

Ship-clock gate failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE (no weakening tests; SQLite byte-identical). Re-run the affected gate. Report.`,
    { label: `ship-clock repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify ship-clock #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`ship-clock final: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} sqlite=${verify.sqliteTestsPass} mongo=${verify.mongoTestsPass} proved=${verify.clockProved}`)
return verify

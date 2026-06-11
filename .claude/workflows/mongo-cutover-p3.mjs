export const meta = {
  name: 'mongo-cutover-p3',
  description: 'Mongo cutover Phase 3: strangle the non-archivist post-stream writers (turns, reveries, occupancy, npc-intents, promotion) onto ports',
  phases: [
    { title: 'WritePorts', detail: 'add the write methods these concerns need to their ports + both adapters (sqlite delegates)' },
    { title: 'Repoint', detail: 'repoint narrate-turn non-archivist writes onto the ports (leave applyArchivistPatch for Phase 4)' },
    { title: 'MongoAssert', detail: 'extend tests/mongo to assert turn + reverie/occupancy/intent writes land in Mongo' },
    { title: 'Verify', detail: 'npm test (byte-green) + test:mongo + depcruise, bounded repair' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are doing Phase 3 of the MongoDB cutover in chronicles-ai (onion-architecture Next.js).
Working dir: ${SERVER} (src paths are packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/mongo-cutover-plan.md — Phase 3 section.
- ${ROOT}/CLAUDE.md — architecture + style.
Read the actual files you edit before editing.

THE CARDINAL RULE: SQLite stays BYTE-IDENTICAL. New SQLite adapter write methods DELEGATE to the
existing lib functions (lib/db, lib/reveries, lib/npc-intents, lib/npc-promotion,
lib/place-population) so behavior is unchanged and 'npm test' stays green. Mongo adapters write the
collections via nextSeq integer ids. You ADD port write methods + Mongo impls and repoint call
sites — you do NOT rewrite SQLite behavior.

SCOPE (Phase 3): strangle the NON-ARCHIVIST post-stream writers in
infrastructure/narrator/narrate-turn.ts onto ports. Concretely:
- Turn writes: insertTurn / updateTurnMetadata -> TurnRepository.insert / .mergeMetadata (port
  likely already has these; if a method is missing add it, sqlite delegating to lib/db).
- Reverie writes: stampFlaredReveries / addReveriesForCharacter / repointReveries ->
  ReverieRepository (add methods if missing).
- Occupancy snapshot writes: buildPlaceOccupancySnapshot's persistence -> OccupancyRepository
  (the SAVE half; keep the pure inference in the domain/lib). Add an insert/save method if missing.
- NPC-intent writes (runNpcAgentTick / reconcileNpcIntentsForTurn persistence) ->
  NpcIntentRepository.
- Appearance/tier bumps: recordAppearancesAndAutoPromote -> CharacterRepository setters (add the
  needed bump/promote methods; sqlite delegates to lib/npc-promotion).
IMPORTANT — OUT OF SCOPE for Phase 3: applyArchivistPatch (the archivist write surface) — LEAVE IT
exactly as-is (it is Phase 4). opening-turn.ts writes — LEAVE as-is (Phase 5). Reads — already done
(Phase 2). Do not touch them.

For EVERY new port write method: add it to the domain/ports interface + the SQLite adapter
(delegating to the existing lib function — byte-identical) + the Mongo adapter (collection write
via the model + nextSeq, session-threaded if a UnitOfWork is in play). Mirror existing adapter
methods; do not invent new query/write shapes beyond what lib already does.

ONION RULES (CI-enforced): domain/ imports nothing outward; application/ imports only domain/;
adapters import inward only; wiring only in composition/container.ts. better-sqlite3 only under
persistence/sqlite/ (+allowlisted lib); mongoose only under persistence/mongo/.

CODE STYLE: 2-space, single quotes, NO semicolons, trailing commas multiline, alphabetized named
imports, explicit return types on exports. Match siblings.

VERIFY locally (cd ${SERVER}): npm run type-check, npm run depcruise, npm test, 'npm run test:mongo' (root).
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'sqliteTestsPass', 'mongoTestsPass', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    sqliteTestsPass: { type: 'boolean', description: 'npm test (SQLite) byte-green' },
    mongoTestsPass: { type: 'boolean', description: 'npm run test:mongo green incl. new write assertions' },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

phase('WritePorts')

const s1 = await agent(
  `${RULES}

STAGE 1 — add the write methods the Phase 3 concerns need to their ports + BOTH adapters. Do NOT
edit narrate-turn.ts yet (next stage repoints it). For each concern (turns, reveries, occupancy
snapshot save, npc-intents, character appearance/promotion bumps): inspect the lib function
narrate-turn currently calls, add the matching port method (if missing), implement the SQLite
adapter by DELEGATING to that lib function (byte-identical), and implement the Mongo adapter
(collection write via the model + nextSeq). Wire any new adapters into the container if needed.

Run type-check + depcruise. Return: each new port method + which lib fn the SQLite adapter
delegates to + the Mongo write, and files changed.`,
  { label: 'P3: write ports + adapters', phase: 'WritePorts' },
)

phase('Repoint')

const s2 = await agent(
  `${RULES}

Stage 1 (write ports + adapters) done. Report:
---
${s1}
---

STAGE 2 — repoint infrastructure/narrator/narrate-turn.ts's NON-ARCHIVIST writes onto the new
port methods, pulling the ports from getContainer() (the reads were already repointed in Phase 2).
Repoint: insertTurn/updateTurnMetadata, reverie writes, occupancy snapshot save, npc-intent
writes, appearance/promotion bumps. LEAVE applyArchivistPatch untouched (Phase 4). Keep the exact
same call order and arguments so behavior is byte-identical.

Run type-check + depcruise + 'npm test' and confirm SQLite is BYTE-GREEN. Return the call sites
repointed + the SQLite gate result. Do not run test:mongo yet.`,
  { label: 'P3: repoint narrate-turn writes', phase: 'Repoint' },
)

log(`Repoint: ${s2.slice(0, 200)}`)

phase('MongoAssert')

const s3 = await agent(
  `${RULES}

Stages 1-2 done. Extend tests/mongo/turn-pipeline.test.ts: drive enough of the post-stream write
path (or call the repointed port methods directly against the mongo container) to assert that a
turn row, and at least one of {reverie / occupancy snapshot / npc-intent / character appearance
bump}, are WRITTEN to and read back from MONGO. Keep the Phase 5 e2e placeholder skipped.

Run 'npm run test:mongo' and confirm green. Return files changed + result.`,
  { label: 'P3: mongo write assertions', phase: 'MongoAssert' },
)

phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.sqliteTestsPass && v.mongoTestsPass
}

const verifyPrompt = `${RULES}

VERIFICATION GATE (cd ${SERVER} for type-check; root for the rest):
1) npm run type-check
2) npm run depcruise
3) npm test            — SQLite, MUST be byte-green.
4) npm run test:mongo  — incl. the new write assertions.

Fix ONLY genuine issues you introduced (no weakening tests, no suppressing depcruise; SQLite
byte-identical). Re-run the failing gate. Report honestly per-gate.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify p3', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

The Phase 3 gate is failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE (no weakening tests, no suppressing depcruise; SQLite byte-identical). Re-run
the affected gate. Report what you changed.`,
    { label: `p3 repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify p3 #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`P3 final gate: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} sqlite=${verify.sqliteTestsPass} mongo=${verify.mongoTestsPass}`)
return verify

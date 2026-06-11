export const meta = {
  name: 'mongo-cutover-p2',
  description: 'Mongo cutover Phase 2: strangle the narrator-context READ assembler (world-state + recentTurns reads) onto read ports',
  phases: [
    { title: 'StrangleReads', detail: 'world-state assembler + narrate-turn/opening-turn/route reads onto ports (sqlite delegates, byte-green)' },
    { title: 'MongoAssert', detail: 'extend tests/mongo to assert narrator-context assembly returns the seeded world' },
    { title: 'Verify', detail: 'npm test (byte-green) + test:mongo + depcruise, bounded repair' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are doing Phase 2 of the MongoDB cutover in chronicles-ai (onion-architecture Next.js).
Working dir: ${SERVER} (src paths are packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/mongo-cutover-plan.md — Phase 2 section.
- ${ROOT}/CLAUDE.md — architecture + style.
Read the actual files you edit before editing.

THE CARDINAL RULE: SQLite stays BYTE-IDENTICAL. SQLite read adapters DELEGATE to the existing
lib/db readers, so the assembled narrator context is unchanged and 'npm test' stays green with
ZERO behavior change. This phase is READS ONLY — do not touch any write path (turns, archivist,
reveries writes) — those are Phase 3/4.

SCOPE (Phase 2): strangle the narrator-context READ assembler onto read ports.
- lib/world-state.ts: getNarratorWorldState / getFullWorldState / collectSceneTags /
  formatSceneDigestForClassifier currently read raw rows via ~11 functions imported from @/lib/db.
  Convert the assembler so it obtains those raw rows from the injected READ PORTS
  (CharacterRepository, PlaceRepository, SceneRepository, DossierRepository, OccupancyRepository,
  ReverieRepository, WorldRepository cursor/getWorld) instead of @/lib/db. KEEP ALL ASSEMBLY /
  FORMATTING / DEDUP LOGIC IDENTICAL — only the row SOURCE changes. Pass a deps/ports bag in.
- If a raw read the assembler needs has no port method yet, ADD it to the port + BOTH adapters
  (SQLite adapter delegates to the existing lib/db reader so rows are byte-identical; Mongo adapter
  reads the collection). Do NOT invent new query shapes — mirror the existing lib reader exactly.
- Repoint the READ call sites onto the assembler-with-ports via the container:
  infrastructure/narrator/narrate-turn.ts (its getNarratorWorldState + recentTurns reads),
  lib/opening-turn.ts (its getNarratorWorldState + getActiveSceneForWorld read), and the chat
  route app/api/chat/route.ts activeSceneId (-> SceneRepository.activeForWorld via the container).
  recentTurns reads -> TurnRepository (add a recentTurns read method if missing; sqlite delegates
  to lib/db.recentTurns).
- narrate-turn.ts lives in infrastructure/ but currently imports lib/* — for Phase 2 you may pass
  it the container/ports for the READ calls; leave its WRITE calls (insertTurn/applyArchivistPatch)
  untouched (Phase 3/5).

ONION RULES (CI-enforced): domain/ imports nothing outward; application/ imports only domain/;
adapters import inward only; wiring only in composition/container.ts. better-sqlite3 only under
persistence/sqlite/ (+allowlisted lib); mongoose only under persistence/mongo/.

CODE STYLE: 2-space, single quotes, NO semicolons, trailing commas multiline, alphabetized named
imports, explicit return types on exports. Match siblings.

VERIFY locally (cd ${SERVER}): npm run type-check, npm run depcruise, npm test, and 'npm run test:mongo'
(root). Make real edits.
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'sqliteTestsPass', 'mongoTestsPass', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    sqliteTestsPass: { type: 'boolean', description: 'npm test (SQLite) byte-green, no regression' },
    mongoTestsPass: { type: 'boolean', description: 'npm run test:mongo green incl. new context-assembly assertion' },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

phase('StrangleReads')

const s1 = await agent(
  `${RULES}

PHASE 2 — strangle the narrator-context READ assembler onto read ports (full scope above).
Do it carefully and incrementally; after wiring, run 'npm test' and confirm it is BYTE-GREEN
(the assembled context must be identical — if a snapshot/characterization test changes, you
changed assembly behavior: fix the delegation, do not edit the test).

Run type-check + depcruise + 'npm test'. Return: every port method added (+ that its SQLite
adapter delegates to which lib/db reader), the call sites repointed, files changed, and the
SQLite gate result. Do NOT run test:mongo yet.`,
  { label: 'P2: strangle context reads', phase: 'StrangleReads' },
)

phase('MongoAssert')

const s2 = await agent(
  `${RULES}

Phase 2 read-strangle is done. Report:
---
${s1}
---

Extend tests/mongo/turn-pipeline.test.ts: after creating/seeding a world on the Mongo port set,
call the narrator-context assembler (getNarratorWorldState-with-ports, built from the mongo
container) and assert it returns the seeded world's characters + places + active scene (i.e. the
assembler now reads MONGO, not SQLite). Keep the Phase 5 end-to-end placeholder skipped.

Run 'npm run test:mongo' and confirm green. Return files changed + the result.`,
  { label: 'P2: mongo context-assembly assertion', phase: 'MongoAssert' },
)

log(`Mongo assert: ${s2.slice(0, 200)}`)

phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.sqliteTestsPass && v.mongoTestsPass
}

const verifyPrompt = `${RULES}

VERIFICATION GATE (cd ${SERVER} for type-check; root for the rest):
1) npm run type-check
2) npm run depcruise
3) npm test            — SQLite, MUST be byte-green (Phase 2 must not change assembled context).
4) npm run test:mongo  — incl. the new context-assembly assertion.

Fix ONLY genuine issues you introduced (no weakening tests, no suppressing depcruise; SQLite stays
byte-identical — a changed snapshot means a real behavior change, fix the delegation). Re-run the
failing gate. Report honestly per-gate.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify p2', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

The Phase 2 gate is failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE (no weakening tests, no suppressing depcruise; SQLite byte-identical). Re-run
the affected gate. Report what you changed.`,
    { label: `p2 repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify p2 #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`P2 final gate: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} sqlite=${verify.sqliteTestsPass} mongo=${verify.mongoTestsPass}`)
return verify

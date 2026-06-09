export const meta = {
  name: 'mongo-cutover-p5a',
  description: 'Mongo cutover Phase 5a: strangle the opening-turn writes onto TurnRepository so create->opening->play works on Mongo',
  phases: [
    { title: 'OpeningTurn', detail: 'repoint opening-turn insertTurn/updateTurnMetadata onto TurnRepository via the container' },
    { title: 'Verify', detail: 'npm test (byte-green) + test:mongo + depcruise' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are doing Phase 5a of the MongoDB cutover in chronicles-ai (onion-architecture Next.js).
Working dir: ${SERVER} (src paths are packages/server/src/...).

READ FIRST: ${ROOT}/docs/plans/mongo-cutover-plan.md (Phase 5) + ${ROOT}/CLAUDE.md. Read the files you edit.

CONTEXT: opening-turn (lib/opening-turn.ts) already reads world-state via ports (P2) and applies
the archivist via the store-agnostic wrapper (P4). Its LAST SQLite-direct coupling is the TURN
WRITES — it still calls insertTurn / updateTurnMetadata from @/lib/db. Under PERSISTENCE=mongo a
newly created world's OPENING turn is therefore written to SQLite (the split-brain the user saw).

SCOPE (5a, small + surgical): repoint lib/opening-turn.ts's insertTurn + updateTurnMetadata onto
TurnRepository.insert / .mergeMetadata (same methods narrate-turn uses since P3), obtained from the
injected deps / getContainer()'s active ports. Add turns: TurnRepository to OpeningTurnDeps and
thread it from app/worlds/new/actions.ts openingTurnDeps(c). Drop the now-unused @/lib/db turn-write
imports from opening-turn.ts. Match the TurnRepository.insert/mergeMetadata call shapes used in
narrate-turn.ts EXACTLY (mergeMetadata writes per-top-level-key, byte-identical to the old
updateTurnMetadata json_patch for disjoint keys). Do NOT touch narrate-turn god-functions (Phase 5b).

THE CARDINAL RULE: SQLite stays BYTE-IDENTICAL (the SQLite TurnRepository delegates to lib/db
insertTurn/updateTurnMetadata). 'npm test' must stay green.

ONION RULES (CI-enforced) + CODE STYLE (2-space, single quotes, no semicolons, explicit return
types, alphabetized imports) — match siblings.

VERIFY (cd ${SERVER}): npm run type-check, npm run depcruise, npm test, 'npm run test:mongo' (root).
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'sqliteTestsPass', 'mongoTestsPass', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    sqliteTestsPass: { type: 'boolean' },
    mongoTestsPass: { type: 'boolean' },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

phase('OpeningTurn')

const s1 = await agent(
  `${RULES}

Implement the 5a scope above: repoint opening-turn's turn writes onto TurnRepository, thread the
port from actions.ts, drop the dead lib/db turn-write imports. Optionally add/extend a mongo test
asserting the opening-turn turn-write path lands in Mongo (the TurnRepository write is already
mongo-covered, so a light assertion or none is fine).

Run type-check + depcruise + 'npm test' (byte-green) + 'npm run test:mongo'. Return files changed +
the call-shape you used + gate results.`,
  { label: '5a: opening-turn writes', phase: 'OpeningTurn' },
)

log(`5a impl: ${s1.slice(0, 200)}`)

phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.sqliteTestsPass && v.mongoTestsPass
}

const verifyPrompt = `${RULES}

VERIFICATION GATE (cd ${SERVER} for type-check; root for the rest):
1) npm run type-check
2) npm run depcruise
3) npm test            — SQLite byte-green
4) npm run test:mongo

Fix ONLY genuine issues introduced (no weakening tests, no suppressing depcruise; SQLite
byte-identical). Re-run the failing gate. Report honestly per-gate.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify 5a', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

Phase 5a gate failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE (no weakening tests; SQLite byte-identical). Re-run the affected gate. Report.`,
    { label: `5a repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify 5a #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`5a final: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} sqlite=${verify.sqliteTestsPass} mongo=${verify.mongoTestsPass}`)
return verify

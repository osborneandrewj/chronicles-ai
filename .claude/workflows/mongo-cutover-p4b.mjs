export const meta = {
  name: 'mongo-cutover-p4b',
  description: 'Mongo cutover Phase 4b: convert applyArchivistPatch into a port-driven use case (UnitOfWork), repoint callers, delete duplicated SQL — characterization tests frozen as oracle',
  phases: [
    { title: 'Convert', detail: 'applyArchivistPatch -> use case over ports + UnitOfWork; oracle byte-green' },
    { title: 'RepointMongo', detail: 'narrate-turn/opening-turn/apply-correction call it via container; mongo e2e asserts archivist mutates Mongo' },
    { title: 'Verify', detail: 'oracle tests byte-green + full sqlite + test:mongo + depcruise' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are doing Phase 4b of the MongoDB cutover in chronicles-ai (onion-architecture Next.js) — the
RISKIEST step. Working dir: ${SERVER} (src paths are packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/mongo-cutover-plan.md — Phase 4 section.
- ${ROOT}/CLAUDE.md.
- ${SERVER}/src/lib/archivist.ts applyArchivistPatch (~line 1339+) — the function you convert, and
  its prepared statements (~597-970) which Phase 4a ALREADY MIRRORED verbatim into the SQLite
  adapters + DossierWriter. Read it end to end.
- The 4a port methods you will call: PlaceRepository/CharacterRepository/SceneRepository/
  WorldRepository (extended) + the new DossierWriter (domain/ports/dossier-writer.ts) + TimelineWriter.
- The pure domain services the logic already uses: domain/services/name-resolution.ts,
  character-dedup.ts, scene-transition.ts, patch-sanitizer.ts, etc.

THE FROZEN ORACLE: tests/archivist.test.ts, tests/name-resolution.test.ts, tests/scene-transition.test.ts
(and any other test that exercises applyArchivistPatch) pin the EXACT post-apply DB state. Their
ASSERTIONS MUST NOT CHANGE. You MAY change only HOW they invoke apply (e.g. through a thin helper
that builds the SQLite port bag and calls the use case) — never what they assert. Under SQLite the
new path MUST produce byte-identical DB state (the SQLite adapters hold the same SQL), so the suite
stays green. If an oracle assertion fails, your conversion changed behavior — FIX THE CONVERSION,
never the assertion.

WHAT TO DO:
1) Create application/use-cases/apply-archivist-patch.ts exporting applyArchivistPatch(input, deps):
   input = { worldId, turnId, patch }; deps = the port bag (places, characters, scenes, worlds,
   dossierWriter, timeline, unitOfWork, + any read ports it needs). MOVE the ENTIRE body of lib's
   applyArchivistPatch into it, replacing every db prepared-statement call with the matching 4a PORT
   method, and every inline read with the matching port read. PRESERVE EXACTLY: all control flow,
   ordering, name-resolution / dedup / scene-transition decisions (call the SAME pure domain
   services), COALESCE/append semantics, and the turn-id/world-time bookkeeping. Wrap the whole
   apply in unitOfWork.run(...) (atomic; both stores implement it).
2) Make the callers invoke the use case via getContainer()'s ACTIVE ports (so SQLite→SQLite,
   Mongo→Mongo): infrastructure/narrator/narrate-turn.ts (its applyArchivistPatch calls),
   lib/opening-turn.ts, and the apply-correction path (application/use-cases/apply-correction.ts +
   lib/archivist extractCorrectionPatch apply). narrate-turn already pulls getContainer().
3) Delete the now-duplicated prepared statements from lib/archivist.ts that the use case replaced
   (the SQLite adapters own them now). Keep extractPatch/extractCorrectionPatch (the LLM extraction)
   in lib — only the APPLY moves. If lib/archivist.ts no longer needs the db import, drop it.
4) If the oracle tests call lib applyArchivistPatch directly, give them a thin test helper that
   builds the SQLite port bag (from the container or by constructing the sqlite adapters over the
   lib/db singleton the tests already use) and calls the use case — assertions UNCHANGED.

ONION RULES (CI-enforced): application/ imports only domain/; adapters import inward only; wiring in
composition only. better-sqlite3 only under persistence/sqlite/ (+allowlisted lib); mongoose only
under persistence/mongo/. CODE STYLE: 2-space, single quotes, NO semicolons, explicit return types,
alphabetized imports. Match siblings.

VERIFY (cd ${SERVER}): npm run type-check, npm run depcruise, npm test (THE ORACLE — must be
byte-green), 'npm run test:mongo' (root).
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'oracleGreen', 'sqliteTestsPass', 'mongoTestsPass', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    oracleGreen: { type: 'boolean', description: 'archivist.test.ts + name-resolution.test.ts + scene-transition.test.ts pass with UNCHANGED assertions' },
    sqliteTestsPass: { type: 'boolean', description: 'full npm test green' },
    mongoTestsPass: { type: 'boolean', description: 'test:mongo green incl. archivist-mutates-Mongo assertion' },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

phase('Convert')

const s1 = await agent(
  `${RULES}

STAGE 1 — convert applyArchivistPatch to the port-driven use case + UnitOfWork, repoint the SQLite
callers, and delete the duplicated lib statements. Keep PERSISTENCE on SQLite for this stage. After
each meaningful chunk, run 'npm test' and confirm the ORACLE tests stay byte-green. Do the whole
conversion, then run type-check + depcruise + 'npm test' and confirm byte-green.

Return: the use-case signature + deps, the callers repointed, which lib statements you deleted, and
the oracle result (must be green). Do NOT run test:mongo yet.`,
  { label: '4b: convert apply to use case', phase: 'Convert' },
)

phase('RepointMongo')

const s2 = await agent(
  `${RULES}

Stage 1 (convert) done — oracle byte-green on SQLite. Report:
---
${s1}
---

STAGE 2 — confirm the Mongo path: the callers already use getContainer() ports, so under
PERSISTENCE=mongo the archivist now writes Mongo. UN-SKIP and complete the Phase-5-precursor: extend
tests/mongo/turn-pipeline.test.ts with an assertion that applying a representative ArchivistPatch
through the use case against the MONGO port bag mutates Mongo — e.g. inserts a character + a story
thread + a timeline event and updates a scene, then reads them back from Mongo. (Leave the full
"plays a turn end-to-end" placeholder skipped — that's Phase 5; this asserts the archivist apply
specifically.)

Run 'npm run test:mongo' and confirm green. Also re-run 'npm test' to confirm the oracle is still
byte-green. Return files changed + both results.`,
  { label: '4b: mongo archivist assertion', phase: 'RepointMongo' },
)

log(`Repoint mongo: ${s2.slice(0, 200)}`)

phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.oracleGreen && v.sqliteTestsPass && v.mongoTestsPass
}

const verifyPrompt = `${RULES}

VERIFICATION GATE (cd ${SERVER} for type-check; root for the rest):
1) npm run type-check
2) npm run depcruise
3) npm test  — and SPECIFICALLY confirm tests/archivist.test.ts, tests/name-resolution.test.ts,
   tests/scene-transition.test.ts pass with assertions you did NOT change (oracleGreen). Use
   'git diff tests/archivist.test.ts tests/name-resolution.test.ts tests/scene-transition.test.ts'
   to confirm no assertion changed (helper/import-only edits are OK).
4) npm run test:mongo

Fix ONLY genuine conversion bugs (no weakening tests, no changing oracle assertions, no suppressing
depcruise). If an oracle assertion fails, the conversion diverged from the original behavior — fix
the conversion. Report honestly per-gate; remainingFailures gets the key error line for any false flag.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify 4b', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 3) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

Phase 4b gate failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE in the CONVERSION (no weakening tests, no changing oracle assertions, no
suppressing depcruise; SQLite must produce byte-identical DB state). Re-run the affected gate.
Report what you changed.`,
    { label: `4b repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify 4b #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`4b final: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} oracle=${verify.oracleGreen} sqlite=${verify.sqliteTestsPass} mongo=${verify.mongoTestsPass}`)
return verify

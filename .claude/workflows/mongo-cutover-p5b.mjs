export const meta = {
  name: 'mongo-cutover-p5b',
  description: 'Mongo cutover Phase 5b: strangle the last lib/SQLite couplings in the turn path (occupancy-snapshot, npc-agent, intent-reconciler, place-resolver) so nothing reads SQLite under Mongo',
  phases: [
    { title: 'Strangle', detail: 'per-function: inject ports into the LLM god-functions so reads/writes use the active store' },
    { title: 'Integrate', detail: 'narrate-turn passes the port bag to all of them; drop remaining @/lib/db imports; grep-guard' },
    { title: 'Verify', detail: 'npm test (byte-green) + test:mongo + depcruise; confirm narrate-turn has no lib/db' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are doing Phase 5b (the FINAL strangle) of the MongoDB cutover in chronicles-ai
(onion-architecture Next.js). Working dir: ${SERVER} (src paths are packages/server/src/...).

READ FIRST: ${ROOT}/docs/plans/mongo-cutover-plan.md (Phase 5) + ${ROOT}/CLAUDE.md. Read the files you edit.

WHY THIS MATTERS (real bug): under PERSISTENCE=mongo, the still-lib-coupled turn helpers read/write
SQLite BY world_id. Because Mongo ids collide with existing SQLite world ids, a Mongo world pulls a
DIFFERENT SQLite world's data (cross-contamination). After 5b, NOTHING in the turn path reads SQLite
under Mongo, so the collision becomes harmless (two independent stores).

SCOPE (5b): strangle the LAST lib/SQLite couplings reachable from infrastructure/narrator/narrate-turn.ts
(and opening-turn if any remain). These are the LLM-bearing helpers that still use the module-level
better-sqlite3 singleton internally:
- lib/place-population.ts buildPlaceOccupancySnapshot (reads places/characters, infers via the pure
  occupancy-sim, persists a snapshot) -> take read ports + OccupancyRepository for the save.
- lib/npc-agent.ts runNpcAgentTick + applyNpcAgentPatch (reads world/character state, LLM, writes
  character/intent rows) -> take the port bag for ALL reads + writes (CharacterRepository,
  NpcIntentRepository, etc.).
- lib/intent-reconciler.ts reconcileNpcIntentsForTurn (reads/writes intents, LLM) -> NpcIntentRepository.
- lib/place-resolver.ts resolveUnresolvedPlaces (reads/writes places, geocode) -> place ports.
Convert each to ACCEPT injected ports/deps (do NOT keep importing @/lib/db for data). Keep the LLM
seams (model calls) as-is. For each, the SQLite path stays BYTE-IDENTICAL because the ports' SQLite
adapters delegate to the same lib/db functions the helper used to call — so 'npm test' stays green.
Then make narrate-turn.ts obtain the ports from getContainer() and pass them in, and DROP narrate-turn's
remaining direct @/lib/db / lib-data imports.

If a helper needs a read/write with no existing port method, ADD it to the port + both adapters
(SQLite delegating to the existing lib/db function — byte-identical; Mongo via the collection).

ONION RULES (CI-enforced) + CODE STYLE (2-space, single quotes, no semicolons, explicit return types,
alphabetized imports) — match siblings. better-sqlite3 only under persistence/sqlite/ (+allowlisted lib).

VERIFY (cd ${SERVER}): npm run type-check, npm run depcruise, npm test (byte-green), 'npm run test:mongo' (root).
`

// Per-function strangle — distinct lib files; each agent owns its function + any port method it adds,
// and must NOT edit narrate-turn.ts (the Integrate stage repoints it).
const FUNCS = [
  { key: 'occupancy', file: 'lib/place-population.ts', note: 'buildPlaceOccupancySnapshot: inject read ports (places/characters/dossier) + OccupancyRepository for persistence. Keep classifyPlaceKind/inferPlaceProfile pure. Save snapshot via OccupancyRepository.insertSnapshot.' },
  { key: 'npc-agent', file: 'lib/npc-agent.ts', note: 'runNpcAgentTick + applyNpcAgentPatch: inject the full port bag for every read + write (characters, intents, places, scenes). The Haiku call stays. Writes go through CharacterRepository / NpcIntentRepository / etc.' },
  { key: 'intent-reconciler', file: 'lib/intent-reconciler.ts', note: 'reconcileNpcIntentsForTurn: inject NpcIntentRepository (+ any read ports). LLM seam stays.' },
  { key: 'place-resolver', file: 'lib/place-resolver.ts', note: 'resolveUnresolvedPlaces: inject place read/write ports (the geocode seam stays). If a place geo-update port method is missing, add it (port + both adapters, sqlite delegating).' },
]

phase('Strangle')

const strangled = await parallel(
  FUNCS.map((f) => () =>
    agent(
      `${RULES}

STAGE 1 — strangle ${f.key} (${f.file}). Convert its exported function(s) to ACCEPT injected ports/
deps instead of reading the @/lib/db singleton. ${f.note}
You own ${f.file} + any port/adapter files for NEW methods you must add. Do NOT edit
infrastructure/narrator/narrate-turn.ts (the Integrate stage repoints callers). Keep the SQLite path
byte-identical (port SQLite adapters delegate to the same lib/db functions). Run 'npx tsc --noEmit'
to sanity-check. Return the new signature(s), any port methods added, and files changed.`,
      { label: `5b:${f.key}`, phase: 'Strangle' },
    ),
  ),
)

phase('Integrate')

const s2 = await agent(
  `${RULES}

The four helpers were converted to take injected ports. Reports:
---
${FUNCS.map((f, i) => `[${f.key}]\n${(strangled[i] ?? '(none)').slice(0, 500)}`).join('\n\n')}
---

INTEGRATE: edit infrastructure/narrator/narrate-turn.ts (and lib/opening-turn.ts if it calls any of
these) to obtain the ports from getContainer() and pass them into buildPlaceOccupancySnapshot,
runNpcAgentTick/applyNpcAgentPatch, reconcileNpcIntentsForTurn, resolveUnresolvedPlaces. Then DROP
narrate-turn's remaining direct @/lib/db and lib-data imports (keep only LLM/prompt/pure-helper
imports). Add a grep-style assertion to the architecture-boundaries test (or a new small test) that
infrastructure/narrator/narrate-turn.ts does NOT import @/lib/db.

Run type-check + depcruise + 'npm test' (BYTE-GREEN) + 'npm run test:mongo'. If the e2e
turn-pipeline mongo test can now be meaningfully un-skipped at the port level, do so. Return files
changed + gate results.`,
  { label: '5b: integrate narrate-turn', phase: 'Integrate' },
)

log(`Integrate: ${s2.slice(0, 200)}`)

phase('Verify')

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'sqliteTestsPass', 'mongoTestsPass', 'narrateTurnClean', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    sqliteTestsPass: { type: 'boolean', description: 'npm test byte-green' },
    mongoTestsPass: { type: 'boolean' },
    narrateTurnClean: { type: 'boolean', description: 'narrate-turn.ts no longer imports @/lib/db (grep confirms)' },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.sqliteTestsPass && v.mongoTestsPass && v.narrateTurnClean
}

const verifyPrompt = `${RULES}

VERIFICATION GATE (cd ${SERVER} for type-check; root for the rest):
1) grep -n "@/lib/db" ${SERVER}/src/infrastructure/narrator/narrate-turn.ts — MUST be empty (narrateTurnClean).
2) npm run type-check
3) npm run depcruise
4) npm test            — SQLite byte-green
5) npm run test:mongo

Fix ONLY genuine issues introduced (no weakening tests; SQLite byte-identical). Report honestly per-gate.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify 5b', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 3) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

Phase 5b gate failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE (no weakening tests; SQLite byte-identical; narrate-turn must not import @/lib/db).
Re-run the affected gate. Report what you changed.`,
    { label: `5b repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify 5b #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`5b final: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} sqlite=${verify.sqliteTestsPass} mongo=${verify.mongoTestsPass} narrateClean=${verify.narrateTurnClean}`)
return verify

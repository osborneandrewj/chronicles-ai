export const meta = {
  name: 'mongo-cutover-p01',
  description: 'Mongo cutover Phase 0 (safety net) + Phase 1 (strangle world creation onto a CreateWorld use case)',
  phases: [
    { title: 'CreateWorld', detail: 'WorldRepository.createOpen (+setSettingRegion) on both stores + CreateWorld use case + repoint actions' },
    { title: 'SafetyNet', detail: 'tests/mongo regression (integer id + spatial_mode) + e2e harness boots mongo container and creates worlds via ports' },
    { title: 'Verify', detail: 'npm test (sqlite byte-green) + npm run test:mongo + depcruise, bounded repair' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are finishing the MongoDB cutover in chronicles-ai, an onion-architecture Next.js app.
Working dir: ${SERVER} (src paths are packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/mongo-cutover-plan.md — Phase 0 + Phase 1 sections fix the approach.
- ${ROOT}/docs/specs/hexagonal-architecture-blueprint.md — the target (two adapter sets, one
  port set, store chosen in the composition root; Mongo uses nextSeq integer ids).
- ${ROOT}/CLAUDE.md — architecture + style.
Read the actual files you edit before editing.

THE CARDINAL RULE: the SQLite path must stay BYTE-IDENTICAL. SQLite adapters DELEGATE to the
existing lib/ SQL so 'npm test' stays green with NO behavior change. You are ADDING a Mongo
implementation + strangling a call site onto the port — not rewriting SQLite behavior.

KEY EXISTING PIECES (read for exact shapes):
- domain/ports/world-repository.ts → WorldRepository (getWorld/listWorlds/cursor/createBounded/
  archive...). You ADD createOpen + setSettingRegion.
- lib/worlds.ts → createWorld(input): World (open-world seed: world + 1 place from location +
  1 player char + 1 active scene + cursor, using derivePlaceName/classifyPlaceKind) and
  setSettingRegionForWorld. The SQLite createOpen adapter DELEGATES to these.
- infrastructure/persistence/mongo/repositories/world-repository.mongo.ts → createBounded uses
  ctx.nextSeq('worldId') for an INTEGER id + sets spatialMode. MIRROR that for createOpen
  (world + seed place/character/scene + cursor, all via nextSeq).
- application/use-cases/seed-bounded-world.ts → the use-case shape to mirror for CreateWorld.
- app/worlds/new/actions.ts → createAndOpenWorld currently calls lib/worlds.createWorld +
  setSettingRegionForWorld directly; repoint it onto the new use case via getContainer().
- composition/container.ts + build-mongo-repositories.ts → wiring.
- tests/mongo/* + vitest.mongo.config.ts → the Mongo suite (MongoMemoryReplSet, PERSISTENCE=mongo).
  Run it with: npm run test:mongo.

ONION RULES (CI-enforced): domain/ imports nothing outward; application/ imports only domain/;
adapters import inward only; wiring only in composition/container.ts. better-sqlite3 only under
persistence/sqlite/ (+ the allowlisted lib modules); mongoose only under persistence/mongo/.
A Server Action is a driving adapter — it MAY use the container + lib.

CODE STYLE: 2-space, single quotes, NO semicolons, trailing commas multiline, alphabetized
named imports, explicit return types on exports. Match siblings.

VERIFY locally (cd ${SERVER}): npm run type-check, npm run depcruise, npx vitest run <path> --root ${SERVER},
and the mongo suite via 'npm run test:mongo' (root). Make real edits.
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'sqliteTestsPass', 'mongoTestsPass', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    sqliteTestsPass: { type: 'boolean', description: 'npm test (SQLite default) green — byte-identical, no regressions' },
    mongoTestsPass: { type: 'boolean', description: 'npm run test:mongo green, incl. the new Phase 0 mongo tests' },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
phase('CreateWorld')

const s1 = await agent(
  `${RULES}

PHASE 1 — strangle open-world CREATION onto a CreateWorld use case. Implement ALL:

1) WorldRepository (domain/ports/world-repository.ts): add
   - createOpen(input: { name, premise, initialState: { time, location, identity, playerName? } }):
     Promise<{ id: number }> — creates the world + the open-world seed (1 place derived from
     location, 1 player character there, 1 active scene #1, cursor) exactly as lib/worlds.createWorld
     does today.
   - setSettingRegion(worldId: number, region: string | null): Promise<void>.
2) SQLite adapter (world-repository.sqlite.ts): createOpen DELEGATES to lib/worlds.createWorld
   (return { id: world.id }); setSettingRegion delegates to a lib setter (lib/worlds has a
   setSettingRegionStmt — expose a sync setter if needed, or reuse setSettingRegionForWorld's
   write half WITHOUT the LLM call — the region is computed in the use case). Behavior must be
   byte-identical to today.
3) Mongo adapter (world-repository.mongo.ts): implement createOpen by MIRRORING createBounded —
   nextSeq('worldId') for the world (spatial_mode 'open'), then nextSeq + insert a seed place
   (name via the same derivePlaceName/classifyPlaceKind logic — import the pure helpers or
   replicate), a player character on it, an active scene #1, and set the cursor (world_time +
   current_scene_id). setSettingRegion updates the world doc.
4) application/use-cases/create-world.ts: createWorld(input, deps) that calls worlds.createOpen
   then (async) extractSettingRegion(premise, location) [region-extractor is store-agnostic] and
   worlds.setSettingRegion. Return { worldId }. Pure orchestration (no SQL/SDK/lib SQL).
5) Repoint app/worlds/new/actions.ts createAndOpenWorld: call the CreateWorld use case via
   getContainer() instead of lib/worlds.createWorld + setSettingRegionForWorld. Keep
   generateOpeningTurn + redirect AS-IS for now (opening turn is Phase 5; do NOT touch it).
   IMPORTANT: keep redirect() outside try/catch.

Run type-check + depcruise + 'npm test' (must stay green — SQLite byte-identical). Return new
signatures, files changed, and gate results. Do NOT run test:mongo yet (next stage adds its tests).`,
  { label: 'P1: CreateWorld use case + createOpen', phase: 'CreateWorld' },
)

// ---------------------------------------------------------------------------
phase('SafetyNet')

const s2 = await agent(
  `${RULES}

Phase 1 (CreateWorld) is done. Report:
---
${s1}
---

PHASE 0 — the Mongo safety net. Add tests under tests/mongo/ (run by 'npm run test:mongo'; copy
the boot/harness pattern from the existing tests/mongo/* files — MongoMemoryReplSet + the container
built with PERSISTENCE=mongo / initContainer):

1) Regression test: via the Mongo WorldRepository, createBounded({...}) then getWorld(id) and
   assert the returned id is an INTEGER (typeof number) and spatial_mode === 'bounded'. Also
   createOpen({...}) then getWorld and assert integer id + spatial_mode === 'open' and that the
   seed place + player character + active scene exist (via the place/character/scene repos).
2) e2e harness tests/mongo/turn-pipeline.test.ts: boot the mongo container, create an OPEN world
   via the CreateWorld use case (built from the container) and a BOUNDED world via seedBoundedWorld
   with the StubCrewGenerator, and assert both are readable back through the ports (world list
   includes them; places/characters present). Leave a SKIPPED ('it.skip') placeholder test named
   "plays a turn end-to-end on Mongo (un-skipped in Phase 5)" documenting the final exit criterion.

Run 'npm run test:mongo' (root) and confirm your new tests pass. (If the mongo binary download is
slow on first run, allow it.) Return files changed + the test:mongo result.`,
  { label: 'P0: mongo safety-net tests', phase: 'SafetyNet' },
)

log(`Safety net: ${s2.slice(0, 200)}`)

// ---------------------------------------------------------------------------
phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.sqliteTestsPass && v.mongoTestsPass
}

const verifyPrompt = `${RULES}

VERIFICATION GATE. In order (cd ${SERVER} for type-check; repo root for the rest):
1) npm run type-check
2) npm run depcruise
3) npm test            — the SQLite suite. MUST be byte-green (Phase 1 must not regress it).
4) npm run test:mongo  — the Mongo suite incl. the new Phase 0 tests.

If anything fails, fix ONLY genuine issues you introduced (no weakening tests, no suppressing
depcruise). The SQLite suite failing means the strangle changed behavior — fix the delegation,
do not edit the test. Re-run the failing gate. Report honestly per-gate; remainingFailures lists
the key error line for any false flag.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify p01', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

The Mongo-cutover P0/P1 gate is failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE (no weakening tests, no suppressing depcruise; SQLite must stay byte-identical).
Re-run the affected gate. Report what you changed.`,
    { label: `p01 repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify p01 #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`P0/P1 final gate: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} sqlite=${verify.sqliteTestsPass} mongo=${verify.mongoTestsPass}`)
return verify

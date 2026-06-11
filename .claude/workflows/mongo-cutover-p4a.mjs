export const meta = {
  name: 'mongo-cutover-p4a',
  description: 'Mongo cutover Phase 4a: add the archivist WRITE-port surface (place/character/scene/dossier/world mutations) on both stores, byte-identical SQL — archivist.ts untouched',
  phases: [
    { title: 'Surface', detail: 'per-repo: add archivist write+lookup methods (port + sqlite copying exact SQL + mongo via nextSeq)' },
    { title: 'Integrate', detail: 'wire port index + container + mongo builder; add mongo write tests' },
    { title: 'Verify', detail: 'npm test (byte-green; archivist.ts unchanged) + test:mongo + depcruise' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are doing Phase 4a of the MongoDB cutover in chronicles-ai (onion-architecture Next.js).
Working dir: ${SERVER} (src paths are packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/mongo-cutover-plan.md — Phase 4 section.
- ${ROOT}/CLAUDE.md — architecture + style.
- ${SERVER}/src/lib/archivist.ts — the prepared statements you mirror are defined here (lines
  ~597-970). Read the EXACT SQL of each statement you reproduce.

THE GOAL OF 4a: ADD a write-port surface that the archivist will later use (Phase 4b), WITHOUT
changing any behavior yet. DO NOT EDIT lib/archivist.ts (its applyArchivistPatch keeps running its
own statements; the oracle characterization tests must not move). The new SQLite adapter methods
contain a VERBATIM COPY of the archivist's SQL (temporary duplication; 4b deletes the originals),
so they are byte-identical. The new Mongo adapter methods perform the equivalent collection writes
via ctx.nextSeq integer ids (mirror the existing mongo adapter methods in the same file). The new
methods are NOT CALLED yet, so the SQLite suite stays byte-green.

ONION RULES (CI-enforced): domain/ imports nothing outward; adapters import inward only; wiring
only in composition/container.ts. better-sqlite3 only under persistence/sqlite/ (+allowlisted lib);
mongoose only under persistence/mongo/. CODE STYLE: 2-space, single quotes, NO semicolons, trailing
commas, alphabetized imports, explicit return types. Match siblings.

VERIFY (cd ${SERVER}): npm run type-check, npm run depcruise, npm test, 'npm run test:mongo' (root).
`

// Per-repository write surface, mapped from archivist.ts. Each agent owns DISTINCT files
// (its port + its two adapters) and must NOT touch domain/ports/index.ts, container.ts, or
// archivist.ts (the Integrate stage wires barrels/container).
const REPOS = [
  {
    key: 'place',
    files: 'domain/ports/place-repository.ts, infrastructure/persistence/sqlite/place-repository.sqlite.ts, infrastructure/persistence/mongo/repositories/place-repository.mongo.ts',
    methods: `mirror these archivist.ts place statements as PlaceRepository methods:
      insert({world_id,name,description,kind})→{id} [insertPlaceStmt], update({description,kind,id})
      [updatePlaceStmt], merge({description,kind,id}) [mergePlaceStmt — the COALESCE merge],
      moveCharactersToPlace(toId,fromId) [moveCharactersToPlaceStmt], moveScenesToPlace(toId,fromId)
      [moveScenesToPlaceStmt], delete(id) [deletePlaceStmt], appendPlayerNotes(...)
      [appendPlacePlayerNotesStmt]. Also the archivist-used READS not already on the port:
      currentPlaceForWorld(worldId) [currentPlaceForWorldStmt], nameById(id) [placeNameByIdStmt].
      (forWorld/byId/add already exist — keep them.)`,
  },
  {
    key: 'character',
    files: 'domain/ports/character-repository.ts, infrastructure/persistence/sqlite/character-repository.sqlite.ts, infrastructure/persistence/mongo/repositories/character-repository.mongo.ts',
    methods: `mirror these archivist.ts character statements as CharacterRepository methods:
      insert(...) [insertCharacterStmt]→{id}, update(...) [updateCharacterStmt], setActiveGoal,
      setCurrentAttitude, setObservations, merge(...) [mergeCharacterStmt], delete(id), setAliases,
      rename(name,id) [renameCharacterStmt], setPlayersPlace(placeId,worldId) [setPlayersPlaceStmt],
      appendPlayerNotes [appendCharacterPlayerNotesStmt]. READS: findByExactLowerName(worldId,name)
      [findCharacterByExactLowerNameStmt]. (forWorld/inPlace/add/recordAppearancesAndAutoPromote
      already exist — keep them.) Copy each statement's columns/COALESCE EXACTLY.`,
  },
  {
    key: 'scene',
    files: 'domain/ports/scene-repository.ts, infrastructure/persistence/sqlite/scene-repository.sqlite.ts, infrastructure/persistence/mongo/repositories/scene-repository.mongo.ts',
    methods: `mirror these archivist.ts scene statements as SceneRepository methods:
      close({summary,closedAtTurn,id}) [closeSceneStmt], insert({world_id,place_id,title,
      scene_number,opened_at_turn})→{id} [insertSceneStmt], updateContext(...) [updateSceneContextStmt],
      autoClose(closedAtTurn,id) [autoCloseSceneStmt]. READS: maxSceneNumber(worldId)
      [maxSceneNumberStmt], currentSceneId(worldId) [currentSceneIdStmt], currentScenePlaceId(worldId)
      [currentScenePlaceIdStmt]. (forWorld/activeForWorld/add already exist.)`,
  },
  {
    key: 'dossier',
    files: 'NEW domain/ports/dossier-writer.ts, NEW infrastructure/persistence/sqlite/dossier-writer.sqlite.ts, NEW infrastructure/persistence/mongo/repositories/dossier-writer.mongo.ts',
    methods: `create a NEW DossierWriter port (the dossier has NO write port today) mirroring these
      archivist.ts statements: insertThread/updateThread [insertStoryThreadStmt/updateStoryThreadStmt],
      insertClue/updateClue, insertObjective/updateObjective, insertResource/updateResource (+ the
      *ByTitle / *ByName lookups: storyThreadByTitle, storyClueByTitle, storyObjectiveByTitle,
      storyResourceByName). Inserts return {id}. The existing DossierRepository stays read-only;
      this is the write sibling. Copy columns/defaults EXACTLY from the statements.`,
  },
  {
    key: 'world',
    files: 'domain/ports/world-repository.ts, infrastructure/persistence/sqlite/world-repository.sqlite.ts, infrastructure/persistence/mongo/repositories/world-repository.mongo.ts',
    methods: `add WorldRepository methods mirroring archivist.ts: setCurrentScene(sceneId,worldId)
      [setCurrentSceneStmt — UPDATE worlds SET current_scene_id]. (setWorldTime + setCursor already
      exist — reuse setWorldTime for setWorldTimeStmt; do NOT duplicate.) Only add what's missing.`,
  },
]

phase('Surface')

const surfaced = await parallel(
  REPOS.map((r) => () =>
    agent(
      `${RULES}

STAGE 1 — add the ${r.key} archivist WRITE surface. You own ONLY these files: ${r.files}.
Do NOT touch domain/ports/index.ts, composition/container.ts, build-mongo-repositories.ts, or
lib/archivist.ts (the Integrate stage wires barrels/container).

${r.methods}

For EACH method: add it to the port interface; implement the SQLite adapter with a prepared
statement whose SQL is a VERBATIM COPY of the archivist.ts original (byte-identical — same columns,
same COALESCE/datetime('now'), same WHERE); implement the Mongo adapter with the equivalent
collection write/read (integer ids via ctx.nextSeq for inserts, session-threaded like the sibling
methods). Use explicit input types. Read the existing methods in each file first and match their
idiom exactly.

Do NOT run the test suite (Integrate/Verify does). You MAY run 'npx tsc --noEmit' to sanity-check
types if useful. Return the exact method signatures you added per file.`,
      { label: `4a:${r.key}`, phase: 'Surface' },
    ),
  ),
)

phase('Integrate')

const s2 = await agent(
  `${RULES}

The five per-repo write surfaces were added (place/character/scene/dossier/world). Their reports:
---
${REPOS.map((r, i) => `[${r.key}]\n${(surfaced[i] ?? '(none)').slice(0, 600)}`).join('\n\n')}
---

INTEGRATE:
1) Update domain/ports/index.ts to export the new DossierWriter (+ any new input types) and keep
   the others exported.
2) Wire DossierWriter into composition/container.ts (Container type + buildSqlite) and
   infrastructure/persistence/mongo/build-mongo-repositories.ts (Mongo set). The other repos already
   exist in the container — no new container fields beyond DossierWriter (their NEW METHODS ride the
   existing instances).
3) Add Mongo write tests in tests/mongo/ (a new file or extend turn-pipeline.test.ts) asserting a
   representative subset round-trips on Mongo: place insert/update/merge/delete, character
   insert/update/merge/rename/delete, scene insert/close, a story thread + clue + objective +
   resource insert/update via DossierWriter, and world.setCurrentScene.

Run type-check + depcruise + 'npm test' (MUST be byte-green — archivist.ts is untouched and the new
methods are uncalled, so nothing should change) + 'npm run test:mongo'. Return files changed + gates.`,
  { label: '4a: integrate + mongo tests', phase: 'Integrate' },
)

log(`Integrate: ${s2.slice(0, 200)}`)

phase('Verify')

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'sqliteTestsPass', 'mongoTestsPass', 'archivistUntouched', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    sqliteTestsPass: { type: 'boolean', description: 'npm test byte-green' },
    mongoTestsPass: { type: 'boolean', description: 'test:mongo green incl. new write round-trips' },
    archivistUntouched: { type: 'boolean', description: 'git diff shows lib/archivist.ts was NOT modified' },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.sqliteTestsPass && v.mongoTestsPass && v.archivistUntouched
}

const verifyPrompt = `${RULES}

VERIFICATION GATE (cd ${SERVER} for type-check; root for the rest):
1) git -C ${ROOT} diff --name-only — CONFIRM lib/archivist.ts is NOT in the list (archivistUntouched).
2) npm run type-check
3) npm run depcruise
4) npm test            — SQLite, MUST be byte-green (new methods uncalled → zero behavior change).
5) npm run test:mongo  — incl. the new write round-trips.

Fix ONLY genuine issues introduced (no weakening tests, no suppressing depcruise). If archivist.ts
was modified, REVERT that file (git checkout) — 4a must not touch it. Report honestly per-gate.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify 4a', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

Phase 4a gate failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE (no weakening tests; SQLite byte-identical; archivist.ts untouched). Re-run the
affected gate. Report what you changed.`,
    { label: `4a repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify 4a #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`4a final: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} sqlite=${verify.sqliteTestsPass} mongo=${verify.mongoTestsPass} archivistUntouched=${verify.archivistUntouched}`)
return verify

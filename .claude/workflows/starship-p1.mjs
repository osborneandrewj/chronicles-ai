export const meta = {
  name: 'starship-p1',
  description: 'Implement P1 seed pipeline: write surface + adapters, Grok crew generator, SeedBoundedWorld use case, offline seed script',
  phases: [
    { title: 'WriteSurface', detail: 'create methods + place-connection/relationship adapters + Place read fix' },
    { title: 'CrewGen', detail: 'deck template + provider + Grok crew generator + stub + prompt' },
    { title: 'UseCase', detail: 'SeedBoundedWorld orchestration + fake-port unit test' },
    { title: 'WireAndScript', detail: 'container wiring + offline seed-ship.mjs run against temp DB' },
    { title: 'Verify', detail: 'type-check + depcruise + full vitest, bounded repair loop' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are implementing P1 of the bounded "starship" world feature in chronicles-ai,
an onion-architecture Next.js app. Working dir: ${SERVER} (src paths are
packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/starship-bounded-world-plan.md — the section "P1 implementation
  spec (seed pipeline — binding for the build)" fixes every design decision. Follow it
  exactly; do not invent a different write surface or use-case shape.
- ${ROOT}/CLAUDE.md — architecture + style.
Read the actual files you edit before editing.

P0 ALREADY EXISTS (built + committed): migrations v26-v28; entities SpatialMode,
PlaceConnection, CharacterRelationship, DeckGraph; ports deck-plan-provider,
drama-port, place-connection-repository, relationship-repository, timeline-writer
(see their files for exact shapes — DeckPlanTemplate/DeckPlanRoom/DeckPlanEdge/
DeckPlanCrewSlot are in deck-plan-provider.ts; PlaceConnectionInput.add and
RelationshipInput.upsert signatures are in their port files); pure services
deck-graph, npc-movement, colocation, beat-gating, relationship-drift.

ONION RULES (CI-enforced by dependency-cruiser — violations fail the build):
- domain/ imports nothing outward. application/ imports only domain/. adapters import
  inward only; NEVER import lib/ from new application/use-cases code. Wiring lives in
  composition/container.ts only.
- better-sqlite3 only under infrastructure/persistence/sqlite/; mongoose only under
  persistence/mongo/. Model IDs + pricing only in infrastructure/llm/.
- Use cases are PURE orchestration: no SQL, no SDK, no framework, deps injected.

CODE STYLE: 2-space indent, single quotes, NO semicolons, trailing commas multiline,
named imports alphabetized, const/let, explicit return types on exported functions,
camelCase vars / PascalCase types. Match each file's existing idiom.

VERIFY locally as you go (cd ${SERVER}): 'npm run type-check' and 'npm run depcruise'.
Run a single test without the depcruise pretest via:
  npx vitest run <path> --root ${SERVER}
Make real edits with Write/Edit. Match existing adapter/test conventions — read a
sibling file first (e.g. an existing *.sqlite.ts repo + its test, the world-generator.ts
for the generateObject pattern, an existing prompts/*.md).
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'testsPass', 'scriptProvedShip', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    scriptProvedShip: {
      type: 'boolean',
      description: 'Whether scripts/seed-ship.mjs ran and printed a connected ship with 3-5 crew',
    },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
phase('WriteSurface')

const s1 = await agent(
  `${RULES}

STAGE 1 — the persistence write surface (per the plan's P1 spec). Implement ALL:

1) WorldRepository: add createBounded({ name, premise, initialStateJson, templateId }):
   Promise<{ id: number }> — inserts ONLY a worlds row with spatial_mode='bounded' and
   the template_id (NO auto-seeded place/character/scene). Add to the port interface
   (domain/ports/world-repository.ts) and the SQLite adapter. Put the raw INSERT in the
   legacy lib/worlds.ts (where the other world statements live) and have the adapter call
   it — match how SqliteWorldRepository already delegates to lib/worlds functions.

2) PlaceRepository.add({ world_id, name, description, kind, deck, layout_hint }):
   Promise<{ id: number }> — port + SQLite adapter (delegate to a lib/db or lib insert,
   matching existing place read delegation).

3) CharacterRepository.add({ world_id, name, description, is_player, current_place_id,
   role, active_goal, daily_loop }): Promise<{ id: number }> — port + SQLite adapter.
   daily_loop is JSON text written to the characters.daily_loop column (v24).
   NOTE: 'role' is not a characters column today — if there is no suitable column, store
   the crew role in an existing field (e.g. current_focus or recent_activity) OR add a
   minimal column only if necessary; prefer reusing an existing field and document it.

4) Implement the SQLite adapters for PlaceConnectionRepository (forWorld + add) and
   RelationshipRepository (forWorld + upsert + adjustValence) — neither has an adapter
   yet. New files under infrastructure/persistence/sqlite/. Stamp created_at/updated_at
   from a clock or datetime('now') consistent with sibling adapters.

5) Place read-path fix: extend lib/world-state's Place type + the SELECT that reads
   places so deck + layout_hint come back at runtime (they were added to the DB in v26
   but the read path drops them).

6) Mongo parity: implement the same write methods + the two new repos in
   infrastructure/persistence/mongo/repositories/ so PERSISTENCE=mongo stays at parity.

TESTS: add focused SQLite-adapter tests (in-memory DB with migrations run — copy the
setup from an existing adapter test) covering: createBounded writes spatial_mode='bounded'
and does NOT create extra place/char/scene rows; place add + character add round-trip;
place_connections add + forWorld; relationship upsert + adjustValence + forWorld; and that
a read Place now carries deck/layout_hint.

Run type-check + depcruise + your new tests. Do NOT wire container.ts yet (Stage 4).
Return: every new/changed signature, files changed, and your local gate results.`,
  { label: 'P1: write surface + adapters', phase: 'WriteSurface' },
)

// ---------------------------------------------------------------------------
phase('CrewGen')

const s2 = await agent(
  `${RULES}

STAGE 1 (write surface) is done. Its report:
---
${s1}
---

STAGE 2 — authored topology + the Grok crew generator (per the plan's P1 spec):

1) Authored template: create ONE "scout vessel" DeckPlanTemplate as a domain value
   constant (rooms with key/name/description/deck/layoutHint, a CONNECTED edge graph,
   and 3-5 crew-role slots each anchored to a real room key). ~6 rooms: bridge, crew
   quarters, sim deck, engine room, mess, med-bay. Ensure the edge graph is a single
   connected component (deck-graph.isConnected would pass).

2) DeckPlanProvider adapter (infrastructure/world-gen/) implementing getTemplate(id) ->
   the scout template (null for unknown ids).

3) CrewGenerator port (domain/ports/crew-generator.ts):
   In: { template: DeckPlanTemplate, premise: string, playerName?: string }.
   Out: { shipName: string, premise: string, roomDressing: Array<{ key: string;
   description: string }>, crew: Array<{ role: string; name: string; persona: string;
   goal: string; homeRoomKey: string; dailyLoop: Record<WorldTimeBand, { activity: string;
   place: string }> }>, relationships: Array<{ fromRole: string; toRole: string;
   kind: string; valence: number }> }. (WorldTimeBand is from domain/services/world-clock.)

4) GrokCrewGenerator (infrastructure/world-gen/): generateObject with grok-4.3 (get the
   model id from infrastructure/llm/ — do NOT inline it) via @ai-sdk/xai, Zod schema for
   the output, system prompt loaded from a new prompts/crew-dressing.md (git-diffable,
   loaded at runtime like the other prompts). Crew count constrained to 3-5; valence in
   -1..1; homeRoomKey/dailyLoop.place must reference real room keys/names. Copy the
   one-shot structured-call pattern from lib/world-generator.ts (but use Grok, not Haiku,
   and keep it in infrastructure, not lib).

5) StubCrewGenerator (infrastructure/world-gen/ or a test helper): deterministic output
   derived from the template (e.g. one crew member per slot, fixed names/relationships) so
   tests + the offline script run with no LLM spend and no API key.

TESTS: unit-test the DeckPlanProvider (returns a connected template; deck-graph.isConnected
passes on it) and the StubCrewGenerator (3-5 crew, valid room-key references).

Run type-check + depcruise + your tests. Do NOT wire container.ts yet.
Return: the new port shape, file list, and gate results.`,
  { label: 'P1: deck template + Grok crew gen', phase: 'CrewGen' },
)

// ---------------------------------------------------------------------------
phase('UseCase')

const s3 = await agent(
  `${RULES}

Stages 1-2 are done. Stage 2 report:
---
${s2}
---

STAGE 3 — the SeedBoundedWorld use case (application/use-cases/seed-bounded-world.ts),
per the plan's P1 spec. PURE orchestration, deps injected, no SQL/SDK/lib imports.

Deps: { decks: DeckPlanProvider, crew: CrewGenerator, worlds: WorldRepository,
places: PlaceRepository, placeConnections: PlaceConnectionRepository,
characters: CharacterRepository, relationships: RelationshipRepository, clock: Clock }.

Flow (exactly):
- getTemplate(templateId); throw a domain error if null.
- worlds.createBounded(...) -> worldId.
- For each template room: places.add(...) applying the matching roomDressing.description;
  build a Map<roomKey, placeId>.
- placeConnections.add(edges) mapping each edge's from/to room keys to place ids
  (bidirectional -> the bidirectional flag/int).
- crew.generate({ template, premise, playerName }).
- For each crew member: characters.add(...) with current_place_id = the homeRoomKey's
  place id and daily_loop = JSON of dailyLoop (resolve its room names to the seeded rooms);
  build a Map<role, characterId>.
- relationships.upsert(edges) mapping fromRole/toRole -> character ids.
- Validate: build the DeckGraph from the inserted edges and assert deck-graph.isConnected
  over the room place ids; throw a domain error if not connected.
- Return { worldId, placeIds, characterIds }.

Define any new domain error types alongside the existing ones (e.g. a TemplateNotFound /
DisconnectedTopology) and map nowhere here (mapping is an adapter concern).

TEST: unit-test with IN-MEMORY FAKE ports (plain objects implementing the interfaces,
recording calls) — assert it creates a bounded world, one place per room, edges for every
template edge, one character per crew member at the right room, the relationships, and that
it throws on a disconnected template. No DB, no LLM (use the stub or a fake).

Run type-check + depcruise + your test. Do NOT wire container.ts yet.
Return: the use-case signature + deps, file list, gate results.`,
  { label: 'P1: SeedBoundedWorld use case', phase: 'UseCase' },
)

// ---------------------------------------------------------------------------
phase('WireAndScript')

const s4 = await agent(
  `${RULES}

Stages 1-3 are done. Stage 3 report:
---
${s3}
---

STAGE 4 — wiring + the offline proof script.

1) composition/container.ts: add the new adapters to the Container type and BOTH builders
   (buildSqlite + the Mongo path): placeConnections (PlaceConnectionRepository),
   relationships (RelationshipRepository), decks (DeckPlanProvider), crewGenerator
   (the REAL GrokCrewGenerator). Follow the existing wiring exactly (globalThis cache is
   already handled). Mongo builder gets the Mongo repo impls; both get the same
   DeckPlanProvider + GrokCrewGenerator (those are stateless infra). Keep type-check green.

2) scripts/seed-ship.mjs (Node ESM, run with the project's tsx/node runner — check how
   existing scripts/*.mjs are run, e.g. scripts/copy-world.mjs):
   - point at a temp DB (set process.env.DATABASE_PATH to a /tmp path BEFORE importing the
     container so migrations run on a fresh file),
   - build the SQLite container, construct SeedBoundedWorld from its parts but SWAP IN the
     StubCrewGenerator (so it runs free + deterministic),
   - run it with templateId='scout' and a sample premise,
   - then read back via the repos and PRINT: ship/world id, every room (name + deck), the
     connectivity edges, every crew member (name, role, home room), and the relationships,
   - assert (and exit non-zero on failure): the deck graph is connected and crew count is
     3-5. End by printing a clear "OK: seeded a connected ship with N crew" line.

3) RUN the script (cd ${SERVER} or repo root as the other scripts do) and confirm it prints
   the OK line. If it fails, fix the root cause (likely a mapping or a missing write) and
   re-run.

Return: whether the script printed the OK line (quote it), the crew count, files changed,
and type-check/depcruise results.`,
  { label: 'P1: wire container + seed script', phase: 'WireAndScript' },
)

log(`Seed script stage: ${s4.slice(0, 240)}`)

// ---------------------------------------------------------------------------
phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.testsPass && v.scriptProvedShip
}

const verifyPrompt = `${RULES}

STAGE 5 — full verification gate. In order, from ${SERVER} (or repo root for the script):
1) npm run type-check
2) npm run depcruise
3) npm test  (full Vitest suite incl. the new P1 adapter/use-case tests)
4) Re-run the offline proof: node (or the project runner) scripts/seed-ship.mjs against a
   fresh temp DB, and confirm it prints the "OK: seeded a connected ship with N crew" line
   with N in 3-5.

If anything fails, fix ONLY genuine issues you introduced (missing export/wiring, a mapping
bug, a type mismatch). Do NOT weaken tests or suppress dependency-cruiser. Re-run the failing
gate. Report honestly — set a flag false and give the key error line in remainingFailures if
it still fails. Do not claim a pass you did not observe (especially scriptProvedShip — only
true if you saw the OK line this run).`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify P1', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

The P1 verification gate is failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE of each (no weakening tests, no suppressing depcruise). Re-run the
affected gate (and the seed script if relevant) to confirm. Report what you changed.`,
    { label: `P1 repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify P1 #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`P1 final gate: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} tests=${verify.testsPass} script=${verify.scriptProvedShip}`)
return verify

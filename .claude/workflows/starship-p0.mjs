export const meta = {
  name: 'starship-p0',
  description: 'Implement P0 (schema/entities/ports/mongo-models) + pure domain services (TDD) for bounded starship worlds',
  phases: [
    { title: 'Foundation', detail: 'migrations v26-v28, entities, ports, mongo models' },
    { title: 'Services', detail: 'pure domain services, TDD, one file pair each' },
    { title: 'Verify', detail: 'type-check + depcruise + full vitest, bounded repair loop' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

// Shared constitution prepended to every implementation agent.
const RULES = `
You are implementing part of a feature in chronicles-ai, an onion-architecture
Next.js app. Working dir: ${SERVER} (all src paths are packages/server/src/...).

READ FIRST: ${ROOT}/docs/plans/starship-bounded-world-plan.md (the binding plan)
and ${ROOT}/CLAUDE.md (architecture + style rules). Read the actual files you edit
before editing — do not guess their contents.

ONION RULES (CI-enforced by dependency-cruiser — violations fail the build):
- domain/ imports NOTHING outward: no next, ai, @ai-sdk/*, better-sqlite3, mongoose,
  fs, fetch, or wall-clock. Deterministic, no I/O. domain/services are PURE functions.
- application/ may import only domain/. adapters import inward only. Never import lib/.
- Keep SQL/SDK/model-ids out of domain and application.

CODE STYLE (.claude/rules/code-style.md): 2-space indent, single quotes, NO semicolons,
trailing commas in multiline, named imports alphabetized (external -> internal -> relative),
const/let never var, explicit return types on every exported function, camelCase vars,
PascalCase types. Match the surrounding file's idiom exactly.

KEY FACTS (from a prior inventory — verify by reading):
- Migrations: packages/server/src/lib/migrations.ts. Pattern:
  type Migration = { version: number; name: string; up: (db: Database.Database) => void }.
  Latest existing version is 25. DDL must be idempotent (CREATE TABLE IF NOT EXISTS,
  guard ALTER ADD COLUMN against re-run — follow how existing migrations guard columns).
- Entities: packages/server/src/domain/entities/ — character.ts holds Place/Character/Scene,
  world.ts holds World, story.ts holds StoryThread + TimelineEvent, occupancy.ts, reverie.ts.
  There is likely an index.ts barrel — check and keep exports consistent.
- Ports: packages/server/src/domain/ports/ — one interface per file (e.g. place-repository.ts).
- Services: packages/server/src/domain/services/ — world-clock.ts exports worldTimeBand()
  and the WorldTimeBand type; characters carry daily_loop (JSON WorldTimeBand -> {activity, place?}).
- Tests: Vitest. Run ONE test file WITHOUT the depcruise pretest via:
    npx vitest run <path-to-test> --root ${SERVER}
  Look at an existing domain/services test to copy the test-file convention and location.

Make real edits with Write/Edit. Do NOT touch composition/container.ts, do NOT implement
any repository adapter, and do NOT run the full 'npm test' suite (a later stage does that).
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'testsPass', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    remainingFailures: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concise list of still-failing checks with the key error line each',
    },
    summary: { type: 'string', description: 'One paragraph on the state of the gates' },
  },
}

// ---------------------------------------------------------------------------
phase('Foundation')

const a1 = await agent(
  `${RULES}

TASK (P0 contracts — schema + types + ports). Implement ALL of:

1) Migrations in lib/migrations.ts (append as v26, v27, v28; idempotent):
   - v26 'bounded_spatial_mode': worlds.spatial_mode TEXT DEFAULT 'open';
     worlds.template_id TEXT; places.deck TEXT; places.layout_hint TEXT;
     CREATE TABLE place_connections (id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL
     REFERENCES worlds(id), from_place_id INTEGER NOT NULL REFERENCES places(id),
     to_place_id INTEGER NOT NULL REFERENCES places(id), kind TEXT,
     bidirectional INTEGER NOT NULL DEFAULT 1, created_at TEXT).
   - v27 'character_relationships': CREATE TABLE character_relationships
     (id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL REFERENCES worlds(id),
     from_character_id INTEGER NOT NULL REFERENCES characters(id),
     to_character_id INTEGER NOT NULL REFERENCES characters(id), kind TEXT,
     valence REAL NOT NULL DEFAULT 0, note TEXT, updated_at TEXT).
   - v28 'sim_timeline_provenance': add timeline_events.sim_tick INTEGER (nullable)
     and timeline_events.provenance TEXT NOT NULL DEFAULT 'turn'. NOTE: timeline_events.turn_id
     must become effectively nullable for sim events — inspect the existing timeline_events
     definition; if turn_id is NOT NULL, relax it (SQLite: recreate-table dance OR, if it is
     already nullable, leave it). Document what you did in a code comment.

2) Entity types in domain/entities/ (extend existing files, add to the barrel):
   - World: add spatial_mode ('open' | 'bounded') and template_id (string | null).
   - Place: add deck (string | null) and layout_hint (string | null).
   - TimelineEvent: add sim_tick (number | null) and provenance ('turn' | 'sim');
     make turn_id (number | null).
   - NEW: PlaceConnection { id, world_id, from_place_id, to_place_id, kind, bidirectional, created_at }.
   - NEW: CharacterRelationship { id, world_id, from_character_id, to_character_id, kind, valence, note, updated_at }.
   - NEW: DeckGraph — a plain adjacency type the pure services will share, e.g.
     type DeckGraph = { adjacency: Record<number, number[]> } (place id -> neighbor place ids).
     Put it in a sensible entities file and export from the barrel.

3) Ports in domain/ports/ (interfaces only, no impl). Follow the existing one-interface-per-file style:
   - place-connection-repository.ts: forWorld(worldId) read + a write to insert edges.
   - relationship-repository.ts: forWorld(worldId) read + upsert/update valence.
   - deck-plan-provider.ts: getTemplate(templateId) -> a DeckPlanTemplate value object
     (rooms with name/description/deck, edges, and crew-role slots). Define DeckPlanTemplate
     as a domain value type (no I/O).
   - drama-port.ts: generateBeat(input) -> a structured beat value (a co-located group +
     their relationships/threads in; a short structured event out). Interface only.
   - timeline-writer.ts: a write port to append a TimelineEvent (turn or sim provenance).
     FIRST check whether an existing seam already writes timeline_events (search infrastructure
     + application); if one exists, note it and add the minimal write method there instead of a
     redundant port. Report which you chose.

DO NOT implement adapters or Mongo models (next agent). DO NOT touch container.ts.
Run 'npm run type-check' (cd ${SERVER}) and fix type errors you introduced. Then STOP.

Return: the exact final TypeScript shapes of every new/changed type and port (so downstream
agents can rely on them), the list of files changed, and whether type-check passed.`,
  { label: 'P0: migrations+entities+ports', phase: 'Foundation' },
)

const a2 = await agent(
  `${RULES}

CONTEXT — a prior agent just added migrations v26-v28, new entities (PlaceConnection,
CharacterRelationship, DeckGraph), changed World/Place/TimelineEvent, and new ports. Its report:
---
${a1}
---

TASK (Mongo schema parity, P0). In infrastructure/persistence/mongo/models/ (likely index.ts),
add Mongoose schemas/models that MIRROR the new SQLite schema so PERSISTENCE=mongo stays at parity:
- place_connections, character_relationships collections.
- Add spatial_mode + template_id to the world model; deck + layout_hint to the place model;
  sim_tick + provenance to the timeline-event model and allow turn_id to be null.
Match the existing model file's conventions (read it first). Schema-only — no repository methods.
This must remain schema/no-behavior: do NOT wire repositories or container.

Run 'npm run type-check' (cd ${SERVER}); fix type errors you introduced. Return files changed
and whether type-check passed.`,
  { label: 'P0: mongo models', phase: 'Foundation' },
)

log(`Foundation done. mongo-models: ${a2.slice(0, 200)}`)

// ---------------------------------------------------------------------------
phase('Services')

// Pure, mutually-independent services. Each owns ONE impl file + ONE test file,
// imports only domain types (NOT each other), touches no barrel. TDD: test first.
const SERVICES = [
  {
    key: 'deck-graph',
    file: 'domain/services/deck-graph.ts',
    spec: `Pure deck-topology graph ops over PlaceConnection[]:
      - buildDeckGraph(connections: PlaceConnection[]): DeckGraph (honor bidirectional).
      - neighbors(graph, placeId): number[].
      - isConnected(graph, placeIds): boolean — every place reachable from any other (single component).
      - orphanRooms(graph, placeIds): number[] — places with no edges / unreachable.
      Test connectivity, orphan detection, bidirectional vs one-way edges, empty graph.`,
  },
  {
    key: 'npc-movement',
    file: 'domain/services/npc-movement.ts',
    spec: `Pure next-room resolution for one NPC per tick. Signature roughly:
      nextPlaceId(args: { dailyLoop, band: WorldTimeBand, currentPlaceId: number | null,
        neighborsOf: (placeId: number) => number[] }): number | null.
      Rule: target = the room the NPC's daily_loop assigns for this band; if already there or
      target unknown, stay; else step toward target — for the skeleton, if target is a neighbor
      go there, else go to target directly (teleport allowed for a tiny ship), but NEVER return a
      place that is not the current place, a neighbor, or the loop target. Do NOT import deck-graph;
      neighbors are injected. Test: routine drives movement, missing-loop stays put, null current place.`,
  },
  {
    key: 'colocation',
    file: 'domain/services/colocation.ts',
    spec: `Pure grouping of character positions into co-located groups:
      groupByPlace(positions: Array<{ characterId: number; placeId: number | null }>):
        Array<{ placeId: number; characterIds: number[] }> — drop null places, stable order,
        only groups with >= 2 are "co-located" (expose a helper coLocatedGroups(...) that filters to >=2).
      Test: singletons excluded from coLocatedGroups, multiple rooms, null places ignored.`,
  },
  {
    key: 'beat-gating',
    file: 'domain/services/beat-gating.ts',
    spec: `Pure predicate authorizing an LLM beat for a co-located group:
      shouldEmitBeat(args: { characterIds: number[], relationships: CharacterRelationship[],
        currentTick: number, lastBeatTick: number | null, cooldownTicks: number,
        tensionThreshold: number }): boolean.
      True only if (a) cooldown elapsed since lastBeatTick AND (b) some relationship among the
      group has |valence| >= tensionThreshold (tension OR strong bond). Pure, deterministic.
      Test: cooldown blocks, threshold blocks, both-satisfied emits, no-relationship group never emits.`,
  },
  {
    key: 'relationship-drift',
    file: 'domain/services/relationship-drift.ts',
    spec: `Pure valence-delta application from a beat outcome:
      applyDrift(rel: CharacterRelationship, delta: number): CharacterRelationship — clamp valence
      to [-1, 1], return a new object (no mutation). Plus driftFromOutcome(outcome: 'positive' |
      'negative' | 'neutral'): number mapping to a small signed delta. Test: clamping at both ends,
      immutability, outcome mapping.`,
  },
]

await parallel(
  SERVICES.map((s) => () =>
    agent(
      `${RULES}

TASK (TDD a single PURE domain service). Create EXACTLY two files and nothing else:
  - ${s.file}
  - its colocated test file (match the existing domain/services test naming/location — look at a
    sibling test first).

SPEC for ${s.key}:
${s.spec}

Process: (1) read the new entity types you depend on in domain/entities/ and world-clock.ts;
(2) write the test file FIRST with real fixtures; (3) run it (it should fail):
   npx vitest run <your-test-file> --root ${SERVER}
(4) implement ${s.file} as pure functions with explicit return types; (5) re-run until green.
Import ONLY domain types — do NOT import any other domain/services file, no barrels, no I/O.
Do NOT edit domain/services/index.ts or any barrel (a later agent does exports).

Return: the two file paths and your final 'npx vitest run' summary line (pass count).`,
      { label: `service:${s.key}`, phase: 'Services' },
    ),
  ),
)

// ---------------------------------------------------------------------------
phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.testsPass
}

const verifyPrompt = `${RULES}

TASK (integration + full verification gate). In order:
1) Wire up exports: if domain/services and/or domain/entities use an index.ts barrel, add the new
   services/types to it (alphabetized, matching style). This is the ONLY barrel edit allowed.
2) Run the three gates from ${SERVER} and capture results:
   - npm run type-check
   - npm run depcruise
   - npm test   (this runs depcruise via pretest then the full Vitest suite — boots SQLite,
     which exercises the new migrations on a fresh DB)
3) If anything fails, fix ONLY genuine integration issues you introduced (missing exports, type
   mismatches, a migration that does not apply cleanly). Do NOT weaken tests or suppress
   dependency-cruiser rules. Re-run the failing gate.

Report the structured result honestly — if a gate still fails after your fixes, set its flag false
and put the key error line in remainingFailures. Do not claim success you did not observe.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify+integrate', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

The verification gate is still failing. Failures:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE of each (do not weaken tests or suppress depcruise rules). Then re-run the
affected gate from ${SERVER} to confirm. Report what you changed.`,
    { label: `repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify#${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`Final gate: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} tests=${verify.testsPass}`)
return verify

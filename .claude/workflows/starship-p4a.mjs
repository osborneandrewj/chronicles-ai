export const meta = {
  name: 'starship-p4a',
  description: 'Make a bounded Starship world creatable + playable: scene/cursor write surface, CreateStarshipWorld orchestration, server action, distinct UI section',
  phases: [
    { title: 'WriteSurface', detail: 'SceneRepository.add + WorldRepository.setCursor (ports + sqlite + mongo)' },
    { title: 'Orchestration', detail: 'CreateStarshipWorld use case + fake-port unit test' },
    { title: 'ActionAndUI', detail: 'createStarshipWorldAction + distinct sky/cyan Starship section' },
    { title: 'Verify', detail: 'type-check + depcruise + full vitest + create-starship script proof' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are implementing P4a (make a bounded "starship" world creatable + playable) of the
starship feature in chronicles-ai, an onion-architecture Next.js 15 App Router app. Working
dir: ${SERVER} (src paths are packages/server/src/...).

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/starship-bounded-world-plan.md — section "P4a implementation spec
  (creatable + playable Starship — binding)" fixes every decision. Follow it exactly.
- ${ROOT}/CLAUDE.md — architecture + style.
Read the actual files you edit before editing.

P0-P3.1 ALREADY EXIST (committed). Relevant existing pieces — read for exact shapes:
- application/use-cases/seed-bounded-world.ts → seedBoundedWorld(input, deps) returns
  { worldId, placeIds, characterIds }. placeIds is in template.rooms order; the scout
  template's first room is the BRIDGE, so placeIds[0] is the Bridge place id.
- application/use-cases/simulate-world-forward.ts → simulateWorldForward({ worldId, ticks,
  cooldownTicks?, tensionThreshold? }, deps).
- infrastructure/world-gen/scout-template.ts → SCOUT_TEMPLATE_ID, and stub-crew-generator.ts
  + stub-drama-port.ts (for the offline verify script).
- domain/ports/scene-repository.ts (forWorld/activeForWorld — you ADD add), world-repository.ts
  (you ADD setCursor), character-repository.ts (forWorld/inPlace/add — REUSE add for the player).
- composition/container.ts → the Container wiring (decks, crewGenerator (Grok), drama (Haiku),
  timeline, worlds, places, placeConnections, characters, relationships, scenes, clock, ...).
- lib/opening-turn.ts → generateOpeningTurn(worldId, premise) (the existing open-world action
  uses it; the starship action may too — adapters MAY import lib).
- app/worlds/new/{QuickStartForm.tsx, actions.ts, CreateModeTabs.tsx} → the existing quick-start
  UI + actions to extend. lib/worlds.ts has createBoundedWorld + the existing createWorld scene
  insert pattern for reference.

ONION RULES (CI-enforced by dependency-cruiser): domain/ imports nothing outward; application/
use-cases import only domain/ (NO lib/, NO SQL/SDK/framework); adapters (app/, infrastructure/)
import inward only; wiring only in composition/container.ts. better-sqlite3 only under
persistence/sqlite/; mongoose only under persistence/mongo/. A Server Action is a driving
adapter — it MAY use the container + lib (like the existing createAndOpenWorld does).

CODE STYLE: 2-space, single quotes, NO semicolons, trailing commas multiline, alphabetized
named imports, explicit return types on exported functions. Functional React, "use client"
only when interactive. Match the existing files' idiom exactly.

VERIFY locally (cd ${SERVER}): npm run type-check, npm run depcruise, npx vitest run <path> --root ${SERVER}.
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'testsPass', 'createProved', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    createProved: {
      type: 'boolean',
      description: 'Whether the create-starship script built a bounded world with a player on the Bridge, an active scene, a set cursor, and crew',
    },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
phase('WriteSurface')

const s1 = await agent(
  `${RULES}

STAGE 1 — scene/cursor write surface (per the plan's P4a spec). Implement ALL:

1) SceneRepository.add({ world_id, place_id, title, scene_number, status }): Promise<{ id: number }>
   — port (domain/ports/scene-repository.ts) + SQLite adapter + Mongo adapter. status is a string
   ('active'). Mirror how the P1 place/character add methods delegate (look at lib/worlds.ts'
   insertSceneStmt for the SQLite column shape: scenes(world_id, place_id, title, scene_number,
   status, updated_at)).
2) WorldRepository.setCursor(worldId: number, sceneId: number): Promise<void> — port + SQLite +
   Mongo. Sets worlds.current_scene_id = sceneId (UPDATE ... WHERE id = worldId). Do NOT touch
   world_time (the sim already set it). lib/worlds.ts has a setWorldCursorStmt for reference but
   add a current_scene_id-only setter.

TESTS: extend an existing SQLite adapter test (in-memory DB, migrations run) — scenes.add inserts
a row readable as the active scene; worlds.setCursor sets current_scene_id (read it back via the
cursor reader).

Run type-check + depcruise + your tests. Do NOT touch container.ts/UI yet.
Return new signatures, files changed, gate results.`,
  { label: 'P4a: scene.add + setCursor', phase: 'WriteSurface' },
)

// ---------------------------------------------------------------------------
phase('Orchestration')

const s2 = await agent(
  `${RULES}

Stage 1 (write surface) done. Report:
---
${s1}
---

STAGE 2 — CreateStarshipWorld use case (application/use-cases/create-starship-world.ts), per the
plan's P4a spec. PURE orchestration — deps injected, no SQL/SDK/lib. It composes the existing
seed + sim use cases and the write ports.

Input: { templateId: string, name: string, premise: string, playerName?: string, ticks?: number }
(default ticks = SIM_TICKS = 12).
Deps: everything seedBoundedWorld + simulateWorldForward need (decks, crew, worlds, places,
placeConnections, characters, relationships, drama, timeline, clock) PLUS scenes: SceneRepository.

Flow:
- const seeded = await seedBoundedWorld({ templateId, name, premise, playerName }, deps)
- await simulateWorldForward({ worldId: seeded.worldId, ticks }, deps)  // real Haiku in prod
- const bridgePlaceId = seeded.placeIds[0]  // scout template room 0 = Bridge (comment this)
- const player = await characters.add({ world_id, name: playerName?.trim() || 'Newcomer',
    description: 'A newcomer just come aboard — name not yet established.', is_player: 1,
    current_place_id: bridgePlaceId, role: null, active_goal: null, daily_loop: null })
- const scene = await scenes.add({ world_id, place_id: bridgePlaceId, title: 'Arrival',
    scene_number: 1, status: 'active' })
- await worlds.setCursor(worldId, scene.id)
- return { worldId, sceneId: scene.id, playerId: player.id }

TEST with IN-MEMORY FAKE ports (or compose with the real stubs where simpler): assert it seeds a
bounded world, runs the sim (ticks passed through), creates exactly one player (is_player=1) on
the Bridge place, one active scene, and sets the cursor to that scene. Use the StubCrewGenerator +
StubDramaPort (no spend) if wiring real-ish fakes is easier than hand fakes.

Run type-check + depcruise + your test. Do NOT touch container.ts/UI yet.
Return the use-case signature + deps, files changed, gate results.`,
  { label: 'P4a: CreateStarshipWorld use case', phase: 'Orchestration' },
)

// ---------------------------------------------------------------------------
phase('ActionAndUI')

const s3 = await agent(
  `${RULES}

Stages 1-2 done. Stage 2 report:
---
${s2}
---

STAGE 3 — the server action + the distinct UI section.

1) app/worlds/new/actions.ts → add createStarshipWorldAction(prev, formData): Promise<CreateWorldFormState>.
   - Parse playerName (optional, like createBasicWorldAction).
   - Build CreateStarshipWorld from getContainer() (real Grok crewGenerator + Haiku drama). Use a
     fixed scout premise constant (a lone scout vessel on a long survey arc; crew sealed in
     together; tensions simmering) and name (e.g. 'Scout Vessel').
   - try: const { worldId } = await createStarshipWorld({ templateId: SCOUT_TEMPLATE_ID, name,
     premise, playerName, ticks: 12 }, deps); await generateOpeningTurn(worldId, premise);
     redirect('/worlds/{worldId}/play'). (redirect throws — keep it last.)
   - catch (non-redirect errors): console.error + return { error: "Couldn't launch the ship — try
     again." }. NOTE: Next's redirect() throws a special error you must NOT swallow — rethrow it
     (check isRedirectError from 'next/navigation' OR structure try/catch so redirect is outside it).

2) UI — a DISTINCT, visually-set-apart section (per the plan: sky/cyan accent vs the amber genre
   grid). Implement as a sibling client component (e.g. app/worlds/new/StarshipLaunch.tsx) so it
   has its own useActionState(createStarshipWorldAction) + pending + error, and render it ABOVE the
   genre grid inside the Quick start tab. Share the player name: lift it — simplest is to give the
   Starship section its own compact optional name input, OR read the same name. Keep it self-
   contained with its own <form>.
   Visual spec (match the app's idiom — rounded-xl, borders, the existing class vocabulary — but a
   DIFFERENT hue): a card with a sky/cyan border + faint sky bg tint (e.g. border-sky-500/40
   bg-sky-500/[0.07]), a small uppercase sky label like "Living world · experimental", a title
   "Starship", a one-line serif/neutral description "A crewed scout ship, already in motion before
   you board.", and a sky Launch button (bg-sky-500/90 text-neutral-950 hover:bg-sky-400) reading
   "Launch the scout" / pending "Launching your ship…". An error surfaces in the existing red style.
   Keep it accessible (button, focus-visible ring). Wire it into CreateModeTabs/QuickStartForm so it
   shows in the Quick start tab, clearly separated (a divider or its own section heading) from the
   "Generate world" genre flow below.

Run type-check + depcruise. Return files changed + a short note on exactly where the Starship
section renders + its classes.`,
  { label: 'P4a: action + Starship UI', phase: 'ActionAndUI' },
)

log(`Action+UI: ${s3.slice(0, 240)}`)

// ---------------------------------------------------------------------------
phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.testsPass && v.createProved
}

const verifyPrompt = `${RULES}

STAGE 4 — verification. Write scripts/create-starship.mjs (mirror scripts/seed-ship.mjs's
temp-DB-before-import + --conditions=react-server --tsconfig invocation header) that builds the
SQLite container, constructs CreateStarshipWorld with the StubCrewGenerator + StubDramaPort (NO
spend), runs it (ticks=12), then reads back and ASSERTS (exit non-zero on failure): the world is
spatial_mode='bounded'; exactly one is_player=1 character exists and sits in the Bridge; an active
scene exists; worlds.current_scene_id points at it; >=3 crew exist; world_time was set by the sim.
Print a summary + an "OK: created a playable starship (world #N)" line. (It must NOT call the
opening turn / real Grok — that is browser-verified.)

Then run the gates in order (cd ${SERVER}, repo root for the script):
1) npm run type-check
2) npm run depcruise
3) npm test  (full Vitest incl. new P4a adapter + use-case tests)
4) node/tsx the create-starship script and confirm the OK line.

Fix ONLY genuine issues you introduced (no weakening tests, no suppressing depcruise). Report
honestly — createProved only true if you saw the OK line this run.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify P4a', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

The P4a verification gate is failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE of each (no weakening tests, no suppressing depcruise). Re-run the affected
gate (and the create-starship script if relevant). Report what you changed.`,
    { label: `P4a repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify P4a #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`P4a final gate: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} tests=${verify.testsPass} create=${verify.createProved}`)
return verify

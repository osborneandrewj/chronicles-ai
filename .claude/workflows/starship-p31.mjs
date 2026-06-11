export const meta = {
  name: 'starship-p31',
  description: 'Beat memory: feed recent ship-wide beats into DramaPort so the Haiku beat generator advances instead of repeating',
  phases: [
    { title: 'Implement', detail: 'DramaBeatInput.recentBeats + use-case rolling window + prompt + stub + tests' },
    { title: 'Verify', detail: 'type-check + depcruise + full vitest + sim-ship plumbing proof' },
  ],
}

const ROOT = '/Users/adeptus-mechanicus/Projects/chronicles-ai'
const SERVER = `${ROOT}/packages/server`

const RULES = `
You are adding "beat memory" to the bounded-starship forward sim in chronicles-ai, an
onion-architecture Next.js app. Working dir: ${SERVER} (src paths are packages/server/src/...).

WHY (from a live smoke test): the Haiku DramaPort regenerated the SAME conflict 6/8 beats
because it never saw prior beats. The repeated conflict spanned DIFFERENT rooms, so the
memory must be GLOBAL (ship-wide), not per-room.

READ FIRST AND TREAT AS BINDING:
- ${ROOT}/docs/plans/starship-bounded-world-plan.md — section "P3.1 — beat memory".
- ${ROOT}/CLAUDE.md — architecture + style.
Read the actual files you edit before editing.

RELEVANT EXISTING FILES (read for exact shapes):
- domain/ports/drama-port.ts — DramaBeatInput / DramaBeat. You ADD recentBeats to DramaBeatInput.
- application/use-cases/simulate-world-forward.ts — builds DramaBeatInput + calls drama.generateBeat
  inside the per-tick co-located-group loop. You thread a rolling recentBeats window here.
- infrastructure/world-gen/haiku-drama-port.ts — builds the prompt; include recentBeats.
- infrastructure/world-gen/stub-drama-port.ts — must still satisfy the interface (accept the field).
- prompts/drama-beat.md — the system prompt; add the anti-repetition instruction.
- tests/simulate-world-forward.test.ts + tests/stub-drama-port.test.ts — update for the new field.

ONION RULES (CI-enforced): domain/ imports nothing outward; application imports only domain/
(no SQL/SDK/lib); adapters import inward only; wiring only in container.ts. Model IDs only from
infrastructure/llm/.

CODE STYLE: 2-space, single quotes, NO semicolons, trailing commas multiline, alphabetized
named imports, explicit return types on exports. Match siblings.

VERIFY locally (cd ${SERVER}): npm run type-check, npm run depcruise, npx vitest run <path> --root ${SERVER}.
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typecheckPass', 'depcruisePass', 'testsPass', 'plumbingProved', 'remainingFailures', 'summary'],
  properties: {
    typecheckPass: { type: 'boolean' },
    depcruisePass: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    plumbingProved: {
      type: 'boolean',
      description: 'Whether sim-ship.mjs still runs green AND a test asserts recentBeats is threaded into generateBeat',
    },
    remainingFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

phase('Implement')

const impl = await agent(
  `${RULES}

TASK — add beat memory (per the plan's P3.1 section). Implement ALL:

1) domain/ports/drama-port.ts: add \`recentBeats: string[]\` to DramaBeatInput (a doc comment:
   the last few ship-wide beats as "title: summary", so the generator can advance instead of
   repeating). Most-recent-last ordering.

2) application/use-cases/simulate-world-forward.ts: maintain a rolling \`const recentBeats:
   string[] = []\` across the WHOLE run (ship-wide, not per room). When a beat is about to be
   generated, pass \`recentBeats: recentBeats.slice(-RECENT_BEATS_WINDOW)\` (define
   RECENT_BEATS_WINDOW = 5) in the DramaBeatInput; AFTER the beat returns, push
   \`\${beat.title}: \${beat.summary}\` onto recentBeats. Keep everything else identical.

3) infrastructure/world-gen/haiku-drama-port.ts: when input.recentBeats is non-empty, add a
   section to the user prompt listing them under a clear header (e.g. "ALREADY HAPPENED (do not
   repeat — advance the situation):"). No change when empty.

4) prompts/drama-beat.md: add an instruction that any beats listed as already-happened must NOT
   be restated; the new beat should advance, escalate, resolve, or shift focus to a different
   dynamic among the participants.

5) infrastructure/world-gen/stub-drama-port.ts: ensure it still satisfies the interface (the
   new field is on the INPUT, so the stub just ignores it — confirm it compiles, no behavior change).

6) Tests: update tests that build a DramaBeatInput or a fake DramaPort. In
   tests/simulate-world-forward.test.ts, make the fake DramaPort RECORD each call's
   input.recentBeats, and add an assertion that when two beats fire in a run, the SECOND beat's
   generateBeat call received the FIRST beat's "title: summary" in recentBeats (proving the
   rolling window threads through). Update tests/stub-drama-port.test.ts if it constructs a
   DramaBeatInput (add recentBeats: []).

Run type-check + depcruise + the affected tests. Return the new DramaBeatInput shape, files
changed, and gate results.`,
  { label: 'beat memory', phase: 'Implement' },
)

log(`Implement: ${impl.slice(0, 200)}`)

phase('Verify')

function allPass(v) {
  return v && v.typecheckPass && v.depcruisePass && v.testsPass && v.plumbingProved
}

const verifyPrompt = `${RULES}

VERIFICATION GATE. In order (cd ${SERVER}, repo root for the script):
1) npm run type-check
2) npm run depcruise
3) npm test  (full Vitest; must include the new recentBeats-threading assertion in
   tests/simulate-world-forward.test.ts)
4) Re-run the offline plumbing proof (stub drama, no spend): npx tsx --conditions=react-server
   --tsconfig packages/server/tsconfig.json packages/server/scripts/sim-ship.mjs against a fresh
   temp DB; confirm it still prints its OK line (the stub is deterministic so beat TEXT won't
   vary — this only confirms the recentBeats plumbing didn't break the sim).

Fix ONLY genuine issues you introduced (no weakening tests, no suppressing depcruise). Report
honestly — plumbingProved true only if both the sim-ship OK line printed AND the test suite
includes a passing assertion that recentBeats is threaded into the second beat's input.`

let verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: 'verify beat memory', phase: 'Verify' })

let rounds = 0
while (!allPass(verify) && rounds < 2) {
  log(`Verify round ${rounds + 1} failing: ${verify.remainingFailures.join(' | ')}`)
  await agent(
    `${RULES}

The gate is failing:
${verify.remainingFailures.map((f) => `- ${f}`).join('\n')}

Fix the ROOT CAUSE (no weakening tests, no suppressing depcruise). Re-run the affected gate.
Report what you changed.`,
    { label: `repair#${rounds + 1}`, phase: 'Verify' },
  )
  verify = await agent(verifyPrompt, { schema: VERIFY_SCHEMA, label: `verify #${rounds + 2}`, phase: 'Verify' })
  rounds++
}

log(`P3.1 final gate: typecheck=${verify.typecheckPass} depcruise=${verify.depcruisePass} tests=${verify.testsPass} plumbing=${verify.plumbingProved}`)
return verify

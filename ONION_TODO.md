# Onion Architecture Refactor — Progress Tracker

Living checklist for the refactor specified in [`ONION_ARCH_REFACTOR.md`](./ONION_ARCH_REFACTOR.md).
**Branch:** `onion-arch-refactor` (preview branch — may be discarded).

> **For agents:** Read the matching section of `ONION_ARCH_REFACTOR.md` before editing. After completing a
> checklist item, change its `[ ]` to `[x]` and append a one-line note `— <what/where>`. After each phase,
> run the phase **Gate** and record the result in the Status Log at the bottom. Never mark a box `[x]`
> until its gate command actually passes — paste the real output, don't assert.

## Status legend
`[ ]` not started · `[~]` in progress · `[x]` done & gate-verified · `[!]` blocked / needs Andrew

## Baseline (captured 2026-06-04, before any move)
- `npm run type-check` → clean
- `npm test` → **33 files / 323 tests pass**, ~2.3s
- These are the regression reference for every "no behavior change" phase (P0, P1, P4, P5).

---

## Phase order & dependency spine
`P0 → P1 → {P2 → P3}  ∥  {P4 → P5 → P6} → P7`
P2/P3 (Mongo) and P4/P5/P6 (carve+split) can run in parallel **after P1**.

| Phase | Goal | Behavior change | Autonomous? |
|---|---|---|---|
| P0 | Monorepo skeleton, no logic moved | No | ✅ |
| P1 | Repository ports over SQLite (strangler-fig) | No | ✅ |
| P2 | Mongo + Mongoose adapter behind flag (default off) | No | ✅ (code only) |
| P3 | Backfill + dual-read verify + **prod cutover** | Storage | ❌ **manual gate** (prod DB + hosting decision) |
| P4 | Carve domain services out of god files | No | ✅ |
| P5 | Thin `chat/route.ts` into `AdvanceTurn` | No | ✅ |
| P6 | Extract client into `apps/web` + `packages/contracts` | Topology | ✅ |
| P7 | CI boundary enforcement; **delete SQLite** | No | ⚠️ tooling ✅ / deletion ❌ (after P3 soak) |

---

## P0 — Monorepo skeleton (no logic moves)
Spec: §2.3, §5.1-P0. **Goal:** move the app under `packages/server` verbatim; stand up workspaces; keep build/test green.

- [x] Root `package.json`: `"workspaces": ["packages/*", "apps/*"]`, `private: true`, root scripts delegate to workspaces — root scripts now `npm -w @chronicles/server run <x>`; app deps moved out of root
- [x] `tsconfig.base.json` at root with shared compilerOptions (`composite`, `declaration`, strict, bundler resolution) — created at repo root; server tsconfig `extends` it
- [x] Move `src/`, `tests/`, `prompts/`, `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, tailwind/postcss config → `packages/server/` — `git mv` (renames, history preserved); also `scripts/`, `next-env.d.ts`, `tsconfig.json`
- [x] `packages/server/package.json` (`@chronicles/server`) with current deps; `@/*` alias → `packages/server/src/*` (unchanged for now) — name `@chronicles/server` v0.6.21; `@/* → ./src/*` retained in server tsconfig
- [x] Fix cwd coupling: `prompt-files.ts` + `db.ts` resolve via `import.meta.url`, not `process.cwd()` (prereq for everything after) — `path.dirname(fileURLToPath(import.meta.url))` (the `new URL(literal, import.meta.url)` form broke `next build` by webpack-rewriting the .sqlite/.md into asset modules); `DATABASE_PATH` override + `NEXT_PHASE` `:memory:` guard preserved; verified from a foreign cwd
- [x] Keep `serverExternalPackages: ['better-sqlite3']` in server `next.config.ts` — moved verbatim, intact
- [x] Document version-of-record (still `packages/server/package.json` until P6) — v0.6.21 lives in `packages/server/package.json`; `src/app/page.tsx` (now `packages/server/src/app/page.tsx`) still reads its `pkg.version`
- **Gate:** `npm run build && npm test && npm run type-check` green from repo root via workspace scripts. — type-check clean; `npm test` 33 files / 323 tests (322 pass, 1 pre-existing skip); `npm run build` succeeds (benign "TypeScript project references not fully supported" warning, falls back to incremental)

## P1 — Repository ports over SQLite (strangler-fig)
Spec: §3.4, §5.1-P1. **Highest-leverage, lowest-risk. Must precede Mongo.** Wrap SQL only — do NOT extract decisions (that's P4).

- [x] Define `domain/ports/`: all 14 ports + Clock + Logger present in `packages/server/src/domain/ports/` (`index.ts` barrel)
- [x] **All ports `async`** — every method returns a `Promise`; SQLite adapters wrap sync calls in `Promise.resolve`
- [x] `TurnRepository` is append-only: `insert`/`recentTurns`/`turnsBefore`/`latestUserTurnId` + `mergeMetadata(turnId, agentKey, block)` + `incTtsChars(worldId, turnId, n)`; **no general `update`/`setMetadata`** — verified in `domain/ports/turn-repository.ts`
- [x] `Clock` port present (`now()`/`today()`); `cost-cap` reads today via `clock.today()`. `[~]` remaining `datetime('now')` is still emitted inside the SQLite adapter/db.ts (allowed per spec §5.1-P1 — interface exists; full app-level routing is incremental)
- [x] Single SQLite impl in `infrastructure/persistence/sqlite/` implementing all ports (14 `*.sqlite.ts` + unit-of-work)
- [x] `composition/container.ts` wires adapters (the only infra importer)
- [~] Migrate `import { db }` / named-fn importers off `@/lib/db` — **partial.** Done: `cost-cap.ts` (fully strangled → container). Migrated route handlers from prior P0/P1 work (turns/usage/tts/world-correction(s)/play page) use the container. **Remaining VALUE importers** (SQL-owning lib modules whose SQL is already wrapped behind adapters that delegate to them, + the P5 god endpoint): `archivist.ts`, `intent-reconciler.ts`, `meta-commands.ts`, `npc-agent.ts`, `npc-intents.ts`, `npc-promotion.ts`, `opening-turn.ts`, `place-resolver.ts`, `reveries.ts`, `world-state.ts`, `worlds.ts`, `app/api/chat/route.ts`. Type-only db.ts imports remain in ports + a few libs (row types live in db.ts until P4 moves them to `domain/entities/`).
- [x] `cost-cap.ts` `SUM(json_extract(...))` → `UsageRepository.todaysTokenTotal(clock.today())` (SQL lives in `usage-repository.sqlite.ts`); `cost-cap.ts` now imports the container, not `db` — fully strangled. Callers (`chat/route.ts`, `opening-turn.ts`, `cost-cap.test.ts`) made async.
- [x] `import "server-only"` on every infra/repo module + container (verified present)
- [~] **Gate:** full suite green (323). Guard-grep test NOT added — strangling is not complete (SQL-owning lib modules + the chat god endpoint still import `db`), so the `zero @/lib/db outside sqlite` invariant does not yet hold. Adding the guard now would fail. Deferred until the remaining importers land (overlaps P4 SQL-relocation + P5 AdvanceTurn carve).

## P2 — Mongo + Mongoose adapter behind a flag
Spec: §4 (whole), §5.1-P2. Default `PERSISTENCE=sqlite`. Mongoose forbidden outside `infrastructure/persistence/mongo/`.

- [ ] Add `mongoose` dep to `packages/server`
- [ ] `infrastructure/persistence/mongo/connection.ts` (replica-set guard + build-phase no-op replacing `NEXT_PHASE :memory:`)
- [ ] Mongoose models for 15 top-level collections + 2 embedded subdocs (§4.2); enums for CHECKs, `min/max` ranges, `nameKey`/`titleKey` normalized unique indexes
- [ ] `counters` collection + atomic `$inc` for monotone turn `seq` (§4.5) — never `ObjectId` for ordering
- [ ] `TurnRepository` mongo impl: append-only; `mergeMetadata` via `$set` nested path, `incTtsChars` via `$inc` (§4.4) — never clobber
- [ ] `UnitOfWork` mongo impl via `session.withTransaction`; fail-fast at boot if no replica set
- [ ] Port the **prune** logic (npc_reveries cap 3, occupancy retention) into the use-case-run transaction, not just inserts
- [ ] Composition-root selection: `PERSISTENCE=sqlite|mongo` (default sqlite)
- [ ] `MemoryRepository.searchSimilar` port + no-op `[]` adapter (Phase-2 vector slot, §4.8)
- **Gate:** full Vitest suite passes with `PERSISTENCE=mongo` against `MongoMemoryReplSet`; default run still sqlite & green.

## P3 — Backfill, dual-read verify, cutover  ❌ MANUAL GATE
Spec: §4.9, §5.1-P3. **Touches prod DB + needs a hosting decision. Autonomous work = scripts only; execution is Andrew's.**

- [ ] **[code]** `scripts/migrate-sqlite-to-mongo.ts` (idempotent; integer `turns.id`→`seq`; seed `counters`; `createIndexes()` after bulk insert)
- [ ] **[code]** `scripts/verify-parity.ts` (row counts, `MAX(seq)` parity, sampled deep-equal incl. `getFullWorldState`)
- [ ] `[!]` **Andrew:** choose Mongo hosting — Atlas vs Railway single-node replica set (Open Q #2; transactions + future `$vectorSearch` depend on it)
- [ ] `[!]` **Andrew:** back up `/data/chronicles.sqlite` (+wal/shm) from prod via `railway ssh`
- [ ] `[!]` **Andrew:** run backfill against backup → run parity script until clean
- [ ] `[!]` **Andrew:** quiet-window cutover: tail backfill, flip `PERSISTENCE=mongo`, redeploy, smoke a streamed turn
- **Gate:** parity script clean on prod snapshot; one turn streams end-to-end on Mongo in browser. Rollback = flip env back + redeploy.

## P4 — Carve domain services out of the god files
Spec: §3.3, §5.1-P4, §5.2. **Characterization tests FIRST** (archivist ordering has prod-bug history).

- [x] Characterization tests for `NameResolution` / `SceneTransition` / `applyArchivistPatch` ordering (golden patches → expected merge plans), seeded from known prod-bug scenarios — `tests/name-resolution.test.ts` (20 golden-rule tests: Marcus⊂Marcus Reeves, Jordana freshest, descriptor reveal via aliases, generic-room→residential) + `tests/scene-transition.test.ts` (8 decisions seeded from world-13 teleport + Call-In turn-403 home-flip); the pre-existing `archivist.test.ts` already pins `applyArchivistPatch` ordering + merge outcomes end-to-end and stayed byte-green through every extraction
- [x] **Row TYPE defs → `domain/entities/`** (P4 foundation, step 1) — World/Turn+metadata/Character/Place/Scene/Story*/NpcIntent/Reverie/Occupancy/Usage/TtsCache/Correction now in `domain/entities/*`; 6 ports re-pointed off `@/lib/db` → `@/domain/entities` (last domain→infra type leak gone); `db.ts`/`world-state.ts`/`worlds.ts`/`npc-intents.ts`/`reveries.ts` re-export for back-compat
- [x] **Low-risk drop-in moves first** (zero behavior change) — `ReverieFlare`(reverie-flare.ts), `WorldClock`(world-clock.ts), `OccupancySim`(occupancy-sim.ts), `CharacterDedup`(character-dedup.ts), `MemorableFactProvenance`, `StorySignal`, `ActionClassifierRules`(action-classifier-rules.ts), `TurnNumbering`(turn-numbering.ts), + `narrator-guidance.ts` (moved as-is) → `domain/services/`. Split files keep CRUD/I-O (reveries) + orchestrator (place-population `buildPlaceOccupancySnapshot`) + LLM fallback (classifier, rules-first preserved) behind. Old `@/lib/*` modules re-export moved members. `domain/` imports none of the forbidden modules; `character-dedup` still imports pure `@/lib/character-identity` (not banned).
- [x] `model-registry.ts` consolidation — `infrastructure/llm/model-registry.ts` (server-only) is now the sole home for `NARRATOR_MODEL='grok-4.3'` + `HAIKU_MODEL='claude-haiku-4-5-20251001'`; `pricing.ts` moved to `infrastructure/llm/pricing.ts` (server-only, RATES keyed by registry consts); `lib/pricing.ts` slimmed to client-safe `formatUsd`; `turn-cost.ts` reads cost math from infra; all 8 call sites (6 Haiku agents + 2 narrator) import from the registry — zero model-ID literals remain outside it. Production build verified (server-only does not leak into Chat.tsx).
- [x] `PatchSanitizer` (sanitize + transition guards + transit normalize + deterministic patch) → pure domain service — `domain/services/patch-sanitizer.ts` (`sanitizeArchivistPatch`, `extractDeterministicPatch`, `normalizeTransitPlaceName`/`normalizeTransitPlacesInPatch` + all pure helpers); purest, moved first (commit `68ff9d1`). `archivist.ts` imports + re-exports for back-compat. No I/O.
- [x] `SceneTransition` invariant → returns open/close **intents**, not UPDATEs — `domain/services/scene-transition.ts` `decideSceneTransition()` returns a `SceneTransitionIntent {placeId, reason, priorScenePlaceId}` | null; the txn reads scene/player place ids, asks the pure service, applies the intent (auto-close→open "Arriving at …"→drag player). Own commit `9155971` (separate from merge path, Open-Q#5). Both warn payloads preserved.
- [~] `NameResolution` (resolve/merge/alias/freshest) → returns a **MergePlan**, issues no SQL — **PARTIAL** (commit `d02d951`): the pure deciding RULES are extracted to `domain/services/name-resolution.ts` (`placesMatch`/`charactersMatch`/`isAmbiguousCharacterMatch`/`freshest`/`chooseLonger`/`mergeLineBlocks`/`strongest*`/`maxNullable`/`filterAliasesAgainstName`/`findCharacterByNameOrAlias`/`canonicalCharacterKey` + word sets), no SQL. **DEFERRED:** the full "return a MergePlan {canonicalId, mergeOps, aliasUpdates}, issue no SQL" carve — `resolveCharacter`/`mergeCharacters`/`runAliasMerges`/`mergePlaces` still issue UPDATE/DELETE/RETURNING **mid-loop** inside the 370-line `applyArchivistPatch` txn (they read rows fresh per call to see same-patch writes). Converting to a returned-plan requires the use case to load-all → simulate → apply, which is the P5 `AdvanceTurn` rewrite of the fused transaction (prod-bug history). Reverting risk > reward on a "no behavior change" pass; staged for P5. See itemsRemaining.
- [~] `NpcPromotion` tiering → returns write commands from a snapshot — **PARTIAL** (commit `7005a41`): pure tiering RULES extracted to `domain/services/npc-promotion.ts` (`nextAgencyTier`, `isTransientServiceNpc`, `AUTO_PROMOTE_THRESHOLD`), no SQL. **DEFERRED:** `recordAppearancesAndAutoPromote` still issues per-character bump/promote/demote UPDATEs interleaved with the tier decision inside one txn; the "snapshot → command list the use case applies" carve is the same fused-transaction rewrite as NameResolution, staged for P5.
- [x] Narrator-markdown renderers (`formatStateBlock`/`formatDossierBlock`/...) → `server/render`, NOT domain — `src/server/render/state-block.ts` (`formatStateBlock`/`formatDossierBlock`/`formatOccupancyBlock`/`formatPlaceGeo` + private helpers + `NpcPlannedAction`/`ReverieRenderContext` types). `server-only`; `world-state.ts` re-exports. Commit `f3e06ff`. Build verified (no client bundle leak).
- [ ] (deferred PR) Generalize overfit `minerva/caesar/maya/usace` constants — behavior change, separate PR
- **Gate:** characterization tests + full suite green; no behavior change vs baseline.

## P5 — Thin `chat/route.ts` into `AdvanceTurn`
Spec: §3.5, §5.1-P5. **Preserve fail-open vs fail-closed semantics and the `dbTurnId` flush ordering.**

- [ ] `application/use-cases/AdvanceTurn.ts`: `execute({worldId, playerText})` → `NarrationStream { chunks, completion }` (no framework `onFinish` in app code)
- [ ] ~20 captured closure vars → explicit use-case state
- [ ] Pre-stream fail-closed gates → domain errors (WorldNotFound→404, EmptyAction→400, BudgetExceeded→429)
- [ ] Post-stream work stays **best-effort** (`console.error`+continue): reconciler, archivist, promotion, dedup, reverie — do NOT convert to hard errors
- [ ] SIGTERM in-flight-archivist drain → `BackgroundTasks` port in composition root
- [ ] `chat/route.ts` → thin adapter: parse → `AdvanceTurn` → pipe `chunks` → append `dbTurnId` after `completion`
- [~] Repeat thin-adapter treatment: `world-correction→ApplyCorrection`, `turns→LoadHistory`, `world-state→InspectWorld`, `usage→SummarizeUsage`, `tts→SynthesizeNarration`, `tts/record→RecordTtsUsage`, corrections list — **P5 part 1 DONE for the lower-risk routes:** `turns→LoadHistory`, `usage→SummarizeUsage`, `world-state→InspectWorld`, `world-corrections→ListCorrections`, `tts→SynthesizeNarration` (+ new `SpeechSynthesizer` port + `XaiSpeechSynthesizer` infra adapter + container wiring), `tts/record→RecordTtsUsage`, `world-correction→ApplyCorrection` (PARTIAL — orchestration carved; the fused `applyArchivistPatch` merge txn + LLM extractor injected as route-wired fns, staged for AdvanceTurn). All in `application/use-cases/`; `application/` imports `@/domain/*` + `node:crypto` only (grep clean — no SQL/SDK/next/lib/infra). `chat→AdvanceTurn` is P5 part 2.
- [ ] Use-case tests against in-memory fake repos + `FakeClock`; assert archivist-throws → turn still persists
- **Gate:** full suite green; streamed turn end-to-end in browser; integration test asserts `dbTurnId` metadata part arrives last.

## P6 — Extract client into `apps/web` + `packages/contracts`
Spec: §2.4-§2.8, §5.1-P6. Client carries **no onion concern**.

- [ ] `packages/contracts` (`@chronicles/contracts`, dep: zod only): `WorldStateDTO`, `TurnCostDTO/AgentCostDTO/TtsCostDTO`, `CorrectionDTO`, `OlderResponseDTO/OlderTurnDTO`, `ChatRequestSchema`, `MessageMetadata{dbTurnId}`
- [ ] `packages/contracts/src/pure/sentence-splitter.ts` — shared, byte-identical client↔server (TTS cache correctness)
- [ ] `apps/web` (Next.js, React, Tailwind, `@ai-sdk/react`): move `Chat.tsx`, `WorldInspector.tsx`, `useNarratorAudio.ts`, pages, route handlers (thin)
- [ ] Move cost/pricing fully server-side; server ships pre-computed `TurnCostDTO`; client keeps only `formatUsd`
- [ ] Move render-only domain server-side: `deriveCharacterBadges/deriveSceneBadge`, `organizePlayerProfileFacts`, `[t:N]` `parseStateEntry` → DTO ships ready-to-render fields
- [ ] Re-express SQL-reading Server Components (`play/page.tsx`, `page.tsx`) + Server Actions (`worlds/new/actions.ts`) as HTTP endpoints (`POST /api/worlds`, …)
- [ ] Per-package tsconfigs + project references; drop root `@/*` alias (codemod gated on type-check+vitest)
- [ ] Version-of-record decision: `apps/web/package.json` is the UI header source (Open Q #6)
- **Gate:** `tsc --build` green across packages; streamed turn in browser; no `'use client'` file imports anything but `@chronicles/contracts`.

## P7 — Enforce boundaries in CI; delete SQLite
Spec: §2.5, §3.7, §5.1-P7.

- [ ] `.dependency-cruiser.cjs` at root with the §2.5 forbidden ruleset; run in CI
- [ ] Guard-grep tests: model-ID literal outside `infrastructure/llm/`; merge/name-resolution under `infrastructure/`; `mongoose` outside mongo adapter; `db.prepare`/raw-handle outside a repo
- [ ] `import "server-only"` on every infra module + route handler
- [ ] `[!]` **after P3 prod soak:** delete SQLite adapter + `migrations.ts` + `better-sqlite3` dep; drop `serverExternalPackages`
- **Gate:** dependency-cruiser + guard tests pass in CI; (deferred) build green with SQLite removed.

---

## Open decisions for Andrew (from spec §"Open Questions")
1. `[!]` Topology A (in-process route handlers) vs B (standalone server) — recommend **A** unless CDN-hosted client planned.
2. `[!]` **Mongo hosting: Atlas vs Railway replica set** — highest-stakes, blocks P3. Recommend Atlas if Phase-2 memory/vector search is on the horizon.
3. `[!]` Embeddings store (coupled to #2) — port + no-op adapter ship now regardless.
4. `[!]` Confirm npm workspaces (recommended); Turborepo deferred.
5. `[!]` Archivist carve aggressiveness — recommend staging; don't extract merge path + scene path in one PR.
6. `[!]` Version-of-record post-split — recommend `apps/web` + CI assertion.
7. `[!]` Overfit-data generalization timing — recommend dedicated PR, never on a "no behavior change" refactor.
8. `[!]` Dual-read verification depth before cutover (N / coverage).

---

## Status Log
_(newest first — agents append a line per phase gate with real command output)_

- 2026-06-04 — **P5 PART 1 (lower-risk routes) GATE GREEN.** Carved the six lower-risk route handlers into `application/use-cases/*` thin-adapter pairs, one independently-revertible commit each, gate green after every one. New use cases: `load-history.ts` (LoadHistory — TurnRepo reads; per-turn cost `summarizeTurn` stays in the route adapter since `turn-cost`→infra/pricing; finishes strangling `@/lib/db` out of `turns/route.ts`, `Turn`/`AssistantTurnMetadata` now from `@/domain/entities`), `summarize-usage.ts` (SummarizeUsage), `inspect-world.ts` (InspectWorld — gates existence via WorldRepo, runs the `getFullWorldState` projection injected as a fn; the projection's own SQL move is P6; `world-state/route.ts` no longer imports `@/lib/worlds.getWorld`), `list-corrections.ts` (ListCorrections), `synthesize-narration.ts` + `record-tts-usage.ts` (TTS — added `domain/ports/speech-synthesizer.ts` `SpeechSynthesizer` port + `infrastructure/tts/xai-speech-synthesizer.ts` adapter wrapping `lib/tts.ts`, wired as `speech` in the container; the use case owns cache-key derivation + cache-or-synthesize + size-capped persist, the byte `tee` + HTTP headers stay in the route), `apply-correction.ts` (ApplyCorrection — **PARTIAL**: orchestration + cost-fold carved, `WorldNotFound`/`CorrectionExtractFailed`/`CorrectionApplyFailed` mapped to 404/502/500 at the edge; the fused `applyArchivistPatch` merge txn + `extractCorrectionPatch` LLM call are injected as route-wired fns — the load-all→simulate→apply MergePlan rewrite is the AdvanceTurn work in P5 part 2). `WorldNotFoundError` is defined once in `load-history.ts` and re-exported by the others. `application/` imports `@/domain/*` + sibling use cases + `node:crypto` (pure hash) only — grep-clean of `@/lib/db`/`@ai-sdk`/`ai`/`next`/`better-sqlite3`/`@/infrastructure`. No new `@/lib/db` value-importers introduced; the remaining ones (`archivist`/`npc-*`/`reveries`/`worlds`/`place-resolver`/`intent-reconciler`/`place-population`/`world-state`/`meta-commands`/`opening-turn` + `app/api/chat/route.ts`) are all on the chat/archivist path, P5 part 2. Real gate output from repo root:
  - `npm run type-check` → `tsc --noEmit` clean (no errors)
  - `npm test` → `Test Files 34 passed | 1 skipped (35)` / `Tests 350 passed | 1 skipped (351)` — baseline preserved (P4's 350+1 held; no new tests this slice — use-case fake-repo tests are the P5-part-2 deliverable)
  - `npm run build` → `✓ Compiled successfully`, all 10 API routes built, client bundle unchanged (the new `infrastructure/tts` adapter carries `server-only`, no leak into Chat.tsx)
  - **NOT done (carried to P5 part 2):** `chat→AdvanceTurn` (the 594-line god endpoint + ~20 onFinish closure vars + fail-open/fail-closed + dbTurnId flush ordering + SIGTERM drain); the `applyArchivistPatch` fused merge-txn MergePlan carve (shared with NameResolution/NpcPromotion P4 partials); use-case tests against in-memory fake repos + FakeClock.
- 2026-06-04 — **P4 CARVE (the risky decisions) GATE GREEN.** Five independently-revertible commits, each gated. Two extractions FULLY landed as pure-service-returns-value/intent; two are HONEST PARTIALS (pure rules extracted, the fused-transaction "return a plan, issue no SQL" carve deferred to P5 — reverting risk > reward on a no-behavior-change pass; documented in itemsRemaining). Characterization tests written and green BEFORE/with each extraction; `archivist.test.ts` (incl. the world-13 teleport + Call-In turn-403 scenarios) stayed byte-green throughout. Commits, newest first: `9155971` SceneTransition invariant → `domain/services/scene-transition.ts` `decideSceneTransition()` returns a `SceneTransitionIntent`|null, txn applies it (own commit, NOT with merge path per Open-Q#5); `7005a41` NpcPromotion pure tiering rules (`nextAgencyTier`/`isTransientServiceNpc`) — orchestrator UPDATEs stay; `d02d951` NameResolution pure rules (`charactersMatch`/`placesMatch`/`freshest`/`mergeLineBlocks`/… ) — `resolveCharacter`/`mergeCharacters` SQL wrappers stay; `f3e06ff` narrator-markdown renderers → `src/server/render/state-block.ts` (rendering, not domain); `68ff9d1` PatchSanitizer pure domain service (`sanitizeArchivistPatch`/`extractDeterministicPatch`/`normalizeTransitPlaceName`). `domain/` imports none of ai/@ai-sdk/next/better-sqlite3/@/lib/db (grep clean); the two domain↔lib type leaks (`ArchivistPatch`, `CharacterRow`/`PlaceRow`, `NarratorWorldState`) are `import type` only (fully erased — no runtime cycle). archivist.ts shrank 2224→1658 LOC. Real gate output from repo root:
  - `npm run type-check` → `tsc --noEmit` clean (no errors)
  - `npm test` → `Test Files 34 passed | 1 skipped (35)` / `Tests 350 passed | 1 skipped (351)` — 323 baseline preserved + 28 new (20 name-resolution + 8 scene-transition)
  - `npm run build` → `✓ Compiled successfully`, routes built, client bundle clean (`server-only` on the render layer does not leak into Chat.tsx). Not part of the hard gate but green.
  - **NOT done (carried to P5):** the full MergePlan/write-command carve of `mergeCharacters`/`runAliasMerges`/`mergePlaces`/`recordAppearancesAndAutoPromote` — they still issue UPDATE/DELETE/RETURNING interleaved inside `applyArchivistPatch`'s 370-line transaction; converting to load-all→simulate→apply is the `AdvanceTurn` use-case rewrite of the fused txn (prod-bug history). Also still deferred: the overfit `minerva/caesar/maya/usace` generalization (behavior change, separate PR).
- 2026-06-04 — **P4 FOUNDATION (low-risk moves) GATE GREEN.** Three independently-revertible commits, zero behavior change: (1) `9df09cc` row TYPE defs → `domain/entities/*` (World/Turn+metadata/Character/Place/Scene/Story*/NpcIntent/Reverie/Occupancy/Usage/TtsCache/Correction); 6 repository ports re-pointed off `@/lib/db` → `@/domain/entities` (the last domain→infra type leak is gone — `grep` confirms no `@/lib/db` import anywhere under `domain/`); `db.ts`/`world-state.ts`/`worlds.ts`/`npc-intents.ts`/`reveries.ts` re-export the names for back-compat. (2) `1b443f1` pure drop-in service moves into `domain/services/`: `world-clock`, `turn-numbering`, `story-signal`, `memorable-fact-provenance`, `character-dedup`, `reverie-flare` (pure core; reveries CRUD stays), `occupancy-sim` (pure core; `buildPlaceOccupancySnapshot` orchestrator stays in lib), `action-classifier-rules` (rules core; LLM fallback stays, rules-first order preserved), `narrator-guidance` (moved as-is — overfit generalization deferred). Public signatures preserved; old `@/lib/*` modules re-export. `domain/` imports none of the forbidden libs (ai/@ai-sdk/next/better-sqlite3/@/lib/db); `character-dedup` still imports the pure `@/lib/character-identity` (not on the banned list). (3) `51775a5` model-registry consolidation: `infrastructure/llm/model-registry.ts` (server-only) is the single home for `grok-4.3` + `claude-haiku-4-5-20251001`; `pricing.ts` → `infrastructure/llm/pricing.ts` (server-only, RATES keyed by registry consts); `lib/pricing.ts` slimmed to client-safe `formatUsd`; `turn-cost.ts` reads cost math from infra; all 8 call sites import the registry — zero model-ID literals remain outside it. Real gate output from repo root:
  - `npm run type-check` → `tsc --noEmit` clean (no errors)
  - `npm test` → `Test Files 32 passed | 1 skipped (33)` / `Tests 322 passed | 1 skipped (323)` — baseline preserved
  - `npm run build` → `✓ Compiled successfully`, 12 routes, client bundle clean (verifies `server-only` does not leak into Chat.tsx through the pricing split). Not part of the hard gate but green.
  - **NOT done in this slice** (remaining P4): characterization tests for NameResolution/SceneTransition/applyArchivistPatch ordering; the higher-risk extractions (PatchSanitizer, SceneTransition intents, NameResolution MergePlan, NpcPromotion, narrator-markdown renderers→server/render); the deferred overfit-generalization PR.
- 2026-06-04 — **P1 PARTIAL, GATE GREEN.** Recovered an uncommitted prior-session P1 build that had left the suite RED: `tts-route-warm.test.ts` failed because the migrated route → container → infra chain pulls `import 'server-only'`, whose default export throws outside an RSC boundary (Vitest has none). Fixed by aliasing `server-only` → its no-op `empty.js` in `packages/server/vitest.config.ts` (the same file Next resolves under the `react-server` condition). That restored 323. Then fully strangled `cost-cap.ts`: its raw `SUM(json_extract(...))` over `db` now goes through `UsageRepository.todaysTokenTotal(clock.today())` (SQL already lived in `usage-repository.sqlite.ts`); `todaysTokens`/`isOverDailyLimit` became async; updated 3 callers (`chat/route.ts` cap gate, `opening-turn.ts`, `cost-cap.test.ts`). Ports (14 + Clock/Logger), all-async signatures, append-only `TurnRepository`, single SQLite adapter set, `composition/container.ts`, and `server-only` guards were all present from prior work and verified. **NOT done:** the remaining 12 VALUE importers of `@/lib/db` (SQL-owning lib modules — archivist/reveries/npc-*/world-state/worlds/place-resolver/intent-reconciler/meta-commands/opening-turn — whose SQL is wrapped behind adapters that delegate back into them, plus the P5 `chat/route.ts` god endpoint). The exit-criterion guard-grep was deliberately NOT added because the invariant it asserts does not yet hold; adding it would fail the suite. Real gate output from repo root:
  - `npm run type-check` → `tsc --noEmit` clean (no errors)
  - `npm test` → `Test Files 32 passed | 1 skipped (33)` / `Tests 322 passed | 1 skipped (323)` — baseline preserved (the 1 skip is pre-existing)
- 2026-06-04 — **P0 GATE GREEN.** App moved verbatim under `packages/server/` via `git mv` (history-preserving renames); npm workspaces stood up (`packages/*`, `apps/*`), root scripts delegate to `@chronicles/server`; `tsconfig.base.json` added, server tsconfig extends it (keeps `@/*`, Next plugin, `serverExternalPackages: ['better-sqlite3']`); cwd coupling removed in `db.ts` + `prompt-files.ts` (module-relative via `import.meta.url`). Real gate output from repo root after `npm install`:
  - `npm run type-check` → `tsc --noEmit` clean (no errors)
  - `npm test` → `Test Files 32 passed | 1 skipped (33)` / `Tests 322 passed | 1 skipped (323)` — matches baseline 33 files / 323 tests
  - `npm run build` → `✓ Compiled successfully`, page data collected, 12 routes built (one benign warning: "TypeScript project references are not fully supported", falls back to incremental). Not part of the hard gate but green.
- 2026-06-04 — Branch `onion-arch-refactor` created. Baseline captured: type-check clean, 323 tests pass. Tracker initialized.

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

- [ ] Define `domain/ports/`: `WorldRepository, TurnRepository, CharacterRepository, PlaceRepository, SceneRepository, DossierRepository, ReverieRepository, NpcIntentRepository, OccupancyRepository, TtsCacheRepository, CorrectionRepository, UsageRepository, UnitOfWork, Clock, Logger`
- [ ] **All ports `async`** even on sync SQLite adapter (wrap in `Promise.resolve`) so P2 is signature-neutral
- [ ] `TurnRepository` is append-only: `insert`, `recentTurns`, `turnsBefore`, `latestUserTurnId`, `mergeMetadata(turnId, agentKey, block)`, `incTtsChars(turnId, n)` — **no general `update`/`setMetadata`**
- [ ] `Clock` port; route the ~6 files' `datetime('now')` reads through `clock.now()`
- [ ] Single SQLite impl in `infrastructure/persistence/sqlite/` implementing all ports
- [ ] `composition/container.ts` wires adapters
- [ ] Migrate ~23 `import { db }` / named-fn importers off `@/lib/db` one module at a time, each green
- [ ] `cost-cap.ts` `SUM(json_extract(...))` → `UsageRepository.todaysTokenTotal(clock.today())` (SQL stays in adapter)
- [ ] Add `import "server-only"` to every infra/repo module
- **Gate:** zero `import ... from '@/lib/db'` outside `infrastructure/persistence/sqlite/` (guard-grep test); full suite green.

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

- [ ] Characterization tests for `NameResolution` / `SceneTransition` / `applyArchivistPatch` ordering (golden patches → expected merge plans), seeded from known prod-bug scenarios — written **before** extraction
- [ ] **Low-risk drop-in moves first** (zero behavior change): `ReverieFlare`, `WorldClock`, `OccupancySim`, `CharacterDedup`, `MemorableFactProvenance`, `StorySignal`, `ActionClassifierRules`, `TurnNumbering` → `domain/services/`
- [ ] `model-registry.ts` consolidation: collapse 7× `claude-haiku-4-5-20251001` + 2× `grok-4.3` + `pricing.ts` into `infrastructure/llm/`
- [ ] `PatchSanitizer` (sanitize + transition guards + transit normalize + deterministic patch) → pure domain service
- [ ] `SceneTransition` invariant → returns open/close **intents**, not UPDATEs
- [ ] `NameResolution` (resolve/merge/alias/freshest) → returns a **MergePlan**, issues no SQL (highest risk — own PR, not with scene path)
- [ ] `NpcPromotion` tiering → returns write commands from a snapshot
- [ ] Narrator-markdown renderers (`formatStateBlock`/`formatDossierBlock`/...) → `server/render`, NOT domain
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
- [ ] Repeat thin-adapter treatment: `world-correction→ApplyCorrection`, `turns→LoadHistory`, `world-state→InspectWorld`, `usage→SummarizeUsage`, `tts→SynthesizeNarration`, `tts/record→RecordTtsUsage`, corrections list
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

- 2026-06-04 — **P0 GATE GREEN.** App moved verbatim under `packages/server/` via `git mv` (history-preserving renames); npm workspaces stood up (`packages/*`, `apps/*`), root scripts delegate to `@chronicles/server`; `tsconfig.base.json` added, server tsconfig extends it (keeps `@/*`, Next plugin, `serverExternalPackages: ['better-sqlite3']`); cwd coupling removed in `db.ts` + `prompt-files.ts` (module-relative via `import.meta.url`). Real gate output from repo root after `npm install`:
  - `npm run type-check` → `tsc --noEmit` clean (no errors)
  - `npm test` → `Test Files 32 passed | 1 skipped (33)` / `Tests 322 passed | 1 skipped (323)` — matches baseline 33 files / 323 tests
  - `npm run build` → `✓ Compiled successfully`, page data collected, 12 routes built (one benign warning: "TypeScript project references are not fully supported", falls back to incremental). Not part of the hard gate but green.
- 2026-06-04 — Branch `onion-arch-refactor` created. Baseline captured: type-check clean, 323 tests pass. Tracker initialized.

# Chronicles AI

Single-player interactive novel engine: a bounded living world, multi-agent narrator, persistent structured state.

## Working autonomy

- **Default to the recommended option** when you offer a choice. Only stop to ask when the options have materially different blast radius (destructive vs. reversible) or when the right answer depends on something only I know. Don't ask me to choose between "snapshot type A vs B" if A is clearly better — do A and say what you did.
- **Proceed without confirmation for reversible local actions**: writing files in this repo, creating local backups under `backups/`, read-only railway commands, `railway ssh` into prod for inspection or snapshots. Still confirm before: `git push`, `railway redeploy`/`down`/`delete`, dropping DB tables, `rm -rf`, anything that touches the production DB destructively, or anything that posts to GitHub/external systems.
- **When a command fails, diagnose before retrying with flags.** Don't keep poking. If two attempts fail for related reasons, stop and explain the hypothesis before the third try.
- Don't push, open a PR, or bump the version unless the task calls for it.

## Working in this repo

- **State assumptions before coding.** If the request has multiple reasonable readings, surface them rather than picking silently. If you don't know which agent/table/phase a change belongs in, ask.
- **Define "done" before starting.**
  - Narrator / prompt / turn-pipeline: streamed a real turn end-to-end in the browser.
  - Schema: `packages/server/src/lib/migrations.ts` applies on boot, the matching Mongo model/index under `infrastructure/persistence/mongo/models` is updated, and queries typecheck.
  - New agent: prompt template in `packages/server/prompts/` and a real call returns valid output.
  - UI / client state: exercised in the browser, not just typechecked or screenshotted.
- **Stay in your lane.** Each agent has its own prompt, context, and Zod schema. Don't merge them, don't share full prompts, don't let the narrator see what the archivist sees. Don't casually rewrite `packages/server/prompts/*.md` — treat prompt diffs as behavior diffs and verify with a real turn.
- **Simplicity first.** Minimum code that solves the problem. Nothing speculative. If you write 200 lines and it could be 50, rewrite it.
- **Respect the budget.** Narrator history is the last **20 prior role rows** as full uncompacted prose (after OOC sanitization); system prompt, authoritative STATE, and player action are pinned. Soft craft guidance is sparse/risk-gated — do not reintroduce always-on length bands, invent a hard `maxOutputTokens`, or re-add aggressive history compaction without a plan. Don't dump full history beyond that window.
- **The LLM does not remember.** The system decides what it remembers and injects into context. Keep tactical scene state, content boundaries, and action resolution in structured authoritative state, not only in prose.
- **Turns are append-only.** Persist the player action BEFORE streaming starts; persist the narrator response AFTER the stream completes. Never modify a turn after creation. Track token usage in `turns.metadata` on every LLM call.
- **Treat LLM output as untrusted.** Sanitize player text and model output at the adapter→domain edge, then trust inward.
- **Archive plans when they ship.** `git mv` a landed plan from `docs/plans/` into `docs/plans/archive/` (never delete). Roadmaps and `_template-milestone.md` stay put; versioned milestone docs go in `docs/plans/milestones/`.

## Beat and state

These apply in every world and situation. Do not add genre- or mood-specific matchers (romance, bunk, rite, procedure). The cue is whatever the player just did.

- **Bind to the signal you already have.** Do not grow synonym lists. Destination is the place the archivist already named. Thread engagement is player text matching that thread's tokens *this turn*. Presence is `current_place_id ===` the player's. If the fix is another regex of phrasings, the concern has leaked — find the structured signal.
- **The player's action this turn is the beat.** NPCs roll with that cue. Structure may not force a different beat. Do not walk them with someone they refused to follow. Do not MUST STAGE a finding, file, or named next place they did not name. `continue` finishes what is already in frame; it does not mint a new incident to "land a board."
- **Hard rules need an inverse.** "Follow means arrive" only if they followed. A presence loop is not a license to replace the player's beat. "Yield lands a result" does not invent a new alarm, place, or log. If the player acted, NPCs react; they initiate only when the player yielded the floor or addressed them.
- **Do not stack binding obligations.** MUST STAGE + planned moves + yield-write-through + "break the loop with a choice" will make every companion dump plot. One structural must per concern. Soft notes for the rest. Giving the narrator "full control" is the wrong inverse — they already have craft; what they lack is permission to ignore a stack of musts.
- **Keep structured place and presence.** The camera is who shares the player's `current_place_id`. Off-scene STATE is a writer's aid, not a camera feed. Do not leave the protagonist row behind when the player authored a trip and the prose arrived. Prose is the book; state follows the book on player-authored facts.
- **Last turn's structure is not this turn's duty.** Do not sticky-engage a thread because it was foreground last turn. Drop a pending MUST STAGE whose cast has left the room. Naming a present person is not engagement with the plot.
- **Prompts are craft; domain services decide.** If a prompt rule and a sanitizer/director predicate disagree, the predicate wins. A prompt-only fix for a state miss is incomplete.

## Architecture

Hexagonal (ports & adapters). Paths below are relative to `packages/server/src/`.

**Dependencies point inward.** The domain depends on nothing; everything depends on the domain.

| Adding… | Goes in… |
|---|---|
| A rule that *decides* | `domain/services/` |
| Orchestration / a transaction | `application/use-cases/` |
| SQL, Mongo, an SDK, a model ID, pricing | `infrastructure/` (IDs + pricing: `infrastructure/llm/`) |
| A prompt template | `packages/server/prompts/*.md` |
| A shared Zod type | `@chronicles/contracts` |
| A route or Server Action | parse → call a use case → pipe; no logic |

**Do not add to `lib/`.** That directory is being strangled. New modules must not `import` `db.ts` or an SDK directly. When you touch a violating file, move it one step toward the layering (blueprint §10). Look in `application/use-cases/` and `domain/ports/` for what exists — don't copy a roster from this file. Domain is pure (no `next`, `ai`, `@ai-sdk/*`, `better-sqlite3`, `mongoose`, `fs`, `fetch`, or a wall-clock). Adapters meet use cases only in `composition/container.ts`.

**Separation rules:**
- Repositories are dumb CRUD. Deciding logic (name resolution, alias merge, `reveals_name_of`, sticky-scene, freshest-field-wins) is a domain service the use case runs *before* handing flat rows to a repository.
- Structure ≠ rendering. Domain emits structured values (`ContextBundle`, `ArchivistPatch`); adapters turn them into prompt text or HTTP.
- One agent per port. Prompt-building + inference + parsing + sanitization + persistence are five homes. The old `lib/archivist.ts` is the anti-pattern.
- Errors are domain types (`WorldNotFound`, `BudgetExceeded`, `ContextOverflowError`), mapped to HTTP/UI only in the inbound adapter.

**The leak test:** if adding one feature forces you to edit two layers at once, a concern has leaked — re-cut the boundary before writing the feature.

Cross-layer imports fail CI (`npm run depcruise`, also `pretest`). Don't introduce them; don't suppress the rule.

## Source of truth

When docs and code disagree, **code wins** and the spec needs updating.

1. Live schema = `packages/server/src/lib/migrations.ts` + matching Mongo models under `infrastructure/persistence/mongo/models`.
2. Binding architecture = `docs/specs/hexagonal-architecture-blueprint.md`.
3. Product spine = `docs/plans/living-world-roadmap.md`.
4. Other specs describe intent. They lose to migrations and to the running code.

**Historical only — do not treat as current:** `docs/plans/roadmap.md` (original Postgres/Drizzle plan), `ONION_ARCH_REFACTOR.md`, `ONION_TODO.md`, `docs/superpowers/`.

| If you are changing… | Read this, then stop |
|---|---|
| A layer, port, or use case | `docs/specs/hexagonal-architecture-blueprint.md` |
| Narrator / archivist / NPC prompts or context | `docs/specs/agent-system-design.md` and `docs/specs/npc-narrator-runtime.md` |
| Tables, indexes, or Mongo models | `packages/server/src/lib/migrations.ts` (not `docs/specs/database-design.md`) |
| Product direction, living world, hub/sim | `docs/plans/living-world-roadmap.md` |
| A version bump or deploy | `docs/RELEASING.md` |

`docs/specs/database-design.md` is the *logical* schema, not the live one. `docs/specs/memory-architecture.md` is unbuilt (Phase 2+).

## Stack and commands

npm workspaces: `@chronicles/server` (Next.js 15 App Router) + `@chronicles/contracts` (Zod schemas + sentence-splitter). SQLite via `better-sqlite3` is the live default (migrates on boot). Mongo/Mongoose sits behind `PERSISTENCE=mongo` and is not cut over. Root scripts proxy to `@chronicles/server`. Style: match the file you are in; path-scoped extras live in `.claude/rules/`.

- `npm run dev` — Next.js dev server
- `npm run build` / `npm run lint` / `npm run type-check`
- `npm test` — Vitest (SQLite). `pretest` runs `npm run depcruise`.
- `npm -w @chronicles/server test -- tests/<file>.test.ts` — one file
- `npm run test:mongo` — Mongo adapter suite (`MongoMemoryReplSet`). Required when you touch a persistence port or adapter; skip otherwise.
- `docker compose up -d` — Mongo replica set; only needed for `PERSISTENCE=mongo`

No Drizzle, no separate migrate step.

## Environment

- `.env.local` for local dev (never commit); `.env.example` documents required variables
- Required: `ANTHROPIC_API_KEY` (Haiku extractors), `XAI_API_KEY` (Grok narrator + TTS)
- `PERSISTENCE=sqlite|mongo` (default `sqlite`). Optional `DATABASE_PATH` (SQLite file). Mongo needs `DATABASE_URL` (replica-set URI) and `await initContainer()` at boot.
- Optional: `DAILY_TOKEN_LIMIT`, `TTS_VOICE`, `TTS_SPEED`, `MAP_ROUTE_PROVIDER`, `MAP_TOOL_USER_AGENT`

Auth is a shared-password gate at the adapter edge (`lib/app-auth.ts`, middleware, the login route). Do not put a second gate inside a use case or domain service.

## Release

Header version is load-bearing (`packages/server/package.json` → `/`). Do not put a version number in this file. Full playbook: `docs/RELEASING.md`.

- Feature → bump MINOR (plain integer; `0.9.0` → `0.10.0`, never auto-roll to `1.0.0`). Fix → bump PATCH. `v1.0.0` is Andrew's explicit call only.
- Bump on the `feat/*` or `fix/*` branch, before merge — never post-merge on `main`. Bump root + `@chronicles/server` + `@chronicles/contracts` + `package-lock.json` in one commit.
- `main` is integration and is not auto-deployed. Promote `main` → `production` and push `production` to deploy.
- After a bump, restart `npm run dev` (Next does not HMR `package.json` imports) and confirm the header.

## Gotchas

- SQLite needs no DB process — `migrations.ts` runs on boot. Only `PERSISTENCE=mongo` needs `docker compose up -d` first.
- `PERSISTENCE=mongo` requires `await initContainer()` at boot; the SQLite path builds the container lazily and never loads `mongoose`.
- `better-sqlite3` stays inside `infrastructure/persistence/sqlite/`; `mongoose` stays inside `persistence/mongo/`.
- `dependency-cruiser` failures surface in `npm test` via `pretest` — fix the import direction, don't suppress the rule.
- Hot-reload breaks on `package.json` changes — restart the dev server.

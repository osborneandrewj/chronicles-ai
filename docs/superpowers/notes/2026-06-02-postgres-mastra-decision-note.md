# Postgres + Mastra Decision Note

**Date:** 2026-06-02  
**Scope:** Architecture evaluation only. No implementation changes.

---

## 1. Short Recommendation

Move toward Postgres, but do not do a full Mastra rewrite yet.

Treat Postgres as the foundation migration. Treat Mastra as a targeted orchestration
experiment around one bounded workflow before considering it for the main turn loop.

---

## 2. Postgres Evaluation

Postgres is directionally right for Chronicles.

The current implementation still uses `better-sqlite3` and a Railway-mounted SQLite
file (`DATABASE_PATH=/data/chronicles.sqlite` in production), but the long-term
architecture already points at PostgreSQL plus `pgvector`. The original SQLite call
was right for the MVP: it avoided Docker, infra setup, ORM ceremony, and vector
storage before any of those were useful.

The system has now grown past the original SQLite assumptions:

- 25 SQLite migrations live in `src/lib/migrations.ts`.
- `src/lib/db.ts` has dozens of prepared statements and exported data helpers.
- The runtime stores turns, worlds, characters, scenes, places, dossiers, TTS cache
  rows, occupancy snapshots, reveries, NPC intents, and world corrections.
- The Railway deployment is locked to one app instance because the DB is a single
  mounted file.
- Future memory/RAG work wants vector search; `pgvector` keeps relational and vector
  state in one database.

Strong reasons to switch:

- Better concurrency than one SQLite writer on one app instance.
- Better backup, restore, introspection, and operational tooling.
- Row-level locks and transactional semantics that fit future multiplayer / async
  worlds better than a volume-backed file.
- JSONB and GIN indexes fit the current semi-structured state model.
- `pgvector` provides a direct path for memory chunks and similarity search without
  adding Pinecone or another service.

Main cautions:

- Do not bundle the migration with a schema redesign.
- Do not simultaneously switch IDs from integers to UUIDs unless there is a concrete
  need; preserving integer IDs first reduces blast radius.
- Postgres access is async, while `better-sqlite3` is synchronous. This will touch
  the route, archivist, NPC agent, world-state helpers, tests, and scripts.
- Raw SQL may still be reasonable initially. Drizzle can be introduced later if it
  clearly reduces maintenance cost.

Verdict: Postgres is a yes, probably soon, but it should be a behavior-preserving
port first.

---

## 3. Mastra Evaluation

Mastra is relevant, but it should not replace the core simulation engine in one move.

The current engine is not just generic agent orchestration. It is an explicit pipeline:

1. Parse and validate the player action.
2. Persist the user turn.
3. Load authoritative state.
4. Promote recurring NPCs.
5. Classify action stance and input mode.
6. Resolve unresolved places.
7. Run the NPC agent tick when gated.
8. Build deterministic place occupancy.
9. Compute reverie flares.
10. Assemble narrator state.
11. Stream narrator output.
12. Persist narrator turn and metadata.
13. Reconcile NPC intents.
14. Apply deterministic and/or LLM archivist patches.

Much of the coherence comes from deterministic code and database invariants, not from
agent autonomy. A framework rewrite risks losing behaviors that are currently encoded
in local rules: location anchoring, intent reconciliation, routine tick skips,
provenance-bearing fact appends, duplicate detection, scene cursor invariants, and
cost metadata.

Good Mastra pilot candidates:

- World generation / seeding.
- Archivist extraction.
- NPC agent tick.
- Future Story Conductor decisions.
- Evaluation and tracing around multi-step agent calls.

Bad first Mastra candidate:

- The streaming narrator route. It has custom AI SDK streaming, map tools,
  metadata injection, retry/idempotency behavior, DB turn IDs for TTS, and
  post-stream persistence. Replacing that first is high-risk.

Verdict: Mastra is a maybe. Use it to improve observability, workflow composition,
retries, and evals around bounded workflows. Do not let it become the source of truth
for world state.

---

## 4. Combined Migration Risk

Do not migrate Postgres and Mastra in the same milestone.

Postgres is data risk. Mastra is behavior risk. Doing both at once makes regressions
hard to localize: a bad turn could be caused by async DB semantics, SQL translation,
transaction changes, workflow scheduling, prompt shape drift, stream handling, or
agent-output differences.

The safer sequence:

1. Port SQLite to Postgres with behavior preserved.
2. Keep IDs, route contracts, prompt contracts, tests, and UI behavior stable.
3. Add `pgvector` only when memory retrieval actually ships.
4. Pilot Mastra on one non-streaming workflow.
5. If the pilot helps, wrap more of the turn pipeline behind Mastra workflow steps.
6. Keep authoritative world state in Postgres, not Mastra memory.

---

## 5. Practical Migration Shape

Recommended Postgres migration shape:

- Add a Postgres connection layer behind the existing `src/lib/db.ts` public API.
- Port tables faithfully before redesigning them.
- Preserve current app-level helper functions where possible.
- Convert tests from in-memory SQLite to isolated Postgres test databases or schema
  namespaces only after the driver layer works.
- Write a one-shot SQLite-to-Postgres export/import script.
- Run both local and production smoke tests against a copied DB before switching
  Railway variables.
- Keep a rollback path: old SQLite volume snapshot, old code, and no destructive data
  cleanup until Postgres has survived real play.

Recommended Mastra pilot shape:

- Pick one workflow with a narrow contract, preferably archivist extraction or world
  generation.
- Preserve the existing Zod schemas.
- Compare current AI SDK output versus Mastra-wrapped output on recorded turns.
- Do not touch narrator streaming in the pilot.
- Judge the pilot by concrete gains: tracing, retries, eval setup, simpler code, or
  better failure isolation.

---

## 6. Bottom Line

Postgres is the more important architectural move. It removes the single-instance
SQLite constraint and lines up with memory/RAG, multiplayer, and production
operability.

Mastra may still be useful, but only if it makes the existing explicit pipeline more
observable and testable. The core simulation should remain deterministic-state-first:
Postgres is the authority, local code enforces invariants, and LLM calls produce
bounded decisions or prose inside that frame.

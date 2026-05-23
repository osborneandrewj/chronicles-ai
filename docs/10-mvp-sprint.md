# MVP Sprint

**Target**: Monday 2026-05-25
**Bar**: "I can show someone a working streaming chat with persisted turns."
**Budget**: ~4–6 hours of focused work.

This document scopes a deliberately scoped-down sprint that sits *below* Phase 1 in `07-implementation-roadmap.md`. The full Phase 1 still stands as the next milestone after this sprint; this sprint exists to prove the streaming-narrator loop works end-to-end before investing in authoritative state, schema breadth, or test infrastructure.

## Scope

One page. One table. ~150 lines of code.

```
schema:
  turns(id, role, content, created_at)

routes:
  GET  /             → server component, loads all turns, renders <Chat>
  POST /api/chat     → AI SDK 5 streamText, persists player on send + narrator on onFinish
```

### Files

```
src/app/page.tsx              server component, loads turns, renders <Chat>
src/app/api/chat/route.ts     streamText + persist
src/components/Chat.tsx       "use client", useChat hook
src/lib/db.ts                 better-sqlite3 connection + 3 prepared queries
src/lib/prompt.ts             narrator system prompt + premise as const
```

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| AI SDK version | **AI SDK 5** (`ai@^5`, `@ai-sdk/anthropic`, `@ai-sdk/react`) | Matches `05-api-design.md`. UI message streams are the long-term path. |
| Model | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) | Narrator quality matters most; this is the one place we don't compromise. Update `CLAUDE.md` which currently says "Sonnet 4" generically. |
| Database | **SQLite via `better-sqlite3`** | Phase 1 doesn't use `pgvector`. Postgres + Docker is incidental complexity for an MVP. Swap to Postgres in Phase 2 when embeddings ship. |
| ORM | **None — raw `better-sqlite3` prepared statements** | Three queries. Drizzle setup costs more than it saves at this scale. |
| UI library | **Raw Tailwind, no shadcn/ui** | Two components (textarea, div). shadcn pays off at ~8 components. |
| World model | **One implicit world, no `worlds` table** | Premise lives as a `const` in the system prompt module. |
| Prompt storage | **Inline `const` in `src/lib/prompt.ts`** | Move to `prompts/narrator-system.md` when iteration begins in Phase 1 proper. |
| Context assembly | **Inline `SELECT * FROM turns ORDER BY id DESC LIMIT 20` in the route** | No `context-assembler.ts` abstraction yet. |
| Turn numbering | **`id` autoincrement only** | No advisory locks, no `turn_number` column. |

## Explicit cuts from Phase 1

Everything below is deferred to Phase 1 proper, not deleted from the roadmap:

- `worlds`, `characters`, `scenes` tables
- World CRUD pages, world list, world dashboard, create-world form
- Server Actions (only the one Route Handler exists)
- Authoritative state block (clock, location, identity, presentation, tactical state, content boundaries, relationship anchors)
- Action classifier (`stance`, `input_mode`)
- Name profiles, naming policies, name validation
- Meta-command handler (`/pause`, `/inspect`, `/rules`)
- Token usage tracking in `turns.metadata`
- Rate limiting
- Retry-as-new-turn flow, partial-content-on-failure
- Mobile polish, error UI beyond default
- Playwright smoke test, accessibility test, regression fixture from `09-example-chat-narrative.md`
- All Phase 1 unit/integration test requirements

## Accepted tradeoffs

- **Narrator drifts** on location/time/identity after ~15–20 turns (no authoritative state).
- **Player can author outcomes** ("I kill the king" → narration follows). No adjudication.
- **Premise change = code edit.** No UI to author premise.
- **Single shared chat across all browsers.** No accounts, no isolation.
- **Schema is throwaway.** Migrating to Postgres + the full Phase 1 schema is a planned cost.

## Exit criteria

- `npm run dev` → open `/` → type action → narrator response streams token-by-token.
- Refresh browser → all prior turns visible in order.
- 10 consecutive turns with no console errors.

When all three hold, the sprint is done. The next step is Phase 1 proper as documented in `07-implementation-roadmap.md`.

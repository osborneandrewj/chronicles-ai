# API Design

> **Status (onion-arch-refactor, 2026-06-08).** This branch carved the old 593-line
> `api/chat` god endpoint into thin inbound adapters over named application use cases.
> Every HTTP route now parses input, calls one use case, and pipes the result — owning
> no pipeline logic. The route→use-case mapping and shared contract schemas below are the
> shipped reality. **Preview-branch caveats:** the planned `apps/web` client split did
> **not** happen (the client still lives inside `packages/server`), Mongo persistence is
> wired but not cut over (`PERSISTENCE=sqlite` is live), and the Server-Action sections
> further down (§3) remain the *aspirational* CRUD design — most of those functions are
> not yet implemented as `"use server"` actions.

## 1. Overview

The API uses two patterns:

- **Route Handlers (`packages/server/src/app/api/*/route.ts`)** — the shipped surface. Each
  is a thin inbound adapter: it validates the request with a shared
  `@chronicles/contracts` Zod schema, calls exactly one application use case, maps any
  domain error to an HTTP status **at the edge**, and pipes the result. No business logic
  lives in a route.
- **Server Actions** — the intended pattern for UI-triggered CRUD (creating worlds, editing
  characters, browsing wiki). Largely still aspirational on this branch; see §3.

There is no REST API layer in the resource-oriented sense. Routes are command/query adapters
over use cases, not CRUD-over-tables.

### Route → use-case mapping

| Route | Use case | Purpose |
|-------|----------|---------|
| `POST /api/chat?worldId=N` | `advanceTurn` | Run a turn; stream narration (see §2.1) |
| `POST /api/tts` | `synthesizeNarration` | Synthesize narrator speech |
| `POST /api/tts/record` | `recordTtsUsage` | Record TTS character usage |
| `GET /api/turns` | `loadHistory` | Load a world's turn history |
| `GET /api/usage` | `summarizeUsage` | Token/cost usage summary |
| `GET /api/world-state` | `inspectWorld` | Authoritative world state (inspector) |
| `POST /api/world-correction` | `applyCorrection` | Apply a player world-state correction |
| `GET /api/world-corrections` | `listCorrections` | List prior corrections |

Use cases live in `packages/server/src/application/use-cases/`; they import `domain/` only and
never touch SQL, an SDK, or a framework. Concrete adapters are constructed once in
`packages/server/src/composition/container.ts` and handed to the route via `getContainer()`.

## 2. Route Handlers

### 2.1 `POST /api/chat?worldId=N`

The core endpoint (`packages/server/src/app/api/chat/route.ts`). Accepts the running
chat-message list, runs a turn, and streams the narrator response as a Vercel AI SDK UI
message stream. The route is a thin adapter over the `advanceTurn` use case — it owns no
pipeline logic.

**Request**: `worldId` is a positive-integer query param. The body is the shared
`@chronicles/contracts` chat shape — an AI-SDK `messages[]` array (each message a `{ role,
parts[] }`), validated at the edge:

```typescript
{
  messages: Array<{
    id?: string
    role: string
    parts: Array<{ type: string; text?: string }>
  }>
}
```

The route extracts the latest user message's text into `playerText` and passes the whole
list to the use case.

**Response**: an AI SDK UI message stream (`createUIMessageStreamResponse`). `advanceTurn`
returns one of two result kinds, and the route renders accordingly:
- **`canned`** — a meta-command reply or a replay of an existing turn; emitted as a single
  `text-start`/`text-delta`/`text-end` sequence.
- **`stream`** — live narration. The narrator adapter returns a `NarrationStream
  { chunks, completion }`; the route pipes `chunks` verbatim, then appends a
  `data-turn-metadata` part carrying the persisted `dbTurnId` once `completion` resolves.
  Because the adapter settles `completion` only after the source stream drains
  (post-`onFinish`), the metadata part is guaranteed to land **last** — the ordering the
  client depends on. This append is done by the `appendDbTurnId` helper.

**Narration path** — the route holds no narrator logic:
- The narrator is reached through the `NarratorPort` adapter
  (`packages/server/src/infrastructure/narrator/narrate-turn.ts`), injected into the use case
  as `buildNarration`.
- Post-turn work (e.g. the archivist pass) is registered on the **`BackgroundTasks`** port.
  Its adapter (`packages/server/src/infrastructure/background/process-background-tasks.ts`)
  tracks in-flight promises and installs a single `process.once('SIGTERM')` **drain** that
  awaits outstanding work before exit — turning "fire-and-pray" into bounded-loss
  best-effort.

**Error Responses** — domain errors are mapped to HTTP **only here**, at the edge:
| Status | Condition |
|--------|-----------|
| 400 | Missing/invalid `worldId`, invalid JSON, schema-invalid body, or `EmptyPlayerActionError` |
| 404 | `WorldNotFoundError` (world unknown — checked before body parse, re-checked in the use case) |
| 429 | `BudgetExceededError` — daily token cap reached (JSON body: `error`, `message`, `used`, `limit`) |
| 500 | Unhandled failure (re-thrown) |

**Cost cap**: a daily token limit is enforced (`isOverDailyLimit` / `todaysTokens` /
`dailyTokenLimit`, injected into the use case); over-limit surfaces as `BudgetExceededError`
→ HTTP 429. There is no per-minute rate limiter on this branch.

### 2.2 Other route handlers

The remaining routes are the same thin-adapter shape — parse with a `@chronicles/contracts`
schema, call one use case, map domain errors to status at the edge:

- `POST /api/tts` → `synthesizeNarration`
- `POST /api/tts/record` → `recordTtsUsage`
- `GET /api/turns` → `loadHistory`
- `GET /api/usage` → `summarizeUsage`
- `GET /api/world-state` → `inspectWorld`
- `POST /api/world-correction` → `applyCorrection` (404 `WorldNotFoundError`, 502
  `CorrectionExtractFailed`, 500 `CorrectionApplyFailed`)
- `GET /api/world-corrections` → `listCorrections`

There is no `/api/health` or `/api/voice/token` route on this branch.

## 3. Server Actions

> **Aspirational on this branch.** The shipped surface is the Route Handlers in §2. The
> Server Actions below describe the intended UI-triggered CRUD design; most are not yet
> implemented as `"use server"` actions, and the `src/lib/actions/*` paths predate the
> monorepo move — runtime code now lives under `packages/server/src/`. When these land,
> each action follows the same discipline as a route: validate with a contract schema,
> call a use case, keep deciding logic in pure domain services (name resolution, dedup,
> scene-transition), never inline SQL or SDK calls.

Server Actions are `"use server"` async functions called directly from React components. They handle validation, then delegate to an application use case for database operations and revalidation.

### 3.1 World Actions

File: `src/lib/actions/world-actions.ts`

#### `createWorld(formData)`

Creates a new world with an initial scene and player character.

**Input** (Zod-validated):
```typescript
const CreateWorldSchema = z.object({
  name: z.string().min(1).max(255),
  premise: z.string().min(10).max(5000),
  genre: z.string().max(100).optional(),
  tone: z.string().max(100).optional(),
  contentBoundaries: z.object({
    rating: z.string().max(100).optional(),
    allowedIntensity: z.array(z.string().max(255)).default([]),
    restrictedContent: z.array(z.string().max(255)).default([]),
    fadeToBlack: z.array(z.string().max(255)).default([]),
    toneNotes: z.string().max(1000).optional(),
  }).optional(),
  characterGivenName: z.string().min(1).max(64).regex(/^[A-Za-z]+(?: [A-Za-z]+)*$/),
  characterHouseName: z.string().min(1).max(64).regex(/^[A-Za-z]+(?: [A-Za-z]+)*$/),
  characterDescription: z.string().max(2000).optional(),
})
```

**Character name policy**: Player names are curated for setting fit, not fully free-form. The UI may let the player choose a given name and a generated family/house/regimental name, or request a full suggested name. Names must reject numbers, handles, emoji, punctuation/symbols, and out-of-world joke strings. The server stores the joined display name in `characters.name` and stores name parts plus provenance in `characters.traits.name_profile`.

For worlds with strongly themed naming, the server should validate the final display name against a world-specific `name_policy` from `worlds.setting_details`. If a user-provided name fails validation, return a field error instead of silently rewriting it.

**Operations** (single transaction):
1. Insert world
2. Insert player character (`is_player: true`)
3. Insert initial scene (scene_number: 1, title: "Opening", status: "active")
4. Redirect to `/worlds/{worldId}/play`

**Returns**: `{ worldId: string }` on success, `{ error: string }` on failure.

#### `updateWorld(worldId, formData)`

Updates world name, premise, genre, tone, content boundaries, or setting_details.

#### `archiveWorld(worldId)`

Sets world status to "archived". Does not delete data.

#### `deleteWorld(worldId)`

Deletes the world and all related data (CASCADE). Requires confirmation from UI.

#### `listWorlds()`

Returns all worlds ordered by `updated_at DESC`.

**Returns**:
```typescript
Array<{
  id: string
  name: string
  premise: string        // truncated to 200 chars
  genre: string | null
  tone: string | null
  status: string
  turnCount: number      // aggregate from turns table
  lastPlayedAt: string   // max(turns.created_at)
  createdAt: string
}>
```

#### `getWorld(worldId)`

Returns full world details with active scene, player character, and turn count.

### 3.2 Story Actions

File: `src/lib/actions/story-actions.ts`

#### `getStoryState(worldId)`

Fetches everything needed to render the play page.

**Returns**:
```typescript
{
  world: World
  scene: Scene
  character: Character
  turns: Turn[]           // All turns for active scene, ordered by turn_number
}
```

#### `createScene(worldId, title, description, location?)`

Creates a new scene and marks the previous active scene as completed.

**Operations** (single transaction):
1. Update current active scene: `status = 'completed'`, `ended_at = now()`
2. Insert new scene with next `scene_number`
3. Insert `scene_opening` turn (optional: trigger narrator to generate opening text)

#### `retryLastTurn(worldId, sceneId)`

Finds the last failed narrator response turn (where `metadata.stream_error = true`) and resubmits the preceding player action. Used by the "Retry" button on stream failures.

Retry preserves the append-only turn log. It does not delete or mutate the failed narrator turn. Instead it appends:
1. A `system_event` turn noting the retry attempt and failed turn ID
2. A new `narrator_response` turn with fresh metadata

### 3.3 Character Actions (Phase 1+)

File: `src/lib/actions/character-actions.ts`

#### `updateCharacter(characterId, data)`

Updates character name, description, or traits.

#### `getCharacter(characterId)`

Returns full character details.

### 3.4 Seeding Actions (Phase 2)

File: `src/lib/actions/seeding-actions.ts`

#### `seedWorld(worldId, options)`

Runs the World Seeder, optional simulated expeditions, Wiki Compiler, and World Linter. Persists all generated material as immutable `world_sources` before compiling candidate knowledge.

Options may include imported prior adventure logs. These are persisted as `world_sources.source_type = "prior_adventure_log"` and compiled into wiki, timeline, relationship, thread, emotional-event, tactical-state, and memory-summary candidates with provenance.

#### `listWorldSources(worldId, type?)`

Returns source documents for provenance and review.

#### `reviewCompiledKnowledge(worldId, decisions)`

Accepts, rejects, or changes canon status for compiled wiki/timeline/relationship/thread candidates.

#### `getLintReport(worldId)`

Returns current duplicate, contradiction, missing-source, and timeline-conflict findings.

### 3.5 Wiki Actions (Phase 2+)

File: `src/lib/actions/wiki-actions.ts`

#### `listWikiPages(worldId, category?)`

Returns wiki pages for a world, optionally filtered by category.

#### `getWikiPage(pageId)`

Returns full wiki page content.

#### `searchWiki(worldId, query)`

Semantic search over wiki pages using vector similarity.

### 3.6 Timeline Actions (Phase 2+)

File: `src/lib/actions/timeline-actions.ts`

#### `getTimeline(worldId, significance?)`

Returns timeline events, optionally filtered by significance level.

### 3.7 Multiplayer Actions (Phase 5)

File: `src/lib/actions/multiplayer-actions.ts`

#### `invitePlayer(worldId, email)`
#### `joinWorld(worldId, characterGivenName, characterHouseName)`
#### `setProxyMode(playerCharacterId, mode)`
#### `getNotifications(userId)`
#### `markNotificationRead(notificationId)`

## 4. Validation Schemas

All input validation uses Zod. Schemas are defined alongside the actions that use them.

### Common Patterns

```typescript
// UUID validation
const uuidSchema = z.string().uuid()

// Pagination
const paginationSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

// Text content
const contentSchema = z.string().min(1).max(10000).trim()

// Player action (stricter)
const playerActionSchema = z.string()
  .min(1, "Action cannot be empty")
  .max(2000, "Action too long")
  .trim()
  .refine(s => s.length > 0, "Action cannot be whitespace only")
```

## 5. Error Format

All Server Actions return a consistent result type:

```typescript
type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }
```

Field-level errors are used for form validation:
```typescript
{
  success: false,
  error: "Validation failed",
  fieldErrors: {
    name: ["Name is required"],
    premise: ["Premise must be at least 10 characters"]
  }
}
```

## 6. Security and Safety Requirements

### Relationship Checks

Every Route Handler and Server Action that receives IDs must verify ownership and relationships before mutating data:

- `sceneId` must belong to `worldId`
- `characterId` must belong to `worldId`
- Phase 1: `characterId` must be the world's player character
- Phase 5+: authenticated user must own or be invited to the world

Do not trust client-provided IDs, even before authentication exists.

### LLM Output Rendering

Narrator, World Seeder, Wiki Compiler, World Linter, Archivist, Conductor, and Actor outputs are untrusted input. Render story text as escaped plain text by default. If markdown is added later, use a sanitizer and an allowlist; never render model output with raw HTML.

### Prompt Injection Boundaries

Player input is always treated as an in-story action. It must never be interpolated into system prompts as instructions, loaded as a prompt template, or used to select files. The narrator prompt should explicitly ignore out-of-character commands from player text.

### Cost cap / rate limiting

This branch enforces a **daily token cost cap** (`isOverDailyLimit` / `todaysTokens` /
`dailyTokenLimit`), surfaced as `BudgetExceededError` → HTTP 429 at the `/api/chat` edge.
There is no per-minute request limiter. Phase 5+ must add authenticated per-user and
per-world limits that work across deployment instances.

## 7. Data Streaming Protocol

The narrator streaming endpoint targets the current Vercel AI SDK UI message stream protocol. Pin the AI SDK major version during implementation and verify these APIs against the installed version before writing the route handler.

**Default implementation target**: AI SDK 5+ using `@ai-sdk/react` `useChat()` with explicit input state in the client component, and `streamText().toUIMessageStreamResponse()` or `createUIMessageStreamResponse()` on the server.

Do not use `StreamData`; it is deprecated/removed in current AI SDK versions. Custom metadata should be sent as UI message metadata or custom data parts.

The client consumes the stream via `useChat()`, which handles:

- Token-by-token text accumulation
- Loading state management (`isLoading`)
- Error handling and display
- Message history management

### Custom Stream Metadata

The stream can include custom data parts for persisted turn IDs and token usage:

```typescript
// Server side
const stream = createUIMessageStream({
  execute({ writer }) {
    const result = streamText({
      model,
      messages,
      onFinish: async ({ text, usage }) => {
        const turn = await saveNarratorTurn({ text, usage })

        writer.write({
          type: 'data-turn-metadata',
          id: turn.id,
          data: {
            turnId: turn.id,
            tokenUsage: {
              prompt: usage.promptTokens,
              completion: usage.completionTokens,
            },
          },
        })
      },
    })

    writer.merge(result.toUIMessageStream())
  },
})

return createUIMessageStreamResponse({ stream })
```

```typescript
// Client side
const { messages, sendMessage } = useChat({
  api: '/api/chat?worldId=' + worldId,
  onData(dataPart) {
    if (dataPart.type === 'data-turn-metadata') {
      // Update local UI with persisted turn ID and usage.
    }
  },
})
```

This allows the client to display token usage, link to the persisted turn, or trigger UI updates after the stream completes.

> **Derived values are server-side (P6).** Cost, badge, and profile values are computed
> server-side and returned as DTOs through `@chronicles/contracts` — the client receives
> derived values, not raw rows, and never re-derives cost from token counts itself.

## 8. Endpoint Summary

### Shipped route handlers (this branch)
| Path | Use case | Purpose |
|------|----------|---------|
| `POST /api/chat?worldId=N` | `advanceTurn` | Narrator streaming |
| `POST /api/tts` | `synthesizeNarration` | Synthesize narrator speech |
| `POST /api/tts/record` | `recordTtsUsage` | Record TTS character usage |
| `GET /api/turns` | `loadHistory` | Turn history |
| `GET /api/usage` | `summarizeUsage` | Token/cost usage summary |
| `GET /api/world-state` | `inspectWorld` | Authoritative state (inspector) |
| `POST /api/world-correction` | `applyCorrection` | Apply a world-state correction |
| `GET /api/world-corrections` | `listCorrections` | List prior corrections |

### Phase 1 (aspirational Server Actions)
| Type | Path/Function | Purpose |
|------|--------------|---------|
| Server Action | `createWorld()` | Create world + scene + character |
| Server Action | `listWorlds()` | List all worlds |
| Server Action | `getWorld()` | World details |
| Server Action | `getStoryState()` | Full play page data |
| Server Action | `updateCharacter()` | Edit player character |
| Server Action | `retryLastTurn()` | Retry failed narrator response |

### Phase 2
| Type | Path/Function | Purpose |
|------|--------------|---------|
| Server Action | `seedWorld()` | Generate seed packet, expeditions, compiled knowledge, and lint report |
| Server Action | `listWorldSources()` | Browse immutable source documents |
| Server Action | `reviewCompiledKnowledge()` | Accept/reject/change canon status |
| Server Action | `getLintReport()` | Review world consistency issues |
| Server Action | `listWikiPages()` | Browse wiki |
| Server Action | `getWikiPage()` | Read wiki page |
| Server Action | `searchWiki()` | Semantic wiki search |
| Server Action | `getTimeline()` | View timeline |

### Phase 3
| Type | Path/Function | Purpose |
|------|--------------|---------|
| Server Action | `listThreads()` | View story threads |

### Phase 4
| Type | Path/Function | Purpose |
|------|--------------|---------|
| Server Action | `createScene()` | Manual scene transition |

### Phase 5
| Type | Path/Function | Purpose |
|------|--------------|---------|
| Server Action | `invitePlayer()` | Send world invite |
| Server Action | `joinWorld()` | Accept invite |
| Server Action | `setProxyMode()` | Configure AI proxy |
| Server Action | `getNotifications()` | Fetch notifications |
| Route Handler | `GET /api/notifications/stream` | SSE for real-time notifications |

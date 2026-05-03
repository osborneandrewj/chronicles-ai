# API Design

## 1. Overview

The API uses two patterns:

- **Server Actions** — for all CRUD operations triggered by the UI (creating worlds, updating characters, browsing wiki). These are direct function calls from React components, not HTTP endpoints.
- **Route Handlers** — for the streaming narrator endpoint and any future webhooks/external integrations.

There is no REST API layer. Server Actions replace the traditional REST/tRPC pattern for a solo-developer Next.js project.

## 2. Route Handlers

### 2.1 `POST /api/story/stream`

The core endpoint. Accepts a player action and returns a streamed narrator response via Server-Sent Events.

**Request**:
```typescript
{
  worldId: string       // UUID
  sceneId: string       // UUID
  characterId: string   // UUID of the player character
  action: string        // Player's text input (1-2000 chars)
}
```

**Response**: SSE stream (Vercel AI SDK data stream format)

The stream emits:
- Text delta tokens as they generate
- Usage metadata on completion
- Error events if the stream fails

**Flow**:
1. Validate request body with Zod
2. Verify world/scene/character exist and are active
3. Determine next `turn_number` for the scene
4. Insert `player_action` turn into DB
5. Assemble context (retrieval + formatting)
6. Call `streamText()` with Claude Sonnet
7. Stream response to client
8. `onFinish`: Insert `narrator_response` turn with usage metadata

**Error Responses**:
| Status | Condition |
|--------|-----------|
| 400 | Invalid request body (Zod validation) |
| 404 | World, scene, or character not found |
| 409 | Scene is not active |
| 429 | Rate limit exceeded (>30 turns/minute) |
| 500 | LLM call failure |

**Rate Limiting**: Simple in-memory counter per world ID. 30 turns per minute. Resets every 60 seconds. No Redis needed for single-user MVP.

### 2.2 `POST /api/voice/token` (Phase 5)

Returns a temporary token for the TTS service. Deferred.

### 2.3 `GET /api/health`

Simple health check for deployment monitoring.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2026-05-03T00:00:00Z",
  "database": "connected"
}
```

## 3. Server Actions

Server Actions are `"use server"` async functions called directly from React components. They handle validation, database operations, and revalidation.

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
  characterName: z.string().min(1).max(255),
  characterDescription: z.string().max(2000).optional(),
})
```

**Operations** (single transaction):
1. Insert world
2. Insert player character (`is_player: true`)
3. Insert initial scene (scene_number: 1, title: "Opening", status: "active")
4. Redirect to `/worlds/{worldId}/play`

**Returns**: `{ worldId: string }` on success, `{ error: string }` on failure.

#### `updateWorld(worldId, formData)`

Updates world name, premise, genre, tone, or setting_details.

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

Deletes the last narrator response turn (if it has `metadata.stream_error = true`) and resubmits the player's action. Used by the "Retry" button on stream failures.

### 3.3 Character Actions (Phase 1+)

File: `src/lib/actions/character-actions.ts`

#### `updateCharacter(characterId, data)`

Updates character name, description, or traits.

#### `getCharacter(characterId)`

Returns full character details.

### 3.4 Wiki Actions (Phase 2)

File: `src/lib/actions/wiki-actions.ts`

#### `listWikiPages(worldId, category?)`

Returns wiki pages for a world, optionally filtered by category.

#### `getWikiPage(pageId)`

Returns full wiki page content.

#### `searchWiki(worldId, query)`

Semantic search over wiki pages using vector similarity.

### 3.5 Timeline Actions (Phase 2)

File: `src/lib/actions/timeline-actions.ts`

#### `getTimeline(worldId, significance?)`

Returns timeline events, optionally filtered by significance level.

### 3.6 Multiplayer Actions (Phase 4)

File: `src/lib/actions/multiplayer-actions.ts`

#### `invitePlayer(worldId, email)`
#### `joinWorld(worldId, characterName)`
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

## 6. Data Streaming Protocol

The narrator streaming endpoint uses the Vercel AI SDK's data stream protocol. The client consumes it via the `useChat()` hook, which handles:

- Token-by-token text accumulation
- Loading state management (`isLoading`)
- Error handling and display
- Message history management

### Custom Stream Metadata

The `onFinish` callback can send metadata alongside the stream using `StreamData`:

```typescript
// Server side
const data = new StreamData()
data.append({
  turnId: newTurnId,
  tokenUsage: { prompt: usage.promptTokens, completion: usage.completionTokens },
})
data.close()

return result.toDataStreamResponse({ data })
```

```typescript
// Client side
const { messages, data } = useChat({ api: '/api/story/stream' })
// data contains the metadata appended by the server
```

This allows the client to display token usage, link to the persisted turn, or trigger UI updates after the stream completes.

## 7. Endpoint Summary by Phase

### Phase 1
| Type | Path/Function | Purpose |
|------|--------------|---------|
| Route Handler | `POST /api/story/stream` | Narrator streaming |
| Route Handler | `GET /api/health` | Health check |
| Server Action | `createWorld()` | Create world + scene + character |
| Server Action | `listWorlds()` | List all worlds |
| Server Action | `getWorld()` | World details |
| Server Action | `getStoryState()` | Full play page data |
| Server Action | `updateCharacter()` | Edit player character |
| Server Action | `retryLastTurn()` | Retry failed narrator response |

### Phase 2
| Type | Path/Function | Purpose |
|------|--------------|---------|
| Server Action | `listWikiPages()` | Browse wiki |
| Server Action | `getWikiPage()` | Read wiki page |
| Server Action | `searchWiki()` | Semantic wiki search |
| Server Action | `getTimeline()` | View timeline |

### Phase 3
| Type | Path/Function | Purpose |
|------|--------------|---------|
| Server Action | `createScene()` | Manual scene transition |
| Server Action | `listThreads()` | View story threads |

### Phase 4
| Type | Path/Function | Purpose |
|------|--------------|---------|
| Server Action | `invitePlayer()` | Send world invite |
| Server Action | `joinWorld()` | Accept invite |
| Server Action | `setProxyMode()` | Configure AI proxy |
| Server Action | `getNotifications()` | Fetch notifications |
| Route Handler | `GET /api/notifications/stream` | SSE for real-time notifications |

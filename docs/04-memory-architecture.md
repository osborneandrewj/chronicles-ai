# Memory Architecture

## 1. Core Principle

**The LLM does not remember. The system decides what it remembers.**

Every LLM call is stateless. The memory architecture is infrastructure that selects, retrieves, and injects relevant context into each agent's prompt. The quality of the story is directly determined by the quality of the memory system.

## 2. Memory Types

### 2.1 Episodic Memory (What Happened)

Events, actions, dialogue — the raw story timeline.

| Source | Storage | Phase |
|--------|---------|-------|
| Player actions | `turns` table (type: `player_action`) | 1 |
| Narrator responses | `turns` table (type: `narrator_response`) | 1 |
| NPC actions | `turns` table (type: `npc_action`) | 3 |
| Scene summaries | `memory_chunks` (type: `scene_summary`) | 2 |
| Character moments | `memory_chunks` (type: `character_moment`) | 2 |
| Timeline events | `timeline_events` table | 2 |

**Phase 1 retrieval**: Last N turns from the current scene, ordered by `turn_number DESC`.

**Phase 2+ retrieval**: Vector similarity search over `memory_chunks` embeddings, supplemented by recent raw turns.

### 2.2 Semantic Memory (What Is Known)

Facts about the world — character descriptions, locations, lore, relationships.

| Source | Storage | Phase |
|--------|---------|-------|
| World premise | `worlds.premise` | 1 |
| Character profiles | `characters` table | 1 |
| Wiki pages | `wiki_pages` table (with embeddings) | 2 |
| Relationships | `relationships` table | 2 |
| Story threads | `story_threads` table | 2 |

**Phase 1 retrieval**: Direct database lookups — load world, active scene, player character.

**Phase 2+ retrieval**: Direct lookups + vector similarity search over `wiki_pages` embeddings for contextually relevant knowledge.

### 2.3 Procedural Memory (How to Behave)

System prompts, agent rules, output format instructions.

| Source | Storage | Phase |
|--------|---------|-------|
| Narrator system prompt | `prompts/narrator-system.md` | 1 |
| Archivist system prompt | `prompts/archivist-system.md` | 2 |
| Conductor system prompt | `prompts/conductor-system.md` | 3 |
| Actor system prompt | `prompts/actor-system.md` | 3 |

**Retrieval**: Loaded from filesystem at server startup, cached in memory. These are static per deployment — they change only when the developer updates the prompt files.

## 3. Retrieval Pipeline

### 3.1 Phase 1: Simple Retrieval

No vector search. No embeddings. Just structured database queries.

```
Player submits action
  │
  ▼
┌─────────────────────────────────────────┐
│  CONTEXT ASSEMBLER (Phase 1)            │
│                                          │
│  1. Load system prompt (filesystem)      │  ~500 tokens
│  2. Load world (DB: worlds)             │  ~300 tokens
│  3. Load scene (DB: scenes)             │  ~200 tokens
│  4. Load player character (DB: chars)   │  ~200 tokens
│  5. Load recent turns (DB: turns        │  ~4000-6000 tokens
│     WHERE world_id = X                  │
│     ORDER BY created_at DESC            │
│     LIMIT 20)                           │
│  6. Append player action                │  ~100 tokens
│                                          │
│  Total: ~5300-7300 tokens               │
└─────────────────────────────────────────┘
  │
  ▼
Narrator Agent receives assembled context
```

**Why this works for MVP**: With a context window of ~20 turns, a typical story session of 40-60 turns means the narrator "remembers" roughly the last 30-45 minutes of play. Early events drop out of context, but the story remains coherent within the active window. This degradation is the explicit trigger for Phase 2.

### 3.2 Phase 2: Semantic Retrieval

Adds vector similarity search for long-term memory.

```
Player submits action
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│  EMBEDDING STEP                                              │
│                                                              │
│  Embed player action via Voyage AI → query_vector (1024d)   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  RETRIEVAL STEP (parallel queries)                           │
│                                                              │
│  Query 1: Recent turns                                       │
│    SELECT * FROM turns                                       │
│    WHERE world_id = $1                                       │
│    ORDER BY created_at DESC LIMIT 10                         │
│                                                              │
│  Query 2: Relevant memory chunks                             │
│    SELECT content, 1 - (embedding <=> $query) AS score       │
│    FROM memory_chunks                                        │
│    WHERE world_id = $1                                       │
│    ORDER BY embedding <=> $query                             │
│    LIMIT 5                                                   │
│                                                              │
│  Query 3: Relevant wiki pages                                │
│    SELECT title, content, 1 - (embedding <=> $query) AS score│
│    FROM wiki_pages                                           │
│    WHERE world_id = $1                                       │
│    ORDER BY embedding <=> $query                             │
│    LIMIT 3                                                   │
│                                                              │
│  Query 4: Active threads                                     │
│    SELECT * FROM story_threads                               │
│    WHERE world_id = $1 AND status = 'active'                 │
│                                                              │
│  Query 5: Active characters                                  │
│    SELECT * FROM characters                                  │
│    WHERE world_id = $1 AND status = 'active'                 │
│                                                              │
│  Query 6: Recent relationships                               │
│    SELECT * FROM relationships                               │
│    WHERE world_id = $1                                       │
│    ORDER BY updated_at DESC LIMIT 10                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  CONTEXT ASSEMBLER (Phase 2)                                 │
│                                                              │
│  Fill token budget from highest to lowest priority:          │
│                                                              │
│  Priority 1: System prompt                    ~500 tokens    │
│  Priority 2: Current scene + characters       ~400 tokens    │
│  Priority 3: Active story threads             ~300 tokens    │
│  Priority 4: Relevant wiki pages (top-3)      ~1200 tokens   │
│  Priority 5: Relevant memory chunks (top-5)   ~1500 tokens   │
│  Priority 6: Active relationships             ~300 tokens    │
│  Priority 7: Recent raw turns (last 10)       ~3000 tokens   │
│  Priority 8: Player action                    ~100 tokens    │
│                                                              │
│  Budget: 8000 tokens max                                     │
│  If over budget: truncate from Priority 7 first              │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
Narrator Agent receives enriched context
```

### 3.3 Phase 3: Smart Context Assembly

The conductor's decision informs what context to prioritize.

- **`proceed`**: Standard retrieval (Phase 2 pipeline)
- **`scene_transition`**: Emphasize world-level context, de-emphasize recent turns
- **`npc_interlude`**: Load NPC character details at higher priority
- **`activate_proxy`**: Load proxied character's history and personality

## 4. Embedding Strategy

### Model
**Voyage AI `voyage-3-lite`** (Phase 2+)
- 1024 dimensions
- Good balance of quality and cost
- Upgrade path to `voyage-3` if retrieval quality needs improvement

### What Gets Embedded

| Content | When | Stored In |
|---------|------|-----------|
| Memory chunk summaries | After Archivist extraction | `memory_chunks.embedding` |
| Wiki page content | On wiki page create/update | `wiki_pages.embedding` |
| Player actions (for retrieval) | On each player turn | Not stored — embedded at query time |

**Player actions are embedded at query time, not stored.** This avoids storing an embedding per turn (which would grow linearly) and instead uses the current action as the query vector to find relevant memories.

### Embedding Pipeline

```typescript
// Pseudocode for the embedding pipeline

async function embedAndStore(content: string, worldId: string, type: string) {
  // 1. Call Voyage AI
  const embedding = await voyageClient.embed({
    input: content,
    model: "voyage-3-lite",
  })

  // 2. Store in memory_chunks
  await db.insert(memoryChunks).values({
    worldId,
    content,
    chunkType: type,
    embedding: embedding.data[0].embedding,
  })
}

async function queryMemories(action: string, worldId: string, limit: number) {
  // 1. Embed the query
  const queryEmbedding = await voyageClient.embed({
    input: action,
    model: "voyage-3-lite",
  })

  // 2. Vector similarity search
  const results = await db
    .select({
      content: memoryChunks.content,
      similarity: sql`1 - (${memoryChunks.embedding} <=> ${queryEmbedding})`,
    })
    .from(memoryChunks)
    .where(eq(memoryChunks.worldId, worldId))
    .orderBy(sql`${memoryChunks.embedding} <=> ${queryEmbedding}`)
    .limit(limit)

  return results
}
```

### Chunking Strategy

The Archivist produces memory chunks, not the embedding pipeline. Chunks are semantic units, not arbitrary text splits:

| Chunk Type | Created When | Typical Size |
|------------|-------------|-------------|
| `scene_summary` | Scene ends or every 10 turns | 100-200 words |
| `character_moment` | Significant character event | 50-100 words |
| `world_change` | World state changes | 50-100 words |
| `dialogue_highlight` | Important conversation | 50-150 words |

**Why Archivist-generated chunks**: Generic text splitting (every 500 tokens) produces fragments that lack semantic coherence. The Archivist understands narrative structure and produces chunks that represent complete concepts — "Elara discovered the hidden passage behind the waterfall" rather than "...passage behind the waterfall. The water was cold and..."

## 5. Context Assembly Algorithm

### Token Budgeting

```typescript
interface TokenBudget {
  total: number              // 8000 for Sonnet, 4000 for Haiku
  systemPrompt: number       // reserved, ~500
  worldContext: number        // reserved, ~300
  sceneContext: number        // reserved, ~200
  characterContext: number    // reserved, ~200
  remaining: number          // dynamically allocated
}

function assembleContext(params: AssemblyParams): AssembledContext {
  const budget: TokenBudget = {
    total: params.maxTokens ?? 8000,
    systemPrompt: 0,
    worldContext: 0,
    sceneContext: 0,
    characterContext: 0,
    remaining: 0,
  }

  // Step 1: Load fixed-priority content and count tokens
  const systemPrompt = loadPrompt("narrator-system", params.world)
  budget.systemPrompt = estimateTokens(systemPrompt)

  const worldBlock = formatWorldContext(params.world)
  budget.worldContext = estimateTokens(worldBlock)

  const sceneBlock = formatSceneContext(params.scene)
  budget.sceneContext = estimateTokens(sceneBlock)

  const characterBlock = formatCharacterContext(params.character)
  budget.characterContext = estimateTokens(characterBlock)

  // Step 2: Calculate remaining budget
  budget.remaining = budget.total
    - budget.systemPrompt
    - budget.worldContext
    - budget.sceneContext
    - budget.characterContext
    - estimateTokens(params.playerAction)
    - 100  // safety margin

  // Step 3: Fill remaining budget by priority
  const dynamicBlocks: ContentBlock[] = []
  let used = 0

  // Priority: threads > wiki > memories > recent turns
  for (const block of [
    ...formatThreads(params.activeThreads),
    ...formatWikiResults(params.retrievedWiki),
    ...formatMemories(params.retrievedMemories),
    ...formatRecentTurns(params.recentTurns),
  ]) {
    const blockTokens = estimateTokens(block.content)
    if (used + blockTokens <= budget.remaining) {
      dynamicBlocks.push(block)
      used += blockTokens
    } else {
      break  // Budget exhausted
    }
  }

  // Step 4: Assemble final prompt
  return {
    systemPrompt: injectDynamicContent(systemPrompt, {
      worldBlock,
      sceneBlock,
      characterBlock,
      threads: dynamicBlocks.filter(b => b.type === 'thread'),
      wiki: dynamicBlocks.filter(b => b.type === 'wiki'),
      memories: dynamicBlocks.filter(b => b.type === 'memory'),
    }),
    messages: buildMessageArray(
      dynamicBlocks.filter(b => b.type === 'turn'),
      params.playerAction,
      params.character.name,
    ),
  }
}
```

### Token Estimation

For Phase 1, use a simple heuristic: **1 token ≈ 4 characters**. This is accurate within ~10% for English text, which is sufficient for budget allocation.

```typescript
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
```

For Phase 2+, consider using `@anthropic-ai/tokenizer` for precise counts, but only if budget accuracy becomes a problem.

### Relevance Scoring

In Phase 2+, retrieved content has a relevance score (cosine similarity from pgvector). The context assembler uses this to prioritize:

```
Score > 0.85: Highly relevant — always include if budget allows
Score 0.70-0.85: Moderately relevant — include if space remains
Score < 0.70: Weakly relevant — skip unless budget is generous
```

These thresholds will need tuning based on actual retrieval quality.

## 6. Memory Lifecycle

### Creation Flow

```
Narrator generates response
  │
  ▼
Turn saved to DB (raw episodic memory)
  │
  ▼ (async)
Archivist extracts structured data
  │
  ├──▶ Wiki pages created/updated (semantic memory)
  ├──▶ Timeline events created (episodic memory, structured)
  ├──▶ Relationship changes saved (semantic memory)
  ├──▶ Thread updates saved (semantic memory)
  └──▶ Memory summary embedded and stored as memory_chunk (episodic memory, compressed)
```

### Compaction (Future)

As worlds grow very long (1000+ turns), memory chunks accumulate. A future compaction process could:

1. Merge old `scene_summary` chunks into `arc_summary` chunks (multiple scenes → one paragraph)
2. Delete low-significance `character_moment` chunks older than N scenes
3. Re-embed merged chunks for updated vector representations

This is not needed until a world exceeds ~500 turns. Defer to Phase 5 or beyond.

## 7. Context Window Strategy per Agent

| Agent | Max Context | Content Priority |
|-------|-------------|-----------------|
| **Narrator** | ~8000 tokens | System prompt > World/Scene > Threads > Wiki > Memories > Recent turns > Action |
| **Archivist** | ~4000 tokens | System prompt > Current turn > Existing wiki titles > Recent context |
| **Conductor** | ~3000 tokens | System prompt > World state summary > Current scene stats > Player action > Recent summary |
| **Actor** | ~4000 tokens | System prompt > Character profile > Scene > Recent context > Action prompt |

Each agent sees only what it needs. The Narrator gets the richest context. The Conductor gets the sparsest (it makes routing decisions, not creative ones). The Archivist gets the narrator's output plus existing state for diffing. The Actor gets its character's profile and the immediate situation.

## 8. Anti-Patterns to Avoid

### Never Dump Full History
Even if it fits in the context window, sending all turns degrades response quality. LLMs perform worse with excessively long contexts — the signal-to-noise ratio drops. Always use the retrieval pipeline to select the most relevant subset.

### Never Let the LLM Manage Its Own Memory
The LLM should not decide what to remember — the Archivist does that through structured extraction. Don't ask the narrator to "keep track of important facts." It can't. That's what the database is for.

### Never Store Raw Turns as Embeddings
Embedding every raw turn creates a noisy vector space. A turn like "You walk into the tavern" has almost no semantic value. The Archivist's compressed summaries ("The player entered the Rusty Anchor tavern in Port Haven and met Grim, a former soldier who hinted at trouble in the mines") are far better embedding targets.

### Never Share Context Across Agents
Each agent gets its own assembled context. Don't pass the narrator's full prompt to the archivist — the archivist only needs the narrator's output and existing state. This keeps costs down and prevents prompt confusion.

## 9. Monitoring and Debugging

### Metrics to Track (per turn)

| Metric | Stored In | Purpose |
|--------|-----------|---------|
| Prompt tokens | `turns.metadata.prompt_tokens` | Cost tracking, budget validation |
| Completion tokens | `turns.metadata.completion_tokens` | Cost tracking |
| Context turns used | `turns.metadata.context_turns_used` | Memory window health |
| Retrieval scores | `turns.metadata.retrieval_scores` | Retrieval quality |
| Latency | `turns.metadata.latency_ms` | Performance |
| Model | `turns.metadata.model` | Audit |

### Debugging Memory Issues

When the narrator contradicts established facts:
1. Check `context_turns_used` — was the relevant turn in context?
2. Check `retrieval_scores` — was the relevant memory chunk retrieved?
3. If retrieved but still contradicted: prompt engineering issue
4. If not retrieved: embedding quality issue or chunking issue
5. If not in any memory: Archivist failed to extract it

This diagnostic path is why we track metadata on every turn.

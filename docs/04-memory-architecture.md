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
| NPC actions | `turns` table (type: `npc_action`) | 4 |
| Source documents | `world_sources` table | 2 |
| Scene summaries | `memory_chunks` (type: `scene_summary`) | 2 |
| Character moments | `memory_chunks` (type: `character_moment`) | 3 |
| Timeline events | `timeline_events` table | 2 |
| Offscreen NPC events | `timeline_events` + `npc_agendas` | 4 |

**Phase 1 retrieval**: Last N turns from the current scene, ordered by `turn_number DESC`.

**Phase 2 retrieval**: Seeded memories and wiki pages compiled from source documents.

**Phase 3+ retrieval**: Vector similarity search over `memory_chunks` embeddings, supplemented by recent raw turns.

### 2.2 Semantic Memory (What Is Known)

Facts about the world — character descriptions, locations, lore, relationships, and major NPC agendas.

| Source | Storage | Phase |
|--------|---------|-------|
| World premise | `worlds.premise` | 1 |
| Character profiles | `characters` table | 1 |
| NPC relationship anchors | `relationships.metadata` + character profile snippets | 1 |
| Source documents | `world_sources` table | 2 |
| Wiki pages | `wiki_pages` table (with embeddings) | 2 |
| Relationships | `relationships` table | 2 |
| Story threads | `story_threads` table | 2 |
| NPC agendas | `npc_agendas` table | 4 |

**Phase 1 retrieval**: Direct database lookups — load world, active scene, player character, and relationship anchors for present major NPCs when available.

**Phase 2 retrieval**: Direct lookups over compiled seeded wiki/timeline/thread data.

**Phase 3+ retrieval**: Direct lookups + vector similarity search over `wiki_pages` embeddings for contextually relevant knowledge.

### 2.3 Procedural Memory (How to Behave)

System prompts, agent rules, output format instructions.

| Source | Storage | Phase |
|--------|---------|-------|
| Narrator system prompt | `prompts/narrator-system.md` | 1 |
| World Seeder system prompt | `prompts/world-seeder-system.md` | 2 |
| Wiki Compiler system prompt | `prompts/wiki-compiler-system.md` | 2 |
| World Linter system prompt | `prompts/world-linter-system.md` | 2 |
| Archivist system prompt | `prompts/archivist-system.md` | 3 |
| Conductor system prompt | `prompts/conductor-system.md` | 4 |
| Actor system prompt | `prompts/actor-system.md` | 4 |

**Retrieval**: Loaded from filesystem at server startup, cached in memory. These are static per deployment — they change only when the developer updates the prompt files.

### 2.4 Authoritative State (What Is True Now)

Some facts are too important to leave to prose memory or vector retrieval. The system must maintain an authoritative current-state block and inject it into every runtime agent call. This is the layer that prevents common text-adventure failures: characters forgetting where they are, equipment being mistaken for identity, arbitrary deadlines, and player phrasing overriding action outcomes.

Authoritative state includes:

| State | Example | Storage |
|-------|---------|---------|
| In-world time | `Day 12, 13:45`; `mission_launch in 2h 15m` | `worlds.setting_details.clock` in Phase 1; structured tables later |
| Locality | Player is in `Strategium Antechamber`; NPC is in `Hangar Bay 7` | `scenes.location` + `characters.traits.location` |
| Identity | Human origin, rank, public titles, species, faction | `characters.traits.identity` |
| Presentation | Armor, disguise, insignia, visible wounds | `characters.traits.presentation` |
| Negative facts | `not an Ultramarine`; `not an Arch-Confessor` | `characters.traits.identity.not_facts` |
| Active constraints | Locked door, launch deadline, wounded enemy behind cover | `scenes.description`, `story_threads`, `turns.metadata` |
| Tactical state | Objectives, threats, allies, casualties, resources, extraction windows | `scenes.metadata.tactical_state`, `turns.metadata.resolution` |
| Adjudicated outcome | Attack failed, partial success, full success | `turns.metadata.resolution` |
| Major NPC momentum | Warlord left planet; rival's coup clock at 80%; patron is secretly captured | `npc_agendas`, `timeline_events.visibility`, `characters.traits.location` |

This state should be short, structured, and higher priority than retrieved memories. The narrator may embellish it, but must not contradict it.

For action-heavy scenes, the authoritative state builder should condense `scenes.metadata.tactical_state` into a few stable lines: current objective, visible threats, ally condition, casualties, resources, clocks, and extraction status. These facts are more important than recent prose because tactical continuity breaks quickly if wounds, distances, remaining resources, or survival counts drift.

For living-world scenes, the authoritative state builder should include only player-visible agenda consequences: changed NPC locations, public outcomes, plausible rumors, and visible effects on the current location. Hidden agenda details remain available to the Conductor and Living World service, but should not be inserted into player-facing narrator context unless the player has discovered them or the current scene provides a believable source.

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
│  Budget: 8,000 input tokens              │
│  Reserved: 1,024 output tokens           │
│                                          │
│  1. Load system prompt (filesystem)      │  ~500 tokens  [P1, never truncated]
│  2. Load authoritative state            │  ~300-600 tk  [P2, never truncated]
│     (time, locality, identity, visible  │
│      NPCs, immediate constraints,        │
│      tactical state if present)         │
│  3. Load world summary (DB: worlds)     │  ~200-300 tk  [P3]
│  4. Load scene + active characters      │  ~300-500 tk  [P3]
│  5. Load player character (DB: chars)   │  ~200 tokens  [P3]
│  6. Load NPC relationship anchors       │  ~200-500 tk  [P5]
│  7. Load recent turns (DB: turns        │  ~2500-4000 tk [P8, truncated oldest-first]
│     WHERE world_id = X                  │
│     ORDER BY created_at DESC            │
│     LIMIT 20)                           │
│  8. Append player action                │  ~100-300 tk  [P9, never truncated]
│                                          │
│  Worst-case total:                       │  ~5,800 tokens
│  Hard cap:                               │  8,000 tokens
└─────────────────────────────────────────┘
  │
  ▼
Narrator Agent receives assembled context
```

**Why this works for MVP**: With a context window of ~20 turns, a typical story session of 40-60 turns means the narrator "remembers" roughly the last 30-45 minutes of play. Early events drop out of context, but the story remains coherent within the active window. The authoritative state block keeps current reality stable even when older prose falls out of context. Relationship anchors keep major NPCs from forgetting who the player is after the raw turn where they met falls out of context. This degradation is the explicit trigger for seeded knowledge in Phase 2 and live semantic retrieval in Phase 3.

### 3.1.1 Relationship Anchors

For every present major NPC, the context assembler should include a compact relationship anchor when one exists:

```text
Lira Voss knows Joseph Osborne as the officer who negotiated access to the palace bunker. Sentiment: wary-positive. Last meaningful interaction: Joseph protected her from the assassination attempt, then asked for evacuation authority. Known claims: Joseph says he serves Battlefleet command. Open tension: Lira suspects he is withholding intelligence.
```

Relationship anchors are not long summaries. They are durable, high-signal facts that answer "who is this person to me?" for the NPC currently on screen. They should be updated by the Archivist from major relationship turns and stored on `relationships.metadata` using fields such as `known_identity`, `known_titles`, `last_interaction_label`, `last_meaningful_turn_id`, `trust_level`, `promises`, `threats`, `secrets_shared`, and `open_tensions`.

### 3.2 Phase 2: Seeded LLM Wiki Retrieval

Phase 2 introduces source documents and compiled seeded knowledge. User seed text, generated seed packets, simulated expedition logs, imported prior adventure logs, and imported lore are stored in `world_sources`; the wiki compiler turns them into `wiki_pages`, `timeline_events`, `relationships`, `story_threads`, and initial `memory_chunks`.

Seeded knowledge is retrieved directly during play. Canon status is included in context so the narrator can distinguish hard facts from soft canon, rumor, myth, or disputed material.

### 3.3 Phase 3: Semantic Retrieval

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
│                                                              │
│  Query 7: Player-visible NPC agenda consequences             │
│    SELECT active npc_agendas + recent timeline_events         │
│    WHERE agenda.secrecy != 'hidden'                           │
│       OR event.visibility != 'hidden'                         │
│    LIMIT by priority/relevance                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  CONTEXT ASSEMBLER (Phase 3)                                 │
│                                                              │
│  Fill token budget from highest to lowest priority:          │
│                                                              │
│  P1: System prompt                            ~500 tokens    │  [never truncated]
│  P2: Authoritative state                      ~300-600 tk    │  [never truncated]
│  P3: Current scene + active characters        ~300-500 tk    │
│  P4: Active story threads                     ~200-300 tk    │
│  P5: Relationship anchors                     ~200-500 tk    │
│  P5b: Visible NPC agenda consequences         ~200-400 tk    │
│  P6: Relevant wiki pages (top-3)              ~800-1200 tk   │
│  P7: Relevant memory chunks (top-5)           ~1000-1500 tk  │
│  P8: Recent raw turns (last 8-10)             ~2000-2700 tk  │  [truncated oldest-first]
│  P9: Player action                            ~100-300 tk    │  [never truncated]
│                                                              │
│  Hard cap (input): 8,000 tokens                              │
│  Reserved (output): 1,024 tokens                             │
│  Truncation order: drop from P8, then P7, then P6, then P5b/ │
│  P5, then P4, then P3. P1, P2, P9 are mandatory — if their   │
│  combined size exceeds 8,000 tokens, fail with               │
│  ContextOverflowError rather than silently truncate.         │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
Narrator Agent receives enriched context
```

### 3.4 Phase 4: Smart Context Assembly

The conductor's decision informs what context to prioritize.

- **`proceed`**: Standard retrieval (Phase 3 pipeline)
- **`scene_transition`**: Emphasize world-level context, de-emphasize recent turns
- **`npc_interlude`**: Load NPC character details at higher priority
- **`activate_proxy`**: Load proxied character's history and personality
- **`advance_living_world`**: Load active high-relevance NPC agendas, recent timeline events, linked story threads, and current player locality; after advancement, rebuild context from updated authoritative state

## 4. Embedding Strategy

### Model
**Voyage AI `voyage-3-lite`** (Phase 2+)
- 1024 dimensions
- Good balance of quality and cost
- Upgrade path to `voyage-3` if retrieval quality needs improvement

### What Gets Embedded

| Content | When | Stored In |
|---------|------|-----------|
| Seeded memory chunks | During Phase 2 wiki compilation | `memory_chunks.embedding` |
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
| `relationship_moment` | Major emotional shift, betrayal, sacrifice, rescue, grief | 50-100 words |
| `tactical_state_delta` | Objective, threat, wound, casualty, resource, or extraction state changes | 25-75 words |
| `world_change` | World state changes | 50-100 words |
| `npc_agenda_update` | Major offscreen NPC plan advances or resolves | 50-100 words |
| `dialogue_highlight` | Important conversation | 50-150 words |

**Why Archivist-generated chunks**: Generic text splitting (every 500 tokens) produces fragments that lack semantic coherence. The Archivist understands narrative structure and produces chunks that represent complete concepts — "Elara discovered the hidden passage behind the waterfall" rather than "...passage behind the waterfall. The water was cold and..."

**Scene-boundary summaries**: At scene end, and every 10 turns in long scenes, the Archivist should produce a hard-canon scene summary when the events occurred directly in play. The summary should capture objective, outcome, dead, wounded, escaped, resources spent, relationship shifts, new myths/rumors witnessed, unresolved consequences, and the final scene location. These summaries become the durable bridge once raw turns fall out of context.

## 5. Context Assembly Algorithm

### Authoritative State Block

Every runtime prompt should include an authoritative state block before relevant memories and recent turns.

Example:

```text
## Authoritative State

Time: Day 12, 13:45. Mission launch in 2h 15m.
Location: Strategium Antechamber aboard the Saint Drusus.
Player: Human; Lord Commander; formerly cogitator tech, Inquisitor, Lord Inquisitor. Wearing Arch-Confessor power armor. Not an Ultramarine. Not an Arch-Confessor.
Present NPCs: Canoness Vahl, Interrogator Serek.
Not Present: Lord-Castellan Dravik left Karthax six days ago; public rumor says his fleet moved toward Veyr Secundus.
Visible Threats: Wounded heretic behind cover, 8m away.
Tactical State: Objective is extraction; two allies wounded; one melta bomb remains; teleport lock unstable; extraction window 90s.
Immediate Constraints: Blast door sealed; launch deadline is active; enemy has line of sight to the western aisle.
Last Resolved Outcome: The player's last sword strike wounded the heretic's leg but did not sever it.
```

The block is assembled from structured state first and recent extracted facts second. It should be compact enough to fit in every narrator call, even in Phase 1.

### Token Budgeting

```typescript
interface TokenBudget {
  total: number              // 8000 for Sonnet, 4000 for Haiku
  systemPrompt: number       // reserved, ~500
  authoritativeState: number  // reserved, ~300-600 depending on tactical state
  worldContext: number        // reserved, ~300
  sceneContext: number        // reserved, ~200
  characterContext: number    // reserved, ~200
  remaining: number          // dynamically allocated
}

function assembleContext(params: AssemblyParams): AssembledContext {
  const budget: TokenBudget = {
    total: params.maxTokens ?? 8000,
    systemPrompt: 0,
    authoritativeState: 0,
    worldContext: 0,
    sceneContext: 0,
    characterContext: 0,
    remaining: 0,
  }

  // Step 1: Load fixed-priority content and count tokens
  const systemPrompt = loadPrompt("narrator-system", params.world)
  budget.systemPrompt = estimateTokens(systemPrompt)

  const stateBlock = formatAuthoritativeState(params.state)
  budget.authoritativeState = estimateTokens(stateBlock)

  const worldBlock = formatWorldContext(params.world)
  budget.worldContext = estimateTokens(worldBlock)

  const sceneBlock = formatSceneContext(params.scene)
  budget.sceneContext = estimateTokens(sceneBlock)

  const characterBlock = formatCharacterContext(params.character)
  budget.characterContext = estimateTokens(characterBlock)

  // Step 2: Calculate remaining budget
  budget.remaining = budget.total
    - budget.systemPrompt
    - budget.authoritativeState
    - budget.worldContext
    - budget.sceneContext
    - budget.characterContext
    - estimateTokens(params.playerAction)
    - 100  // safety margin

  // Step 3: Fill remaining budget by priority
  const dynamicBlocks: ContentBlock[] = []
  let used = 0

  // Priority: threads > visible NPC agenda consequences > wiki > memories > recent turns
  for (const block of [
    ...formatThreads(params.activeThreads),
    ...formatVisibleAgendaConsequences(params.visibleNpcAgendas),
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
      stateBlock,
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

For Phase 3+, consider using `@anthropic-ai/tokenizer` for precise counts, but only if budget accuracy becomes a problem.

### Relevance Scoring

In Phase 3+, retrieved content has a relevance score (cosine similarity from pgvector). The context assembler uses this to prioritize:

```
Score > 0.85: Highly relevant — always include if budget allows
Score 0.70-0.85: Moderately relevant — include if space remains
Score < 0.70: Weakly relevant — skip unless budget is generous
```

These thresholds will need tuning based on actual retrieval quality.

## 6. Memory Lifecycle

### Creation Flow

```
Living World advancement may update NPC agendas first
  │
  ▼
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
  ├──▶ Tactical state deltas merged into scene metadata
  ├──▶ NPC agenda updates created or adjusted when live play establishes independent NPC plans
  └──▶ Memory summaries embedded and stored as memory_chunks (episodic memory, compressed)
```

### Compaction (Future)

As worlds grow very long (1000+ turns), memory chunks accumulate. A future compaction process could:

1. Merge old `scene_summary` chunks into `arc_summary` chunks (multiple scenes → one paragraph)
2. Delete low-significance `character_moment` chunks older than N scenes
3. Re-embed merged chunks for updated vector representations

This is not needed until a world exceeds ~500 turns. Defer to Phase 6 or beyond.

## 7. Context Window Strategy per Agent

| Agent | Max Context | Content Priority |
|-------|-------------|-----------------|
| **Narrator** | ~8000 tokens | System prompt > Authoritative state > World/Scene > Threads > Wiki > Memories > Recent turns > Action |
| **Archivist** | ~4000 tokens | System prompt > Current turn > Existing wiki titles > Recent context |
| **Conductor** | ~3000 tokens | System prompt > Authoritative state > World state summary > Current scene stats > Player action > Recent summary |
| **Actor** | ~4000 tokens | System prompt > Authoritative state > Character profile > Scene > Recent context > Action prompt |
| **Living World** | ~4000 tokens | System prompt/rules > Active agendas > Elapsed time trigger > Recent player interference > Linked threads |

Each agent sees only what it needs. The Narrator gets the richest context. The Conductor gets the sparsest (it makes routing decisions, not creative ones). The Archivist gets the narrator's output plus existing state for diffing. The Actor gets its character's profile and the immediate situation.

## 8. Anti-Patterns to Avoid

### Never Dump Full History
Even if it fits in the context window, sending all turns degrades response quality. LLMs perform worse with excessively long contexts — the signal-to-noise ratio drops. Always use the retrieval pipeline to select the most relevant subset.

### Never Let the LLM Manage Its Own Memory
The LLM should not decide what to remember — the Archivist does that through structured extraction. Don't ask the narrator to "keep track of important facts." It can't. That's what the database is for.

### Never Let Player Wording Author Outcomes
A player can state intent, not unilateral reality. Treat "I try to cut the heretic's leg" and "I cut the heretic's leg off" as action proposals. The system or Conductor resolves the result, then the Narrator describes that result. This preserves challenge, risk, and the feeling that the world exists outside the player prompt.

### Never Confuse Presentation With Identity
Armor, disguise, insignia, titles, rumors, and public reputation can change how NPCs react, but they do not rewrite the character's underlying identity. Keep identity facts and presentation facts separate in structured state, and include explicit negative facts when the model is likely to infer incorrectly.

### Never Store Raw Turns as Embeddings
Embedding every raw turn creates a noisy vector space. A turn like "You walk into the tavern" has almost no semantic value. The Archivist's compressed summaries ("The player entered the Rusty Anchor tavern in Port Haven and met Grim, a former soldier who hinted at trouble in the mines") are far better embedding targets.

### Never Share Context Across Agents
Each agent gets its own assembled context. Don't pass the narrator's full prompt to the archivist — the archivist only needs the narrator's output and existing state. This keeps costs down and prevents prompt confusion.

### Never Expose Hidden Offscreen State
Hidden agenda events are true in the database but unknown to the player. Do not put hidden timeline events, secret agenda motives, or undiscovered locations into narrator context. Surface them through rumors, investigations, briefings, changed environments, or NPC dialogue only when the current scene gives the player a plausible channel.

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

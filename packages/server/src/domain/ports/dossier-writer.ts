// DossierWriter (Phase 4) — the WRITE seam for the per-world story dossier
// (`story_threads`, `story_clues`, `story_objectives`, `story_resources`). The
// read-only `DossierRepository` stays as-is; this is its write sibling. The
// methods mirror the archivist's prepared statements one-for-one (insert /
// update / *ByTitle / *ByName lookup), so the strangled archivist path can swap
// each statement call for a port call without changing behavior. Dumb CRUD — the
// upsert decision (which title resolves to which id, COALESCE preserve-merge,
// resolved/completed turn stamping) stays in the use case that drives these.
// Inserts return `{ id }`. Async by mandate (spec §5.3).

// The subset of `story_threads` columns the title lookup selects — mirrors the
// archivist's `storyThreadByTitleStmt` projection exactly (the upsert reads
// `kind` / `status` / `relevance_tags_json` off it to compute the next write).
export type StoryThreadLookupRow = {
  id: number
  title: string
  kind: string
  status: string
  summary: string | null
  stakes: string | null
  rewards: string | null
  consequences: string | null
  hidden: string | null
  relevance_tags_json: string
}

// Positional INSERT args, in statement order:
// (world_id, title, kind, status, summary, stakes, rewards, consequences,
//  hidden, relevance_tags_json, source_turn_id).
export type InsertStoryThreadInput = {
  world_id: number
  title: string
  kind: string
  status: string
  summary: string | null
  stakes: string | null
  rewards: string | null
  consequences: string | null
  hidden: string | null
  relevance_tags_json: string
  source_turn_id: number | null
}

// Positional UPDATE args, in statement order:
// (kind, status, summary, stakes, rewards, consequences, hidden,
//  relevance_tags_json, resolved_turn_id, id). The nullable fields are COALESCE'd
// (null = unchanged); relevance_tags_json is a plain assignment.
export type UpdateStoryThreadInput = {
  id: number
  kind: string
  status: string
  summary: string | null
  stakes: string | null
  rewards: string | null
  consequences: string | null
  hidden: string | null
  relevance_tags_json: string
  resolved_turn_id: number | null
}

// INSERT args: (world_id, thread_id, title, detail, implication, status,
// source_turn_id).
export type InsertStoryClueInput = {
  world_id: number
  thread_id: number | null
  title: string
  detail: string | null
  implication: string | null
  status: string
  source_turn_id: number | null
}

// UPDATE args: (thread_id, detail, implication, status, id). thread_id / detail /
// implication are COALESCE'd; status is a plain assignment.
export type UpdateStoryClueInput = {
  id: number
  thread_id: number | null
  detail: string | null
  implication: string | null
  status: string
}

// INSERT args: (world_id, thread_id, title, status, detail, blocker,
// source_turn_id).
export type InsertStoryObjectiveInput = {
  world_id: number
  thread_id: number | null
  title: string
  status: string
  detail: string | null
  blocker: string | null
  source_turn_id: number | null
}

// UPDATE args: (thread_id, status, detail, blocker, completed_turn_id, id).
// thread_id / detail / blocker / completed_turn_id are COALESCE'd; status is a
// plain assignment.
export type UpdateStoryObjectiveInput = {
  id: number
  thread_id: number | null
  status: string
  detail: string | null
  blocker: string | null
  completed_turn_id: number | null
}

// INSERT args: (world_id, owner_character_id, name, kind, status, detail,
// source_turn_id).
export type InsertStoryResourceInput = {
  world_id: number
  owner_character_id: number | null
  name: string
  kind: string | null
  status: string | null
  detail: string | null
  source_turn_id: number | null
}

// UPDATE args: (owner_character_id, kind, status, detail, id). All four are
// COALESCE'd.
export type UpdateStoryResourceInput = {
  id: number
  owner_character_id: number | null
  kind: string | null
  status: string | null
  detail: string | null
}

export interface DossierWriter {
  // story_threads
  threadByTitle(worldId: number, title: string): Promise<StoryThreadLookupRow | null>
  insertThread(input: InsertStoryThreadInput): Promise<{ id: number }>
  updateThread(input: UpdateStoryThreadInput): Promise<void>

  // story_clues
  clueByTitle(worldId: number, title: string): Promise<{ id: number } | null>
  insertClue(input: InsertStoryClueInput): Promise<{ id: number }>
  updateClue(input: UpdateStoryClueInput): Promise<void>

  // story_objectives
  objectiveByTitle(worldId: number, title: string): Promise<{ id: number } | null>
  insertObjective(input: InsertStoryObjectiveInput): Promise<{ id: number }>
  updateObjective(input: UpdateStoryObjectiveInput): Promise<void>

  // story_resources
  resourceByName(worldId: number, name: string): Promise<{ id: number } | null>
  insertResource(input: InsertStoryResourceInput): Promise<{ id: number }>
  updateResource(input: UpdateStoryResourceInput): Promise<void>
}

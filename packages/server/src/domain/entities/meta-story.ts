// MetaStoryBible entity (Phase C, C8). The durable, generated spine of a
// playthrough: why the facility runs these simulations, who the player really
// is, what the friendly crew is hiding, what the player is becoming. Stored on
// the hub (worlds.meta_story_json), pinned into narrator/archivist context, and
// NEVER rendered raw to the player or the inspector — it is revealed only
// through play. Pure type declaration.

export type MetaStoryAct = {
  // A beat on the escalation ladder, in order: friendly posting → first glitch →
  // first awakening → discovering the program → bending reality → the choice.
  title: string
  summary: string
  // Lucidity (D1) at/above which this act becomes reachable.
  lucidityThreshold: number
}

export type MetaStoryBible = {
  // The arc-engine structure this bible instantiates (id from arc-engines).
  arcEngineId: string
  // The personal hook: who is the player, why are they really here.
  question: string
  // A short, evocative proper name the staff use for the institution/program
  // (2–4 words) — the player-facing hub world name. Must NOT name the archetype
  // (no "bunker", "ship", "lab", "monastery"). e.g. "The Cradle Program",
  // "Project Silhouette", "The Meridian Initiative".
  institutionName: string
  // The institution and its true purpose behind the friendly face.
  institution: string
  // What the simulations are really for, and the ticking cost.
  hiddenTruth: string
  // Who inside will burn the player to stay hidden, and who is secretly an ally.
  antagonist: string
  allies: string
  // The escalation ladder, ordered.
  acts: MetaStoryAct[]
  // Recurring figure / phrase / symbol / impossible object that crosses EVERY
  // simulation regardless of era — the bleed channel's source material.
  bleedMotifs: string[]
  // master / free / expose / escape.
  endgameFork: string[]
}

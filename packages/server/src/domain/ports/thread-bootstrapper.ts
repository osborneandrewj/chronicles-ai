// ThreadBootstrapper — the focused fallback that guarantees a world gets at
// least one story_thread when its dossier is empty and story pressure exists.
// Separate from the archivist because Haiku reliably under-fills the optional
// story_threads array inside its big combined patch (verified: 25 turns, the
// MUST mandate fired every turn, zero threads emitted). This is a single-purpose
// call with a REQUIRED threads array — the focused-schema principle that defeats
// the under-fill. Pure port: no SDK / SQL import. The driving step maps the
// result into the existing ArchivistPatch.story_threads shape and persists it
// through the existing applyArchivistPatch → DossierWriter path (no new write).

export type BootstrapThread = {
  title: string
  kind: 'quest' | 'threat' | 'mystery'
  summary: string
  stakes: string | null
  relevanceTags: string[]
}

export type ThreadBootstrapInput = {
  premise: string
  /** A short PLAYER/NARRATOR transcript of the last couple of turns. */
  recentNarration: string
  sceneTitle: string | null
  placeName: string | null
}

export type ThreadBootstrapResult = { threads: BootstrapThread[] }

export interface ThreadBootstrapper {
  /** Returns one (occasionally two) central thread(s), or `{ threads: [] }` on failure. */
  bootstrap(input: ThreadBootstrapInput): Promise<ThreadBootstrapResult>
}

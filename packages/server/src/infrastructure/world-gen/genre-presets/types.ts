// Genre preset type for historical-adventure world creation.
// The hiddenPremise is a rich internal seed NEVER shown to the player —
// only id + label are surfaced to the picker UI.

export type GenrePreset = {
  /** Kebab-case stable identifier, e.g. 'ancient-rome'. */
  id: string
  /** Player-facing display label, e.g. 'Ancient Rome'. */
  label: string
  /** Rich internal premise (3-6 sentences). NEVER shown to the player. */
  hiddenPremise: string
  /** Culture/era tags for name-pool keying, e.g. ['roman']. */
  eraTags: string[]
  /** Mood/genre tone tags, e.g. ['political', 'martial', 'intrigue']. */
  toneTags: string[]
}

// Player->archivist correction scrollback entity (v0.6.6). Pure type
// declaration (spec §3.3). `applied_patch` is the serialized ArchivistPatch
// JSON so a row is self-describing without joining the entity tables.

export type WorldCorrectionRow = {
  id: number
  world_id: number
  turn_id: number | null
  player_text: string
  archivist_reply: string
  applied_patch: string
  created_at: string
}

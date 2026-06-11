// Display-only per-world turn numbering. The single `turns` table uses a global
// autoincrement id shared across all worlds, so a world's first turn can be id
// 910. This maps each global turn id to its 1-based position WITHIN the world,
// for rendering `[t:N]` provenance as a per-world turn number. Storage stays
// global and append-only; this is purely a render-time relabel.
//
// `orderedIds` must already be in chronological order (ascending id), which is
// what getTurnTimestampsForWorld returns.
export function buildTurnNumberMap(orderedIds: number[]): Record<number, number> {
  const map: Record<number, number> = {}
  orderedIds.forEach((id, index) => {
    map[id] = index + 1
  })
  return map
}

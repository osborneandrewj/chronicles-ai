// Pure grouping of character positions into per-place groups. The bounded-world
// sim asks, each tick, "who is in the same room?" — this answers it with no I/O.
// Positions with a null place (a character not currently anywhere) are dropped.
// Group order is stable: a place appears in the order its first occupant does in
// the input, and occupants stay in input order within their group.

export type CharacterPosition = {
  characterId: number
  placeId: number | null
}

export type PlaceGroup = {
  placeId: number
  characterIds: number[]
}

export function groupByPlace(positions: CharacterPosition[]): PlaceGroup[] {
  const groups: PlaceGroup[] = []
  const byPlace = new Map<number, PlaceGroup>()
  for (const { characterId, placeId } of positions) {
    if (placeId === null) continue
    const existing = byPlace.get(placeId)
    if (existing) {
      existing.characterIds.push(characterId)
    } else {
      const group: PlaceGroup = { placeId, characterIds: [characterId] }
      byPlace.set(placeId, group)
      groups.push(group)
    }
  }
  return groups
}

export function coLocatedGroups(positions: CharacterPosition[]): PlaceGroup[] {
  return groupByPlace(positions).filter((group) => group.characterIds.length >= 2)
}

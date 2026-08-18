// Pure. Who can hear/see/speak in the current place. Scene-agnostic.

export type PerceptionElsewhere = {
  name: string
  place: string | null
}

export type PerceptionPin = {
  placeName: string | null
  here: string[]
  elsewhere: PerceptionElsewhere[]
}

export type PerceptionCharacter = {
  name: string
  isPlayer?: boolean
  status?: string | null
  currentPlaceId?: number | null
}

export function buildPerceptionPin(args: {
  placeName: string | null
  present: PerceptionCharacter[]
  known: PerceptionCharacter[]
  placeNameById: Map<number, string>
}): PerceptionPin {
  const here = args.present
    .filter((c) => !c.isPlayer && c.name.trim())
    .map((c) => c.name.trim())
  const hereSet = new Set(here.map((n) => n.toLowerCase()))
  const elsewhere: PerceptionElsewhere[] = []
  for (const c of args.known) {
    if (c.isPlayer || !c.name.trim()) continue
    if (c.status === 'dead') continue
    if (hereSet.has(c.name.trim().toLowerCase())) continue
    const place =
      c.currentPlaceId != null ? (args.placeNameById.get(c.currentPlaceId) ?? null) : null
    elsewhere.push({ name: c.name.trim(), place })
  }
  elsewhere.sort((a, b) => a.name.localeCompare(b.name))
  return { placeName: args.placeName, here, elsewhere }
}

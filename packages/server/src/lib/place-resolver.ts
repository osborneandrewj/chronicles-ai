import type { Place } from '@/domain/entities'
import type { PlaceRepository } from '@/domain/ports/place-repository'
import type { WorldRepository } from '@/domain/ports/world-repository'
import { lookupPlace, type PlaceLookupResult } from '@/lib/map-tools'

// Lazy resolver: runs before the NPC agent / narrator and geocodes any places
// in the world whose geo_status is still 'unresolved'. Each place is attempted
// once — the result (ok | not_found | unavailable) is written back so the next
// turn skips already-resolved rows. Failures don't surface to the player;
// places without geo facts simply don't contribute to the authoritative
// KNOWN PLACES block.

const PER_LOOKUP_TIMEOUT_MS = 4000
const MAX_PARALLEL = 4

// Read/write ports the lazy resolver needs (P5 strangle). The use case (or the
// strangled narrate-turn/opening-turn caller) hands these in from the container;
// the SQLite adapters delegate to the same `lib/db` reader + the verbatim
// updateResolvedStmt, so the SQLite resolve path stays byte-identical. The
// geocode seam (`lookupPlace`) stays a direct import — it's an outbound HTTP
// adapter, not a store.
export type ResolveUnresolvedPlacesDeps = {
  worlds: Pick<WorldRepository, 'getWorld'>
  places: Pick<PlaceRepository, 'forWorld' | 'setGeoResolution'>
}

export async function resolveUnresolvedPlaces(
  deps: ResolveUnresolvedPlacesDeps,
  worldId: number,
): Promise<void> {
  const world = await deps.worlds.getWorld(worldId)
  const region = world?.setting_region ?? null

  // Fantasy / unspecified settings get no real-world bias. We still attempt
  // resolution (the place name might match a real landmark by accident — and
  // that's fine), but skip if there's clearly nothing to anchor: a missing
  // region AND a place name that looks like a generic scene label.
  const rows = (await deps.places.forWorld(worldId)).filter(
    (p) => p.geo_status === 'unresolved',
  )
  if (rows.length === 0) return

  for (let i = 0; i < rows.length; i += MAX_PARALLEL) {
    const batch = rows.slice(i, i + MAX_PARALLEL)
    await Promise.all(batch.map((row) => resolveOne(deps, row, region)))
  }
}

async function resolveOne(
  deps: ResolveUnresolvedPlacesDeps,
  row: Place,
  region: string | null,
): Promise<void> {
  const query = buildLookupQuery(row)
  if (!query) {
    // Nothing usable — mark unavailable so we don't keep checking on every
    // turn. The user can edit the place and re-resolve later if they want.
    await deps.places.setGeoResolution({
      id: row.id,
      status: 'unavailable',
      displayName: null,
      street: null,
      neighborhood: null,
      lat: null,
      lng: null,
    })
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PER_LOOKUP_TIMEOUT_MS)
  let result: PlaceLookupResult
  try {
    result = await lookupPlace(
      { query, region },
      { signal: controller.signal },
    )
  } catch (err) {
    console.error(`[place-resolver] lookup failed for place=${row.id} (${row.name})`, err)
    await deps.places.setGeoResolution({
      id: row.id,
      status: 'unavailable',
      displayName: null,
      street: null,
      neighborhood: null,
      lat: null,
      lng: null,
    })
    return
  } finally {
    clearTimeout(timeout)
  }

  if (result.status === 'ok') {
    await deps.places.setGeoResolution({
      id: row.id,
      status: 'ok',
      displayName: result.displayName ?? null,
      street: result.street ?? null,
      neighborhood: result.neighborhood ?? null,
      lat: typeof result.lat === 'number' ? result.lat : null,
      lng: typeof result.lng === 'number' ? result.lng : null,
    })
    return
  }

  if (result.status === 'not_found') {
    await deps.places.setGeoResolution({
      id: row.id,
      status: 'not_found',
      displayName: null,
      street: null,
      neighborhood: null,
      lat: null,
      lng: null,
    })
    return
  }

  // 'unavailable' or 'error' — mark unavailable, don't retry next turn.
  await deps.places.setGeoResolution({
    id: row.id,
    status: 'unavailable',
    displayName: null,
    street: null,
    neighborhood: null,
    lat: null,
    lng: null,
  })
}

// Prefer the place name; fall back to the first clause of the description if
// the name is too generic ("Opening scene", "The office") to geocode usefully.
function buildLookupQuery(row: Place): string | null {
  const name = row.name.trim()
  if (!name) return null
  // Generic placeholder names that won't geocode meaningfully. We still try
  // them — Nominatim may return nothing, in which case the row is marked
  // not_found and we move on.
  return name
}

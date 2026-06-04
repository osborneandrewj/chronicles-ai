import { db } from '@/lib/db'
import { lookupPlace, type PlaceLookupResult } from '@/lib/map-tools'

// Lazy resolver: runs before the NPC agent / narrator and geocodes any places
// in the world whose geo_status is still 'unresolved'. Each place is attempted
// once — the result (ok | not_found | unavailable) is written back so the next
// turn skips already-resolved rows. Failures don't surface to the player;
// places without geo facts simply don't contribute to the authoritative
// KNOWN PLACES block.

const PER_LOOKUP_TIMEOUT_MS = 4000
const MAX_PARALLEL = 4

type UnresolvedRow = {
  id: number
  name: string
  description: string | null
}

const unresolvedPlacesStmt = db.prepare<[number]>(
  `SELECT id, name, description FROM places
    WHERE world_id = ? AND geo_status = 'unresolved'
    ORDER BY id ASC`,
)

const settingRegionStmt = db.prepare<[number]>(
  'SELECT setting_region FROM worlds WHERE id = ?',
)

const updateResolvedStmt = db.prepare<
  [string, string | null, string | null, string | null, number | null, number | null, number]
>(
  `UPDATE places
      SET geo_status = ?,
          osm_display_name = ?,
          osm_street = ?,
          osm_neighborhood = ?,
          osm_lat = ?,
          osm_lng = ?,
          geo_resolved_at = datetime('now'),
          updated_at = datetime('now')
    WHERE id = ?`,
)

export async function resolveUnresolvedPlaces(worldId: number): Promise<void> {
  const region =
    (settingRegionStmt.get(worldId) as { setting_region: string | null } | undefined)
      ?.setting_region ?? null

  // Fantasy / unspecified settings get no real-world bias. We still attempt
  // resolution (the place name might match a real landmark by accident — and
  // that's fine), but skip if there's clearly nothing to anchor: a missing
  // region AND a place name that looks like a generic scene label.
  const rows = unresolvedPlacesStmt.all(worldId) as UnresolvedRow[]
  if (rows.length === 0) return

  for (let i = 0; i < rows.length; i += MAX_PARALLEL) {
    const batch = rows.slice(i, i + MAX_PARALLEL)
    await Promise.all(batch.map((row) => resolveOne(row, region)))
  }
}

async function resolveOne(row: UnresolvedRow, region: string | null): Promise<void> {
  const query = buildLookupQuery(row)
  if (!query) {
    // Nothing usable — mark unavailable so we don't keep checking on every
    // turn. The user can edit the place and re-resolve later if they want.
    updateResolvedStmt.run('unavailable', null, null, null, null, null, row.id)
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
    updateResolvedStmt.run('unavailable', null, null, null, null, null, row.id)
    return
  } finally {
    clearTimeout(timeout)
  }

  if (result.status === 'ok') {
    updateResolvedStmt.run(
      'ok',
      result.displayName ?? null,
      result.street ?? null,
      result.neighborhood ?? null,
      typeof result.lat === 'number' ? result.lat : null,
      typeof result.lng === 'number' ? result.lng : null,
      row.id,
    )
    return
  }

  if (result.status === 'not_found') {
    updateResolvedStmt.run('not_found', null, null, null, null, null, row.id)
    return
  }

  // 'unavailable' or 'error' — mark unavailable, don't retry next turn.
  updateResolvedStmt.run('unavailable', null, null, null, null, null, row.id)
}

// Prefer the place name; fall back to the first clause of the description if
// the name is too generic ("Opening scene", "The office") to geocode usefully.
function buildLookupQuery(row: UnresolvedRow): string | null {
  const name = row.name.trim()
  if (!name) return null
  // Generic placeholder names that won't geocode meaningfully. We still try
  // them — Nominatim may return nothing, in which case the row is marked
  // not_found and we move on.
  return name
}

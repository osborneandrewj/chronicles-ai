import { tool } from 'ai'
import { z } from 'zod'

type TravelMode = 'driving' | 'walking' | 'cycling'

export type MapRouteResult = {
  status: 'ok' | 'unavailable' | 'not_found' | 'error'
  provider: 'osm' | 'disabled'
  origin: string
  destination: string
  mode: TravelMode
  summary: string
  durationMinutes?: number
  distanceKm?: number
  routeHints?: string[]
  caveats: string[]
}

type FetchLike = typeof fetch

type GeocodeResult = {
  lat: string
  lon: string
  display_name?: string
}

export type PlaceLookupResult = {
  status: 'ok' | 'not_found' | 'unavailable' | 'error'
  query: string
  region: string | null
  displayName?: string
  street?: string
  neighborhood?: string
  city?: string
  lat?: number
  lng?: number
  caveats: string[]
}

type NominatimAddress = {
  road?: string
  pedestrian?: string
  neighbourhood?: string
  suburb?: string
  quarter?: string
  hamlet?: string
  village?: string
  town?: string
  city?: string
  county?: string
  state?: string
  country_code?: string
}

type NominatimDetailedResult = {
  lat: string
  lon: string
  display_name?: string
  address?: NominatimAddress
}

type OsrmRoute = {
  distance: number
  duration: number
  legs?: Array<{
    steps?: Array<{
      name?: string
      ref?: string
      duration?: number
      distance?: number
    }>
  }>
}

type OsrmResponse = {
  code?: string
  routes?: OsrmRoute[]
}

const CACHE = new Map<string, MapRouteResult>()
const PLACE_CACHE = new Map<string, PlaceLookupResult>()
const MAX_CACHE_ENTRIES = 100

const MapRouteInputSchema = z.object({
  origin: z
    .string()
    .min(2)
    .describe('The real-world starting place, address, neighborhood, city, or known place name.'),
  destination: z
    .string()
    .min(2)
    .describe('The real-world destination place, address, neighborhood, city, or known place name.'),
  mode: z
    .enum(['driving', 'walking', 'cycling'])
    .optional()
    .describe('Travel mode. Use driving for car commutes and road trips.'),
})

const PlaceLookupInputSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe(
      'The real-world landmark, business name, address, intersection, or neighborhood to look up ' +
        '(e.g. "Super 1 grocery", "Walmart on Government Way", "Prairie Avenue food trucks").',
    ),
  region: z
    .string()
    .optional()
    .describe(
      'Optional regional context to bias the search (e.g. "Hayden, Idaho, USA"). If omitted, the ' +
        'tool falls back to the world\'s configured setting region. Use this when the player names ' +
        'a place in a different town than the current scene.',
    ),
})

export const narratorMapTools = {
  map_route: tool({
    description:
      'Look up real-world route facts between two places. Use before narrating a real-world drive, commute, road trip, or exact street route when the route or travel time matters.',
    inputSchema: MapRouteInputSchema,
    execute: async ({ origin, destination, mode = 'driving' }, options) =>
      lookupMapRoute({ origin, destination, mode }, { signal: options.abortSignal }),
  }),
  place_lookup: tool({
    description:
      'Look up a real-world landmark, business, address, or neighborhood and return its street, ' +
        'neighborhood, and coordinates. Use BEFORE naming the cross street of a known business, ' +
        'describing what street a landmark is on, or asserting two places are near each other. ' +
        'If KNOWN PLACES already lists a street/neighborhood for the place, trust that instead.',
    inputSchema: PlaceLookupInputSchema,
    execute: async ({ query, region }, options) =>
      lookupPlace({ query, region: region ?? null }, { signal: options.abortSignal }),
  }),
}

export async function lookupMapRoute(
  input: { origin: string; destination: string; mode?: TravelMode },
  options: { fetchFn?: FetchLike; signal?: AbortSignal } = {},
): Promise<MapRouteResult> {
  const origin = input.origin.trim()
  const destination = input.destination.trim()
  const mode = input.mode ?? 'driving'
  const provider = process.env.MAP_ROUTE_PROVIDER ?? 'osm'

  if (provider === 'disabled') {
    return unavailable(origin, destination, mode, 'Map route provider is disabled.')
  }
  if (provider !== 'osm') {
    return unavailable(origin, destination, mode, `Unsupported map route provider: ${provider}.`)
  }

  const cacheKey = [provider, mode, normalize(origin), normalize(destination)].join('|')
  const cached = CACHE.get(cacheKey)
  if (cached) return cached

  const fetchFn = options.fetchFn ?? fetch
  try {
    const [originPoint, destinationPoint] = await Promise.all([
      geocode(origin, fetchFn, options.signal),
      geocode(destination, fetchFn, options.signal),
    ])

    if (!originPoint || !destinationPoint) {
      return remember(
        cacheKey,
        {
          status: 'not_found',
          provider: 'osm',
          origin,
          destination,
          mode,
          summary:
            'Map lookup could not confidently geocode the origin and destination. Avoid exact street names or precise travel time.',
          caveats: ['Geocoding failed for at least one endpoint.'],
        },
      )
    }

    const route = await routeOsrm(originPoint, destinationPoint, mode, fetchFn, options.signal)
    if (!route) {
      return remember(
        cacheKey,
        {
          status: 'not_found',
          provider: 'osm',
          origin,
          destination,
          mode,
          summary:
            'Map lookup could not find a route. Avoid exact street names or precise travel time.',
          caveats: ['Routing failed after geocoding both endpoints.'],
        },
      )
    }

    const durationMinutes = Math.max(1, Math.round(route.duration / 60))
    const distanceKm = Math.round((route.distance / 1000) * 10) / 10
    const routeHints = extractRouteHints(route)
    return remember(cacheKey, {
      status: 'ok',
      provider: 'osm',
      origin: originPoint.display_name ?? origin,
      destination: destinationPoint.display_name ?? destination,
      mode,
      durationMinutes,
      distanceKm,
      routeHints,
      summary: `${mode} route is about ${durationMinutes} minutes and ${distanceKm} km.`,
      caveats: [
        'Use these as grounding facts, not as a turn-by-turn navigation transcript.',
        'Traffic, closures, weather, and local preference may change the real route.',
      ],
    })
  } catch (err) {
    return remember(cacheKey, {
      status: 'error',
      provider: 'osm',
      origin,
      destination,
      mode,
      summary:
        'Map lookup failed. Do not invent exact street names, freeway choices, or precise travel time.',
      caveats: [err instanceof Error ? err.message : String(err)],
    })
  }
}

export async function lookupPlace(
  input: { query: string; region?: string | null },
  options: { fetchFn?: FetchLike; signal?: AbortSignal } = {},
): Promise<PlaceLookupResult> {
  const query = input.query.trim()
  const region = input.region?.trim() || null
  const provider = process.env.MAP_ROUTE_PROVIDER ?? 'osm'

  if (provider === 'disabled' || provider !== 'osm') {
    return {
      status: 'unavailable',
      query,
      region,
      caveats: ['Place lookup provider is disabled. Do not invent specific street or neighborhood names.'],
    }
  }

  const cacheKey = `place|${normalize(query)}|${normalize(region ?? '')}`
  const cached = PLACE_CACHE.get(cacheKey)
  if (cached) return cached

  const fetchFn = options.fetchFn ?? fetch
  try {
    const result = await geocodeDetailed(query, region, fetchFn, options.signal)
    if (!result) {
      return rememberPlace(cacheKey, {
        status: 'not_found',
        query,
        region,
        caveats: [
          `Nominatim could not confidently resolve "${query}"${region ? ` in ${region}` : ''}.`,
          'Do not invent specific street names or neighborhoods for this place.',
        ],
      })
    }
    const address = result.address ?? {}
    const street = address.road ?? address.pedestrian
    const neighborhood =
      address.neighbourhood ?? address.suburb ?? address.quarter ?? address.hamlet
    const city = address.city ?? address.town ?? address.village
    return rememberPlace(cacheKey, {
      status: 'ok',
      query,
      region,
      displayName: result.display_name,
      street,
      neighborhood,
      city,
      lat: Number(result.lat),
      lng: Number(result.lon),
      caveats: [
        'Use these grounding facts when describing the place. Do not contradict street or neighborhood.',
      ],
    })
  } catch (err) {
    return rememberPlace(cacheKey, {
      status: 'error',
      query,
      region,
      caveats: [
        'Place lookup failed. Do not invent specific street names or neighborhoods.',
        err instanceof Error ? err.message : String(err),
      ],
    })
  }
}

async function geocodeDetailed(
  query: string,
  region: string | null,
  fetchFn: FetchLike,
  signal: AbortSignal | undefined,
): Promise<NominatimDetailedResult | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('addressdetails', '1')
  // Bias toward the world's region. Passing `q=<query>, <region>` plus
  // structured params gives Nominatim the strongest hint without locking the
  // search to a single bounding box (which can over-narrow).
  url.searchParams.set('q', region ? `${query}, ${region}` : query)

  const res = await fetchFn(url, {
    signal,
    headers: mapHeaders(),
  })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)

  const data = (await res.json()) as NominatimDetailedResult[]
  return data[0] ?? null
}

function rememberPlace(key: string, result: PlaceLookupResult): PlaceLookupResult {
  PLACE_CACHE.set(key, result)
  if (PLACE_CACHE.size > MAX_CACHE_ENTRIES) {
    const first = PLACE_CACHE.keys().next().value as string | undefined
    if (first) PLACE_CACHE.delete(first)
  }
  return result
}

async function geocode(
  query: string,
  fetchFn: FetchLike,
  signal: AbortSignal | undefined,
): Promise<GeocodeResult | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('q', query)

  const res = await fetchFn(url, {
    signal,
    headers: mapHeaders(),
  })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)

  const data = (await res.json()) as GeocodeResult[]
  return data[0] ?? null
}

async function routeOsrm(
  origin: GeocodeResult,
  destination: GeocodeResult,
  mode: TravelMode,
  fetchFn: FetchLike,
  signal: AbortSignal | undefined,
): Promise<OsrmRoute | null> {
  const profile = mode === 'driving' ? 'driving' : mode
  const coords = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`
  const url = new URL(`https://router.project-osrm.org/route/v1/${profile}/${coords}`)
  url.searchParams.set('overview', 'false')
  url.searchParams.set('alternatives', 'false')
  url.searchParams.set('steps', 'true')

  const res = await fetchFn(url, {
    signal,
    headers: mapHeaders(),
  })
  if (!res.ok) throw new Error(`OSRM ${res.status}`)

  const data = (await res.json()) as OsrmResponse
  if (data.code !== 'Ok') return null
  return data.routes?.[0] ?? null
}

function extractRouteHints(route: OsrmRoute): string[] {
  const seen = new Set<string>()
  const hints: string[] = []
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const label = [step.ref, step.name].filter(Boolean).join(' / ').trim()
      if (!label || seen.has(label)) continue
      seen.add(label)
      hints.push(label)
      if (hints.length >= 8) return hints
    }
  }
  return hints
}

function mapHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    'User-Agent':
      process.env.MAP_TOOL_USER_AGENT ??
      'chronicles-ai/0.6.6 route-grounding (set MAP_TOOL_USER_AGENT)',
  }
}

function remember(key: string, result: MapRouteResult): MapRouteResult {
  CACHE.set(key, result)
  if (CACHE.size > MAX_CACHE_ENTRIES) {
    const first = CACHE.keys().next().value as string | undefined
    if (first) CACHE.delete(first)
  }
  return result
}

function unavailable(
  origin: string,
  destination: string,
  mode: TravelMode,
  reason: string,
): MapRouteResult {
  return {
    status: 'unavailable',
    provider: 'disabled',
    origin,
    destination,
    mode,
    summary: `${reason} Do not invent exact street names or precise travel time.`,
    caveats: [reason],
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

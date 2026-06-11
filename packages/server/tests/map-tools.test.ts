import { afterEach, describe, expect, it } from 'vitest'

import { lookupMapRoute } from '@/lib/map-tools'

const originalProvider = process.env.MAP_ROUTE_PROVIDER

afterEach(() => {
  if (originalProvider === undefined) {
    delete process.env.MAP_ROUTE_PROVIDER
  } else {
    process.env.MAP_ROUTE_PROVIDER = originalProvider
  }
})

describe('lookupMapRoute', () => {
  it('returns duration, distance, and route hints from OSM/OSRM responses', async () => {
    process.env.MAP_ROUTE_PROVIDER = 'osm'
    const fetches: string[] = []
    const fetchFn = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input instanceof URL ? input : new URL(String(input))
      fetches.push(url.toString())

      if (url.hostname === 'nominatim.openstreetmap.org') {
        const query = url.searchParams.get('q') ?? ''
        return Response.json([
          {
            lat: query.includes('Home') ? '47.6' : '47.8',
            lon: query.includes('Home') ? '-117.4' : '-116.8',
            display_name: query,
          },
        ])
      }

      if (url.hostname === 'router.project-osrm.org') {
        return Response.json({
          code: 'Ok',
          routes: [
            {
              duration: 2760,
              distance: 68500,
              legs: [
                {
                  steps: [
                    { name: 'Main Street', distance: 1000, duration: 120 },
                    { ref: 'I 90', name: '', distance: 30000, duration: 1200 },
                    { ref: 'US 95', name: '', distance: 25000, duration: 1000 },
                  ],
                },
              ],
            },
          ],
        })
      }

      throw new Error(`Unexpected URL: ${url.toString()}`)
    }

    const result = await lookupMapRoute(
      { origin: 'Home', destination: 'Work', mode: 'driving' },
      { fetchFn },
    )

    expect(result.status).toBe('ok')
    expect(result.durationMinutes).toBe(46)
    expect(result.distanceKm).toBe(68.5)
    expect(result.routeHints).toEqual(['Main Street', 'I 90', 'US 95'])
    expect(fetches.some((url) => url.includes('/route/v1/driving/'))).toBe(true)
  })

  it('fails closed when the route provider is disabled', async () => {
    process.env.MAP_ROUTE_PROVIDER = 'disabled'

    const result = await lookupMapRoute({
      origin: 'Home',
      destination: 'Work',
      mode: 'driving',
    })

    expect(result.status).toBe('unavailable')
    expect(result.summary).toContain('Do not invent exact street names')
  })

  it('returns not_found when an endpoint cannot be geocoded', async () => {
    process.env.MAP_ROUTE_PROVIDER = 'osm'
    const fetchFn = async (): Promise<Response> => Response.json([])

    const result = await lookupMapRoute(
      { origin: 'Unknown origin', destination: 'Unknown destination' },
      { fetchFn },
    )

    expect(result.status).toBe('not_found')
    expect(result.summary).toContain('Avoid exact street names')
  })
})

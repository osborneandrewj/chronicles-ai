import { describe, expect, it } from 'vitest'

import { filterHubsByGenre } from '@/domain/services/pick-hub-archetype'
import { hubArchetypes } from '@/infrastructure/world-gen/archetypes'

// Genre-coupling audit, Phase 2: non-containment archetypes + genre-filtered hub
// selection, so a historical adventure never awakens into a starship.

describe('expanded archetype registry', () => {
  it('includes the new non-sci-fi hubs', () => {
    const ids = new Set(hubArchetypes().map((a) => a.id))
    for (const id of ['feudal-village', 'castle-keep', 'ziggurat-temple', 'royal-court', 'caravanserai']) {
      expect(ids.has(id), `missing hub ${id}`).toBe(true)
    }
  })
})

describe('filterHubsByGenre', () => {
  const hubs = hubArchetypes()

  it('keeps only era-matching hubs and excludes the starship for a medieval genre', () => {
    const picked = filterHubsByGenre(hubs, ['medieval-english', 'medieval'])
    const ids = picked.map((a) => a.id)
    expect(ids).not.toContain('scout-vessel')
    expect(ids).toContain('feudal-village')
    expect(ids).toContain('castle-keep')
  })

  it('selects the starship for a sci-fi genre', () => {
    const ids = filterHubsByGenre(hubs, ['sci-fi', 'space']).map((a) => a.id)
    expect(ids).toContain('scout-vessel')
    expect(ids).not.toContain('feudal-village')
  })

  it('falls back to the full pool when nothing matches or no tags are given', () => {
    expect(filterHubsByGenre(hubs, ['no-such-tag'])).toHaveLength(hubs.length)
    expect(filterHubsByGenre(hubs, [])).toHaveLength(hubs.length)
  })
})

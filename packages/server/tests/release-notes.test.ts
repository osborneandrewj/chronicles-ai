import { describe, expect, it } from 'vitest'

import pkg from '../package.json'
import { RELEASES } from '@/components/release-notes/data'

// The "What's New" data is hand-authored static content (v0.3.0). These guards
// enforce the release discipline from docs/RELEASING.md so the header→notes link
// never silently goes stale or renders malformed entries.
describe('release notes data', () => {
  it('has at least one release', () => {
    expect(RELEASES.length).toBeGreaterThan(0)
  })

  it('leads with the current package version (every bump prepends an entry)', () => {
    expect(RELEASES[0].version).toBe(pkg.version)
  })

  it('lists releases newest-first by version', () => {
    const toParts = (v: string) => v.split('.').map(Number)
    for (let i = 1; i < RELEASES.length; i += 1) {
      const [aMaj, aMin, aPatch] = toParts(RELEASES[i - 1].version)
      const [bMaj, bMin, bPatch] = toParts(RELEASES[i].version)
      const newer = aMaj > bMaj || (aMaj === bMaj && (aMin > bMin || (aMin === bMin && aPatch > bPatch)))
      expect(newer, `${RELEASES[i - 1].version} should sort before ${RELEASES[i].version}`).toBe(true)
    }
  })

  it('every entry has a valid version, ISO date, and non-empty highlights', () => {
    for (const release of RELEASES) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(release.highlights.length).toBeGreaterThan(0)
      for (const highlight of release.highlights) {
        expect(highlight.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('has no duplicate version entries', () => {
    const versions = RELEASES.map((r) => r.version)
    expect(new Set(versions).size).toBe(versions.length)
  })
})

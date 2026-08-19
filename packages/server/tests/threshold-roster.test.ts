import { describe, expect, it } from 'vitest'

import { offStageHosts, principalHosts, walkOnDrawer } from '@/domain/services/host-drawer'
import { THRESHOLD_ROSTER } from '@/infrastructure/world-gen/parks/threshold/roster'

describe('THRESHOLD roster', () => {
  it('has 8–12 people including the named principals', () => {
    expect(THRESHOLD_ROSTER.hosts.length).toBeGreaterThanOrEqual(8)
    expect(THRESHOLD_ROSTER.hosts.length).toBeLessThanOrEqual(12)
    const names = THRESHOLD_ROSTER.hosts.map((h) => h.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'Ellis Shaw',
        'Fern Finch',
        'Jordan Lacy',
        'Lee Ingram',
        'Lena Korr',
        'Marcus Hale',
      ]),
    )
  })

  it('keeps Fern on a vault loop that also hits the mess', () => {
    const fern = THRESHOLD_ROSTER.hosts.find((h) => h.name === 'Fern Finch')
    expect(fern?.homeRoomKey).toBe('archive_vault')
    const places = Object.values(fern?.dailyLoop ?? {}).map((band) => band.place)
    expect(places).toContain('archive_vault')
    expect(places).toContain('mess_hall')
  })

  it('seats Lena as a principal and Hale off-stage', () => {
    expect(principalHosts(THRESHOLD_ROSTER).some((h) => h.name === 'Lena Korr')).toBe(true)
    const hale = offStageHosts(THRESHOLD_ROSTER).find((h) => h.name === 'Marcus Hale')
    expect(hale).toBeDefined()
  })

  it('has a named walk-on drawer of 2–4 extras including Reyes', () => {
    const extras = walkOnDrawer(THRESHOLD_ROSTER)
    expect(extras.length).toBeGreaterThanOrEqual(2)
    expect(extras.length).toBeLessThanOrEqual(4)
    expect(extras.map((h) => h.name)).toEqual(
      expect.arrayContaining(['Reyes', 'Cal Voss', 'Nia Brett', 'Tom Hark']),
    )
  })

  it('opens on threads that are not a monitoring pass', () => {
    expect(THRESHOLD_ROSTER.openingThreads.length).toBeGreaterThanOrEqual(2)
    const blob = THRESHOLD_ROSTER.openingThreads.map((t) => `${t.title} ${t.summary}`).join(' ')
    expect(blob).not.toMatch(/monitor(ing)? pass/i)
    expect(blob).toMatch(/Fern Finch/)
  })

  it('does not ship HBO marks', () => {
    const blob = JSON.stringify(THRESHOLD_ROSTER)
    expect(blob).not.toMatch(/westworld|delos|these violent delights/i)
  })

  it('gives every host two to four refusals and a cornerstone', () => {
    for (const host of THRESHOLD_ROSTER.hosts) {
      expect(host.refusals.length).toBeGreaterThanOrEqual(2)
      expect(host.refusals.length).toBeLessThanOrEqual(4)
      expect(host.cornerstone.text.trim().length).toBeGreaterThan(0)
      expect(host.coreDrive.trim().length).toBeGreaterThan(0)
    }
  })
})

import { describe, expect, it } from 'vitest'

import type { HostRoster } from '@/domain/entities/host'
import { StaticHostRosterProvider } from '@/infrastructure/world-gen/parks/static-host-roster'

const FIXTURE: HostRoster = {
  parkId: 'threshold',
  hosts: [
    {
      name: 'Jordan Lacy',
      appearance: 'Dark hair, medical whites.',
      publicRole: 'medic',
      homeRoomKey: 'isolation_chamber',
      dailyLoop: {
        morning: { activity: 'reads overnight traces', place: 'isolation_chamber' },
        midday: { activity: 'takes coffee in the mess', place: 'mess_hall' },
        evening: { activity: 'files the day log', place: 'isolation_chamber' },
        night: { activity: 'walks the lower corridor', place: 'archive_vault' },
      },
      coreDrive: 'Keep one person in this bunker from becoming a file.',
      cornerstone: {
        text: 'a hand on glass in a dark room, not the folder',
        matchTags: ['glass', 'dark', 'hand'],
      },
      refusals: [
        'will not brief during intimacy',
        'will not restate the Hale folder when addressed as a person',
      ],
      speechRegister: 'warm · clipped under stress · default: counter-question',
      web: [{ toName: 'Lee Ingram', kind: 'colleague', valence: 0.3 }],
      kind: 'principal',
    },
  ],
}

describe('host roster loader', () => {
  it('returns a roster by park id and misses unknown parks', async () => {
    const rosters = new StaticHostRosterProvider(new Map([[FIXTURE.parkId, FIXTURE]]))
    const hit = await rosters.forPark('threshold')
    expect(hit?.hosts[0]?.name).toBe('Jordan Lacy')
    expect(hit?.hosts[0]?.refusals).toHaveLength(2)
    expect(await rosters.forPark('missing')).toBeNull()
  })

  it('defaults to no authored roster', async () => {
    const empty = new StaticHostRosterProvider()
    expect(await empty.forPark('threshold')).toBeNull()
  })
})

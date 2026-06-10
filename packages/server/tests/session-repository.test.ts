import { describe, expect, it } from 'vitest'

import { SqliteSessionRepository } from '@/infrastructure/persistence/sqlite/session-repository.sqlite'
import { createWorld } from '@/lib/worlds'

const sessions = new SqliteSessionRepository()

function makeWorld(name: string): number {
  return createWorld({
    name: `${name}-${Math.random()}`,
    premise: 'p',
    initialState: { time: 't', location: 'l', identity: 'i', playerName: 'P' },
  }).id
}

describe('SqliteSessionRepository', () => {
  it('creates a session and reads it back by id and by either world', async () => {
    const hub = makeWorld('hub')
    const sub = makeWorld('sub')
    const created = await sessions.create({
      hub_world_id: hub,
      player_identity: 'Andrew',
      subworld_world_id: sub,
    })
    expect(created.status).toBe('in_subworld')
    expect(created.has_awoken).toBe(0)
    expect(created.lucidity).toBe(0)

    expect((await sessions.byId(created.id))?.hub_world_id).toBe(hub)
    // Resolvable from either the hub id or the subworld id.
    expect((await sessions.byWorld(hub))?.id).toBe(created.id)
    expect((await sessions.byWorld(sub))?.id).toBe(created.id)
    expect(await sessions.byWorld(999_999)).toBeNull()
  })

  it('flips status, sets the subworld, awakens, and tracks lucidity', async () => {
    const hub = makeWorld('hub')
    const created = await sessions.create({ hub_world_id: hub, player_identity: 'X' })

    await sessions.setSubworld(created.id, 4242)
    await sessions.flip(created.id, 'in_hub')
    await sessions.setAwoken(created.id, true)
    await sessions.setLucidity(created.id, 3)

    const after = await sessions.byId(created.id)
    expect(after?.subworld_world_id).toBe(4242)
    expect(after?.status).toBe('in_hub')
    expect(after?.has_awoken).toBe(1)
    expect(after?.lucidity).toBe(3)
  })
})

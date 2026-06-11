import { describe, expect, it } from 'vitest'

import {
  archiveWorld,
  createWorld,
  listArchivedWorlds,
  listWorlds,
  unarchiveWorld,
} from '@/lib/worlds'

function seedWorld(name: string): number {
  return createWorld({
    name,
    premise: 'A quiet place where little happens.',
    initialState: {
      time: 'Morning',
      location: 'A harbour',
      identity: 'A newcomer.',
      playerName: 'Tester',
    },
  }).id
}

describe('world archiving', () => {
  it('hides archived worlds from listWorlds and surfaces them in listArchivedWorlds', () => {
    const id = seedWorld(`Archive-${Math.random()}`)

    expect(listWorlds().some((w) => w.id === id)).toBe(true)
    expect(listArchivedWorlds().some((w) => w.id === id)).toBe(false)

    archiveWorld(id)

    expect(listWorlds().some((w) => w.id === id)).toBe(false)
    const archived = listArchivedWorlds().find((w) => w.id === id)
    expect(archived).toBeDefined()
    expect(archived?.archived_at).not.toBeNull()
  })

  it('restores an archived world with unarchiveWorld', () => {
    const id = seedWorld(`Restore-${Math.random()}`)
    archiveWorld(id)
    expect(listWorlds().some((w) => w.id === id)).toBe(false)

    unarchiveWorld(id)

    expect(listWorlds().some((w) => w.id === id)).toBe(true)
    expect(listArchivedWorlds().some((w) => w.id === id)).toBe(false)
  })
})

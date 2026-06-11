import { describe, expect, it } from 'vitest'

import { getContainer } from '@/composition/container'
import { shouldBootstrapThread } from '@/domain/services/story-signal'
import { applyArchivistPatch } from '@/lib/archivist'
import { insertTurn } from '@/lib/db'
import { createWorld } from '@/lib/worlds'

describe('shouldBootstrapThread (fallback gate)', () => {
  it('fires when a bootstrap was warranted and no active thread exists after apply', () => {
    expect(
      shouldBootstrapThread({ bootstrapWarranted: true, hasActiveThreadAfterApply: false }),
    ).toBe(true)
  })

  it('does not fire when the main patch already created an active thread', () => {
    expect(
      shouldBootstrapThread({ bootstrapWarranted: true, hasActiveThreadAfterApply: true }),
    ).toBe(false)
  })

  it('does not fire when no bootstrap was warranted', () => {
    expect(
      shouldBootstrapThread({ bootstrapWarranted: false, hasActiveThreadAfterApply: false }),
    ).toBe(false)
  })
})

describe('thread-bootstrap → archivist patch persistence (mapping shape)', () => {
  it('persists a bootstrapped thread through applyArchivistPatch and surfaces it in the dossier', async () => {
    const world = createWorld({
      name: `bootstrap-${Math.random()}`,
      premise: 'A scribe in Thebes carries a dangerous sealed papyrus.',
      initialState: {
        time: 'Morning',
        location: 'Thebes',
        identity: 'House-of-Life scribe.',
        playerName: 'Andrew',
      },
    })
    const turn = insertTurn(world.id, 'assistant', 'The seal weighs in your sleeve.', null)

    // Mirrors exactly what narrate-turn maps GrokThreadBootstrapper output into.
    await applyArchivistPatch(world.id, turn.id, {
      story_threads: [
        {
          title: 'The Sealed Papyrus',
          kind: 'threat',
          status: 'active',
          summary: 'You carry a sealed papyrus implicating a court conspiracy.',
          stakes: 'Discovery means execution for treason.',
          relevance_tags: ['thebes', 'conspiracy', 'papyrus'],
        },
      ],
    })

    const dossier = await getContainer().dossiers.forWorld(world.id)
    const thread = dossier.threads.find((t) => t.title === 'The Sealed Papyrus')
    expect(thread).toBeDefined()
    expect(thread?.status).toBe('active')
    expect(thread?.kind).toBe('threat')
    expect(JSON.parse(thread?.relevance_tags_json ?? '[]')).toContain('thebes')
  })
})

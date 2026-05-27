import { describe, expect, it } from 'vitest'

import { applyArchivistPatch } from '@/lib/archivist'
import { insertTurn } from '@/lib/db'
import { createWorld } from '@/lib/worlds'
import { formatDossierBlock, formatStateBlock, getNarratorWorldState } from '@/lib/world-state'

function seedWorld(): { worldId: number; turnId: number } {
  const world = createWorld({
    name: `Dossier-${Math.random()}`,
    premise: 'A rain-soaked Imperial investigation.',
    initialState: {
      time: '815.M41.017',
      location: 'Wheat field near a spire',
      identity: 'Newly elevated Inquisitor.',
      playerName: 'Andras Voss',
    },
  })
  const turn = insertTurn(world.id, 'assistant', 'Rain ticks against the fragment.', null)
  return { worldId: world.id, turnId: turn.id }
}

describe('story dossier state', () => {
  it('renders active story pressure into the narrator state block', () => {
    const { worldId, turnId } = seedWorld()
    applyArchivistPatch(worldId, turnId, {
      story_threads: [
        {
          title: 'Identify the relay fragment',
          kind: 'quest',
          summary: 'A fresh relay fragment was found in the field.',
          stakes: 'The saboteur may still be nearby.',
          rewards: 'The investigation gains a clear lead.',
          consequences: 'The signal trail may go cold.',
          hidden: 'A watcher expects Vox to scan it.',
        },
      ],
      story_clues: [
        {
          title: 'Stygies VIII batch mark',
          thread_title: 'Identify the relay fragment',
          detail: 'The serial prefix points to Forge-world Stygies VIII.',
          implication: 'The hardware did not come from a local farm machine.',
        },
      ],
      story_objectives: [
        {
          title: 'Find the transmitter',
          thread_title: 'Identify the relay fragment',
          detail: 'Follow relay evidence toward the spire.',
        },
      ],
    })

    const state = getNarratorWorldState(worldId)
    const block = formatStateBlock(state)

    expect(block).toContain('## STORY DOSSIER')
    expect(block).toContain('### ACTIVE QUESTS')
    expect(block).toContain('Identify the relay fragment')
    expect(block).toContain('rewards: The investigation gains a clear lead.')
    expect(block).toContain('consequences: The signal trail may go cold.')
    expect(block).toContain('hidden pressure')
    expect(block).toContain('Stygies VIII batch mark')
    expect(block).toContain('Find the transmitter')
  })

  it('omits the dossier block when no story pressure exists', () => {
    expect(formatDossierBlock({ threads: [], clues: [], objectives: [], resources: [], timeline: [] })).toBe(
      '',
    )
  })
})

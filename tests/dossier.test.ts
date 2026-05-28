import { describe, expect, it } from 'vitest'

import { applyArchivistPatch } from '@/lib/archivist'
import { applyNpcAgentPatch } from '@/lib/npc-agent'
import { db, insertTurn } from '@/lib/db'
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

  it('renders NPC cognition into the narrator state block', () => {
    const { worldId, turnId } = seedWorld()
    applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Mara Vale',
          description: 'A field analyst with rain in her coat seams.',
          current_place_name: 'Wheat field near a spire',
        },
      ],
    })
    db.prepare(
      `UPDATE characters SET agency_level = 'local'
       WHERE world_id = ? AND name = 'Mara Vale'`,
    ).run(worldId)
    applyNpcAgentPatch(worldId, turnId, {
      npc_updates: [
        {
          name: 'Mara Vale',
          private_beliefs: 'believes the relay fragment was planted as bait',
          reveries: 'rain on wheat recalls the informant she lost outside Hive Tarsus',
          relationship_to_player: 'trusts Andras with evidence but not with motives',
          long_term_agenda: 'protect her informant\nforce the spire to reveal its transmitter',
          tool_access: 'can query field records and auspex logs',
        },
      ],
    })

    const state = getNarratorWorldState(worldId)
    const block = formatStateBlock(state)

    expect(block).toContain('private belief: believes the relay fragment was planted as bait')
    expect(block).toContain('reverie: rain on wheat recalls the informant')
    expect(block).toContain('relationship to protagonist: trusts Andras with evidence')
    expect(block).toContain('agenda:')
    expect(block).toContain('diegetic tools: can query field records and auspex logs')
  })

  it('marks the protagonist row as durable continuity in the narrator state block', () => {
    const { worldId, turnId } = seedWorld()
    applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Andras Voss',
          is_player: true,
          memorable_facts_append: 'carries a concealed bolt pistol at his hip',
        },
      ],
    })

    const state = getNarratorWorldState(worldId)
    const block = formatStateBlock(state)

    expect(block).toContain('Andras Voss (player)')
    expect(block).toContain('continuity: this row is the protagonist')
    expect(block).toContain('carries a concealed bolt pistol')
  })

  it('renders scene pacing context into the narrator state block', () => {
    const { worldId, turnId } = seedWorld()
    applyArchivistPatch(worldId, turnId, {
      scene_context: {
        scene_mood: 'tense',
        pace: 'medium',
        focus: 'action',
      },
    })

    const state = getNarratorWorldState(worldId)
    const block = formatStateBlock(state)

    expect(block).toContain('pacing: mood tense; pace medium; focus action')
  })

  it('renders NPC observations as behavior cues instead of prose-ready observations', () => {
    const { worldId, turnId } = seedWorld()
    applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Mara Vale',
          description: 'A field analyst.',
          current_place_name: 'Wheat field near a spire',
          observations_append: 'noticed Andras repeat the same question twice',
        },
      ],
    })

    const state = getNarratorWorldState(worldId)
    const block = formatStateBlock(state)

    expect(block).toContain('behavior cue: noticed Andras repeat the same question twice')
    expect(block).not.toContain('observed:')
  })
})

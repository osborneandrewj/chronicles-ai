import { describe, expect, it } from 'vitest'

import { getContainer } from '@/composition/container'
import { applyArchivistPatch } from '@/lib/archivist'
import { applyNpcAgentPatch, type NpcAgentDeps } from '@/lib/npc-agent'
import { db, insertTurn } from '@/lib/db'
import { addReveriesForCharacter, getReveriesForCharacters } from '@/lib/reveries'
import { createWorld } from '@/lib/worlds'
import { formatDossierBlock, formatStateBlock } from '@/lib/world-state'
import { loadNarratorState } from './helpers/state-assembly'

// The NPC agent reads/writes through injected ports (P5b); on SQLite the
// container adapters delegate to the same byte-identical SQL.
function npcAgentDeps(): NpcAgentDeps {
  const c = getContainer()
  return {
    characters: c.characters,
    dossiers: c.dossiers,
    npcIntents: c.npcIntents,
    places: c.places,
    reveries: c.reveries,
    unitOfWork: c.unitOfWork,
    worlds: c.worlds,
  }
}

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
  it('renders active story pressure into the narrator state block', async () => {
    const { worldId, turnId } = seedWorld()
    await applyArchivistPatch(worldId, turnId, {
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

    const state = await loadNarratorState(worldId)
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

  it('omits the dossier block when no story pressure exists', async () => {
    expect(formatDossierBlock({ threads: [], clues: [], objectives: [], resources: [], timeline: [] })).toBe(
      '',
    )
  })

  it('renders recently closed threads and objectives without making them primary pressure', async () => {
    const { worldId, turnId } = seedWorld()
    await applyArchivistPatch(worldId, turnId, {
      story_threads: [
        {
          title: 'Identify the relay fragment',
          kind: 'quest',
          status: 'active',
          summary: 'Still open pressure.',
        },
        {
          title: 'The Ledger Job',
          kind: 'quest',
          status: 'resolved',
          summary: 'Manifests delivered last night.',
        },
      ],
      story_objectives: [
        {
          title: 'Find the transmitter',
          thread_title: 'Identify the relay fragment',
          status: 'active',
          detail: 'Follow the signal.',
        },
        {
          title: 'Deliver the manifests',
          thread_title: 'The Ledger Job',
          status: 'completed',
          detail: 'Handed over at the quay.',
        },
      ],
    })

    const state = await loadNarratorState(worldId)
    const block = formatDossierBlock(state.dossier)

    expect(block).toContain('### RECENTLY CLOSED')
    expect(block).toContain('Treat these as settled')
    expect(block).toContain('The Ledger Job')
    expect(block).toContain('(resolved)')
    expect(block).toContain('Deliver the manifests')
    expect(block).toContain('(completed)')
    // Active still first / primary.
    expect(block).toContain('### ACTIVE QUESTS')
    expect(block).toContain('Identify the relay fragment')
    expect(block.indexOf('### ACTIVE QUESTS')).toBeLessThan(block.indexOf('### RECENTLY CLOSED'))
    // Closed must not appear under active quests section lines as playable pressure title-only —
    // primary pressure should be the active quest.
    expect(block).toContain('### PRIMARY PRESSURE')
    const primarySection = block.slice(
      block.indexOf('### PRIMARY PRESSURE'),
      block.indexOf('### ACTIVE QUESTS'),
    )
    expect(primarySection).toContain('Identify the relay fragment')
    expect(primarySection).not.toContain('The Ledger Job')
  })

  it('renders closed-only dossier (no active pressure) with RECENTLY CLOSED', async () => {
    const { worldId, turnId } = seedWorld()
    await applyArchivistPatch(worldId, turnId, {
      story_threads: [
        {
          title: 'The Ledger Job',
          kind: 'quest',
          status: 'resolved',
          summary: 'Finished.',
        },
      ],
    })
    const state = await loadNarratorState(worldId)
    const block = formatDossierBlock(state.dossier)
    expect(block).toContain('## STORY DOSSIER')
    expect(block).toContain('### RECENTLY CLOSED')
    expect(block).toContain('The Ledger Job')
    expect(block).not.toContain('### ACTIVE QUESTS')
  })

  it('caps recently closed threads to three', async () => {
    const { worldId, turnId } = seedWorld()
    const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']
    await applyArchivistPatch(worldId, turnId, {
      story_threads: titles.map((title) => ({
        title,
        kind: 'quest' as const,
        status: 'resolved' as const,
        summary: `${title} done`,
      })),
    })
    const state = await loadNarratorState(worldId)
    const block = formatDossierBlock(state.dossier)
    const closedSection = block.slice(block.indexOf('### RECENTLY CLOSED'))
    const closedTitles = titles.filter((t) => closedSection.includes(t))
    expect(closedTitles.length).toBeLessThanOrEqual(3)
  })

  it('renders NPC cognition into the narrator state block', async () => {
    const { worldId, turnId } = seedWorld()
    await applyArchivistPatch(worldId, turnId, {
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
    await applyNpcAgentPatch(npcAgentDeps(), worldId, turnId, {
      npc_updates: [
        {
          name: 'Mara Vale',
          private_beliefs: 'believes the relay fragment was planted as bait',
          relationship_to_player: 'trusts Andras with evidence but not with motives',
          long_term_agenda: 'protect her informant\nforce the spire to reveal its transmitter',
          tool_access: 'can query field records and auspex logs',
        },
      ],
    })
    // v0.6.18: reveries moved to their own append-only npc_reveries table and
    // render via the formatStateBlock reverie context, not the legacy
    // characters.reveries column. Seed one and pass it through the context.
    const maraId = db
      .prepare(`SELECT id FROM characters WHERE world_id = ? AND name = 'Mara Vale'`)
      .get(worldId) as { id: number }
    addReveriesForCharacter(
      worldId,
      maraId.id,
      [{ text: 'rain on wheat recalls the informant she lost outside Hive Tarsus' }],
      turnId,
    )

    const state = await loadNarratorState(worldId)
    const block = formatStateBlock(state, [], [], {
      byCharacter: getReveriesForCharacters([maraId.id]),
      flaring: new Set(),
    })

    expect(block).toContain('private read (known only to Mara Vale; never state on the page; never let another NPC act on it): believes the relay fragment was planted as bait')
    expect(block).toContain('private subtext (backstory pressure; color tone and choices only, never state on the page): rain on wheat recalls the informant')
    expect(block).toContain('relationship to protagonist: trusts Andras with evidence')
    expect(block).toContain('agenda:')
    expect(block).toContain('diegetic tools: can query field records and auspex logs')
  })

  it('renders speech_register as voice: near attitude for present NPCs', async () => {
    const { worldId, turnId } = seedWorld()
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Mara Vale', description: 'Field analyst.', current_place_name: 'Wheat field near a spire' },
      ],
    })
    db.prepare(
      `UPDATE characters SET agency_level = 'local', speech_register = ?
       WHERE world_id = ? AND name = 'Mara Vale'`,
    ).run('clipped · formal under stress · default: counter-question', worldId)

    const state = await loadNarratorState(worldId)
    const block = formatStateBlock(state)
    expect(block).toContain('voice: clipped · formal under stress')
    expect(block).not.toMatch(/voice:.*player/i)
  })

  it('renders ephemeral speech_hint on planned moves', async () => {
    const { worldId } = seedWorld()
    const state = await loadNarratorState(worldId)
    const block = formatStateBlock(state, [
      {
        npc_name: 'Marcus',
        intent: 'test whether Andrew is lying',
        planned_action: 'turns his chair to face Andrew',
        speech_hint: 'cuts him off; one hard question; no softener',
      },
    ])
    expect(block).toContain('### PLANNED MOVES THIS TURN')
    expect(block).toContain('**Marcus**')
    expect(block).toContain('speech: cuts him off; one hard question; no softener')
  })

  it('marks the protagonist row as durable continuity in the narrator state block', async () => {
    const { worldId, turnId } = seedWorld()
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Andras Voss',
          is_player: true,
          memorable_facts_append: 'carries a concealed bolt pistol at his hip',
        },
      ],
    })

    const state = await loadNarratorState(worldId)
    const block = formatStateBlock(state)

    expect(block).toContain('Andras Voss (player)')
    expect(block).toContain('continuity: this row is the protagonist')
    expect(block).toContain('carries a concealed bolt pistol')
  })

  it('renders scene pacing context into the narrator state block', async () => {
    const { worldId, turnId } = seedWorld()
    await applyArchivistPatch(worldId, turnId, {
      scene_context: {
        scene_mood: 'tense',
        pace: 'medium',
        focus: 'action',
      },
    })

    const state = await loadNarratorState(worldId)
    const block = formatStateBlock(state)

    expect(block).toContain('pacing: mood tense; pace medium; focus action')
  })

  it('moves a dropped object out of the protagonist hands and into the room (drop-bug fix + ITEMS HERE)', async () => {
    const { worldId, turnId } = seedWorld()
    // The protagonist picks up a tracked key.
    await applyArchivistPatch(worldId, turnId, {
      story_resources: [{ name: 'brass key', held_by_name: 'protagonist', salient: true }],
    })
    const carriedBlock = formatStateBlock(await loadNarratorState(worldId))
    expect(carriedBlock).toContain('CARRIED / TRACKED OBJECTS')
    expect(carriedBlock).toContain('brass key')

    // They drop it where they stand. held_by_name:null clears the holder (the
    // COALESCE-only path silently no-op'd this — the live bug); location_name
    // places it in the room.
    await applyArchivistPatch(worldId, turnId, {
      story_resources: [
        { name: 'brass key', held_by_name: null, location_name: 'Wheat field near a spire' },
      ],
    })
    const droppedBlock = formatStateBlock(await loadNarratorState(worldId))
    expect(droppedBlock).toContain('### ITEMS HERE')
    expect(droppedBlock).toMatch(/### ITEMS HERE[^]*brass key/)
    // No longer carried.
    const carriedSection = droppedBlock.split('CARRIED / TRACKED OBJECTS')[1] ?? ''
    expect(carriedSection).not.toContain('brass key')
  })

  it('renders a salient object a present NPC carries as authoritative', async () => {
    const { worldId, turnId } = seedWorld()
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Torres', description: 'A wary courier.', current_place_name: 'Wheat field near a spire' },
      ],
      story_resources: [{ name: 'sealed dossier', held_by_name: 'Torres', salient: true }],
    })

    const block = formatStateBlock(await loadNarratorState(worldId))
    expect(block).toContain('carries (authoritative): sealed dossier')
  })

  it('renders NPC observations as behavior cues instead of prose-ready observations', async () => {
    const { worldId, turnId } = seedWorld()
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Mara Vale',
          description: 'A field analyst.',
          current_place_name: 'Wheat field near a spire',
          observations_append: 'noticed Andras repeat the same question twice',
        },
      ],
    })

    const state = await loadNarratorState(worldId)
    const block = formatStateBlock(state)

    expect(block).toContain('behavior cue: noticed Andras repeat the same question twice')
    expect(block).not.toContain('observed:')
  })
})

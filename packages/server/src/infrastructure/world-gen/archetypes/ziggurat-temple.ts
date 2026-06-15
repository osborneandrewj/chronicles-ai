import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

// A sun-baked temple-state ziggurat where priest-rulers and oracles hold court; the Inner Sanctum at the summit is the simulation room.

export const ZIGGURAT_TEMPLE: WorldArchetype = {
  id: 'ziggurat-temple',
  name: 'Temple-State Ziggurat',
  isHub: true,
  eraTags: ['egyptian'],
  genres: ['ancient', 'egyptian', 'persian', 'greek', 'roman', 'nahua'],
  simulationRoomKey: 'inner_sanctum',
  entryLocationKey: 'temple_steps',
  initialSceneTitle: 'Arrival',
  defaultCharacterLabel: 'Newcomer',
  playerIntroTemplate: 'a newcomer climbing the temple steps, summoned but unsure why',
  rooms: [
    { key: 'temple_steps', name: 'Temple Steps', description: 'A vast stairway of mud-brick and dressed stone climbs the ziggurat\'s flank, each riser worn smooth by generations of bare feet and offering-bearers. Heat shimmers off the terraces above, and the city sprawls small and dust-gold below.', deck: 'terrace', layoutHint: JSON.stringify({ zone: 'entry', x: 0, y: 0 }) },
    { key: 'grand_court', name: 'Grand Court', description: 'A pillared hall open to the sky, its walls painted with processions of gods and tribute, incense curling between columns of palm-trunk timber. Petitioners kneel on the swept clay floor while temple guards watch from the shade.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'center', x: 0, y: 1 }) },
    { key: 'archive', name: 'Tablet Archive', description: 'Rows of niched shelves hold thousands of clay tablets stacked like loaves, the air thick with the smell of dried mud and lamp-oil. Inventories, omens, and sealed decrees rest here in the careful dark, sorted by a logic only the scribes remember.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'side', x: 1, y: 1 }) },
    { key: 'treasury', name: 'Treasury', description: 'A low, windowless vault behind a barred cedar door, heaped with grain measures, lapis, ingots of copper, and the god\'s hoarded silver weighed to the grain. Every coffer bears a clay seal, and nothing leaves without a tally.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'side', x: -1, y: 1 }) },
    { key: 'inner_sanctum', name: 'Inner Sanctum', description: 'At the ziggurat\'s summit stands the holy of holies, a narrow chamber where the cult-statue gazes from gold-leaf eyes and braziers burn day and night. Few are permitted past the threshold, and the air hums with something between smoke and prophecy.', deck: 'summit', layoutHint: JSON.stringify({ zone: 'upper', x: 0, y: 2 }) },
  ],
  edges: [
    { from: 'temple_steps', to: 'grand_court', kind: 'stair', bidirectional: true },
    { from: 'grand_court', to: 'archive', kind: 'passage', bidirectional: true },
    { from: 'grand_court', to: 'treasury', kind: 'passage', bidirectional: true },
    { from: 'grand_court', to: 'inner_sanctum', kind: 'stair', bidirectional: true },
  ],
  crew: [
    { role: 'high_priest', homeRoomKey: 'grand_court', description: 'The shaven-headed ruler of the temple-state, draped in leopard-skin and authority, who speaks for the god and the granary alike. Presides over the Grand Court, where he welcomes and quietly weighs the newcomer.' },
    { role: 'scribe', homeRoomKey: 'archive', description: 'A patient keeper of the clay tablets, reed stylus tucked behind one ear, who can recite where any record lies and which ones remain sealed. Found among the shelves of the Tablet Archive.' },
    { role: 'treasurer', homeRoomKey: 'treasury', description: 'A lean, watchful counter of the god\'s wealth who trusts no hand but his own and tallies every grain twice. Keeps to the Treasury, suspicious of all who come near the vault.' },
    { role: 'oracle', homeRoomKey: 'inner_sanctum', description: 'A veiled seer who sits cross-legged before the cult-statue, half-lost in trance and incense, voice rising from somewhere far away. Found in the Inner Sanctum, having gone under longer than anyone else.' },
  ],
}

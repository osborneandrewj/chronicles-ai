import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

// Cliffside monastery / hidden-order chapterhouse (Phase B, B2). A remote stone
// retreat whose meditation crypt is the simulation room. Five rooms, connected.

export const MONASTERY: WorldArchetype = {
  id: 'monastery',
  name: 'Cliffside Monastery',
  isHub: true,
  eraTags: ['medieval-english', 'medieval'],
  genres: ['medieval', 'medieval-english', 'english', 'arabic'],
  simulationRoomKey: 'meditation_crypt',
  entryLocationKey: 'gatehouse',
  initialSceneTitle: 'Arrival',
  defaultCharacterLabel: 'Novice',
  playerIntroTemplate: 'a novice newly admitted to the order, robes still stiff',
  rooms: [
    {
      key: 'gatehouse',
      name: 'Gatehouse',
      description:
        'A weathered stone arch over the only path up the cliff; a bell rope, a visitors’ ledger, and a view of the sea breaking far below.',
      deck: 'ground',
      layoutHint: JSON.stringify({ zone: 'entry', x: 0, y: 0 }),
    },
    {
      key: 'cloister',
      name: 'Cloister',
      description:
        'A square of covered walkways around a herb garden, worn smooth by centuries of slow footsteps; the place the brothers gather and talk.',
      deck: 'ground',
      layoutHint: JSON.stringify({ zone: 'center', x: 0, y: 1 }),
    },
    {
      key: 'scriptorium',
      name: 'Scriptorium',
      description:
        'A long hall of slanted desks and shuttered windows where the order copies and guards its texts; ink, vellum, and a locked cabinet of older work.',
      deck: 'ground',
      layoutHint: JSON.stringify({ zone: 'side', x: 1, y: 1 }),
    },
    {
      key: 'refectory',
      name: 'Refectory',
      description:
        'A vaulted dining hall with one long table and a pulpit for readings during meals; warm with hearth-smoke and the smell of bread.',
      deck: 'ground',
      layoutHint: JSON.stringify({ zone: 'side', x: -1, y: 1 }),
    },
    {
      key: 'meditation_crypt',
      name: 'Meditation Crypt',
      description:
        'A candle-lit chamber cut into the rock below the chapel, ringed with stone niches; brothers descend here to sit in silence for hours, sometimes days.',
      deck: 'under',
      layoutHint: JSON.stringify({ zone: 'lower', x: 0, y: 2 }),
    },
  ],
  edges: [
    { from: 'gatehouse', to: 'cloister', kind: 'path', bidirectional: true },
    { from: 'cloister', to: 'scriptorium', kind: 'archway', bidirectional: true },
    { from: 'cloister', to: 'refectory', kind: 'archway', bidirectional: true },
    { from: 'cloister', to: 'meditation_crypt', kind: 'stairwell', bidirectional: true },
  ],
  crew: [
    {
      role: 'abbot',
      homeRoomKey: 'cloister',
      description:
        'Leads the order with gentle authority; welcomes the novice warmly and watches them closely. Walks the cloister.',
    },
    {
      role: 'librarian',
      homeRoomKey: 'scriptorium',
      description:
        'Keeps and copies the texts; knows which cabinet stays locked and why. Bent over a desk in the scriptorium.',
    },
    {
      role: 'cellarer',
      homeRoomKey: 'refectory',
      description:
        'Runs the kitchen and stores; the most openly kind of the brothers, full of small comforts. Found in the refectory.',
    },
    {
      role: 'hermit',
      homeRoomKey: 'meditation_crypt',
      description:
        'The eldest brother, who keeps to the crypt and speaks rarely; the one who has gone under the longest. Below, in the dark.',
    },
  ],
}

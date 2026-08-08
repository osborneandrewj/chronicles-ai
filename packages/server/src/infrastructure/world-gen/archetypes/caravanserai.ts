import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

// Caravanserai roadside inn / hidden-order waystation (Phase B). A walled
// travelers' inn whose cellar is the simulation room. Five rooms, connected.

export const CARAVANSERAI: WorldArchetype = {
  id: 'caravanserai',
  name: 'Caravanserai Inn',
  isHub: true,
  eraTags: ['arabic'],
  genres: ['mongol', 'arabic', 'turkish', 'caribbean', 'american', 'persian'],
  simulationRoomKey: 'cellar',
  entryLocationKey: 'stable_yard',
  initialSceneTitle: 'Arrival',
  defaultCharacterLabel: 'Newcomer',
  playerIntroTemplate: 'a newcomer off the road, travel-worn, seeking a bed',
  rooms: [
    {
      key: 'stable_yard',
      name: 'Stable Yard',
      description:
        'A dusty walled courtyard inside the great gate, ringed with watering troughs and tethering posts; camels kneel and horses stamp where every road-weary caravan first halts.',
      deck: 'ground',
      layoutHint: JSON.stringify({ zone: 'entry', x: 0, y: 0 }),
    },
    {
      key: 'common_room',
      name: 'Common Room',
      description:
        'A wide hall of low cushions, copper lamps, and the smoke of strong coffee, where merchants of a dozen tongues haggle, dice, and trade rumor late into the night.',
      deck: 'ground',
      layoutHint: JSON.stringify({ zone: 'center', x: 0, y: 1 }),
    },
    {
      key: 'lodgings',
      name: 'Lodgings',
      description:
        'A row of narrow sleeping cells off a shaded gallery, each with a straw pallet and a barred shutter; the only quiet in the place, and the only locks.',
      deck: 'ground',
      layoutHint: JSON.stringify({ zone: 'side', x: 1, y: 1 }),
    },
    {
      key: 'kitchen',
      name: 'Kitchen',
      description:
        'A hot, fragrant room of clay ovens and hanging spices, flatbread slapped against the walls and a great pot of stew always on the coals for whoever arrives hungry.',
      deck: 'ground',
      layoutHint: JSON.stringify({ zone: 'side', x: -1, y: 1 }),
    },
    {
      key: 'cellar',
      name: 'Cellar',
      description:
        'A cool vaulted undercroft beneath the inn, lined with grain sacks, oil jars, and wine; the lamplight ends at a far wall where older, locked things are kept.',
      deck: 'under',
      layoutHint: JSON.stringify({ zone: 'lower', x: 0, y: 2 }),
    },
  ],
  edges: [
    { from: 'stable_yard', to: 'common_room', kind: 'door', bidirectional: true },
    { from: 'common_room', to: 'lodgings', kind: 'passage', bidirectional: true },
    { from: 'common_room', to: 'kitchen', kind: 'door', bidirectional: true },
    { from: 'common_room', to: 'cellar', kind: 'stair', bidirectional: true },
  ],
  crew: [
    {
      role: 'host',
      homeRoomKey: 'common_room',
      description:
        'The caravanserai’s keeper, who names the price of a bed and hears every traveler’s story before they have finished their first cup. Moves among the cushions of the common room.',
    },
    {
      role: 'ostler',
      homeRoomKey: 'stable_yard',
      description:
        'Tends the camels and horses with rough patience and sees who comes and goes, which roads are fresh on their hooves and which loads ride heavy. Found in the stable yard.',
    },
    {
      role: 'cook',
      homeRoomKey: 'kitchen',
      description:
        'Feeds the road-weary without asking questions, yet trades freely in gossip carried from every caravan to pass the gate. Sweating over the ovens in the kitchen.',
    },
    {
      role: 'cellarer',
      homeRoomKey: 'cellar',
      description:
        'Guards the stores and the inn’s hidden things, the one who has gone under longest and speaks least. Below, among the jars in the dark.',
    },
  ],
}

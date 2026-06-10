import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

// Cold-War underground bunker (Phase B, B2). A sealed government installation
// whose isolation chamber is the simulation room. Five rooms, connected.

export const BUNKER: WorldArchetype = {
  id: 'bunker',
  name: 'Underground Bunker',
  isHub: true,
  simulationRoomKey: 'isolation_chamber',
  entryLocationKey: 'blast_doors',
  initialSceneTitle: 'Arrival',
  defaultCharacterLabel: 'New Posting',
  playerIntroTemplate: 'newly assigned to the installation, clearance freshly stamped',
  rooms: [
    {
      key: 'blast_doors',
      name: 'Blast Doors',
      description:
        'A meter-thick steel airlock at the bottom of a long concrete stair; a guard desk, a logbook, and the constant hum of forced ventilation.',
      deck: '-1',
      layoutHint: JSON.stringify({ zone: 'entry', x: 0, y: 0 }),
    },
    {
      key: 'operations',
      name: 'Operations Room',
      description:
        'A low room of map tables, teletypes, and a wall of clocks set to distant capitals; the nerve center, never fully quiet.',
      deck: '-1',
      layoutHint: JSON.stringify({ zone: 'core', x: 0, y: 1 }),
    },
    {
      key: 'mess_hall',
      name: 'Mess Hall',
      description:
        'A cramped canteen of bolted tables and a coffee urn that never empties; where the skeleton crew trade rumors on long shifts.',
      deck: '-1',
      layoutHint: JSON.stringify({ zone: 'side', x: 1, y: 1 }),
    },
    {
      key: 'archive_vault',
      name: 'Archive Vault',
      description:
        'A fireproof room of locked filing cabinets and a single reading table under a caged bulb; the files no one above ground admits exist.',
      deck: '-2',
      layoutHint: JSON.stringify({ zone: 'lower', x: -1, y: 1 }),
    },
    {
      key: 'isolation_chamber',
      name: 'Isolation Chamber',
      description:
        'A padded, soundproofed room with a single reclining couch and a tangle of monitoring leads; subjects are sealed in here for the deep sessions.',
      deck: '-2',
      layoutHint: JSON.stringify({ zone: 'lower', x: 0, y: 2 }),
    },
  ],
  edges: [
    { from: 'blast_doors', to: 'operations', kind: 'corridor', bidirectional: true },
    { from: 'operations', to: 'mess_hall', kind: 'corridor', bidirectional: true },
    { from: 'operations', to: 'archive_vault', kind: 'stairwell', bidirectional: true },
    { from: 'archive_vault', to: 'isolation_chamber', kind: 'door', bidirectional: true },
  ],
  crew: [
    {
      role: 'commander',
      homeRoomKey: 'operations',
      description:
        'Runs the installation by the book but takes to the new posting at once; carries the weight of orders from above. In operations.',
    },
    {
      role: 'analyst',
      homeRoomKey: 'archive_vault',
      description:
        'Pores over the files for patterns; friendly, sharp, and starting to ask the wrong questions. Down in the vault.',
    },
    {
      role: 'quartermaster',
      homeRoomKey: 'mess_hall',
      description:
        'Keeps the bunker fed and supplied; the warmest face down here, trading coffee for gossip. In the mess.',
    },
    {
      role: 'medic',
      homeRoomKey: 'isolation_chamber',
      description:
        'Monitors the subjects during the deep sessions; quietly troubled by what the readings show. By the chamber.',
    },
  ],
}

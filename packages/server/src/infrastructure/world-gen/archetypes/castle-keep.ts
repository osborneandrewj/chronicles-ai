import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

// A fortified medieval keep ruled from the solar; the chapel undercroft beneath the hall is the simulation room.

export const CASTLE_KEEP: WorldArchetype = {
  id: 'castle-keep',
  name: 'Castle Keep',
  isHub: true,
  eraTags: ['medieval-english', 'medieval'],
  genres: ['medieval', 'medieval-english', 'english', 'french'],
  simulationRoomKey: 'undercroft',
  entryLocationKey: 'gatehouse',
  initialSceneTitle: 'Arrival',
  defaultCharacterLabel: 'Newcomer',
  playerIntroTemplate: 'a newcomer admitted at the gate, business unstated',
  rooms: [
    { key: 'gatehouse', name: 'Gatehouse', description: 'A low stone arch guarded by an iron portcullis, its murder-holes black overhead and the cold smell of the moat seeping up through the cobbles. Guards lean on their halberds where the drawbridge chains run taut into the dark.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'entry', x: 0, y: 0 }) },
    { key: 'great_hall', name: 'Great Hall', description: 'A vast smoke-blackened chamber hung with faded banners and antlered trophies, a fire roaring in the central hearth and trestle tables scarred by a hundred feasts. Every door of the keep opens, sooner or later, onto this hall.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'center', x: 0, y: 1 }) },
    { key: 'solar', name: 'Solar', description: 'The lord\'s private upper chamber, warmed by its own fire and lit through narrow glazed windows, with carved chairs, a curtained bed, and a writing-desk of dark oak. Here the keep\'s real business is settled, far above the noise below.', deck: 'upper', layoutHint: JSON.stringify({ zone: 'upper', x: 1, y: 1 }) },
    { key: 'barracks', name: 'Barracks', description: 'A long, draughty room of straw pallets and racked weapons, the air thick with leather, oil, and woodsmoke. Mail shirts hang from pegs along the wall, and dice rattle wherever the garrison is off duty.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'side', x: -1, y: 1 }) },
    { key: 'undercroft', name: 'Undercroft', description: 'A vaulted cellar of cold worked stone beneath the hall, half store-room and half chapel, where guttering candles light a small altar between casks of wine and salted meat. The damp swallows every sound, and few of the household come down willingly.', deck: 'under', layoutHint: JSON.stringify({ zone: 'lower', x: 0, y: 2 }) },
  ],
  edges: [
    { from: 'gatehouse', to: 'great_hall', kind: 'gate', bidirectional: true },
    { from: 'great_hall', to: 'solar', kind: 'stair', bidirectional: true },
    { from: 'great_hall', to: 'barracks', kind: 'passage', bidirectional: true },
    { from: 'great_hall', to: 'undercroft', kind: 'stair', bidirectional: true },
  ],
  crew: [
    { role: 'steward', homeRoomKey: 'great_hall', description: 'A sharp-eyed, soberly dressed man who runs the whole household down to the last candle-stub and forgets nothing he is owed. He is the first to greet a newcomer, and keeps to the great hall.' },
    { role: 'lady', homeRoomKey: 'solar', description: 'The lady of the keep, gracious and unhurried, the quiet power behind every decision the lord believes he made alone. She is found in the solar, bent over her embroidery.' },
    { role: 'captain', homeRoomKey: 'barracks', description: 'A scarred, plain-spoken veteran who commands the garrison and trusts no face he has not learned to read. He is found in the barracks, drilling his men or sharpening his own blade.' },
    { role: 'chaplain', homeRoomKey: 'undercroft', description: 'A pale, soft-voiced priest who tends the chapel below and has spent longer in the dark than anyone living in the keep. He is found in the undercroft, among the candles and the casks.' },
  ],
}

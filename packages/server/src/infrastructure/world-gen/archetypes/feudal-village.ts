import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

// A muddy medieval village clustered around the green; the simulation room is the shrine_undercroft beneath the chapel.

export const FEUDAL_VILLAGE: WorldArchetype = {
  id: 'feudal-village',
  name: 'Feudal Village',
  isHub: true,
  eraTags: ['medieval-english', 'medieval'],
  genres: ['medieval', 'medieval-english', 'english'],
  simulationRoomKey: 'shrine_undercroft',
  entryLocationKey: 'village_green',
  initialSceneTitle: 'Arrival',
  defaultCharacterLabel: 'Newcomer',
  playerIntroTemplate: 'a newcomer arriving on the road, dust on your boots',
  rooms: [
    { key: 'village_green', name: 'Village Green', description: 'A rutted common of trampled grass where geese scatter and the old stocks lean empty beside the well. Every road in the parish bleeds toward this muddy heart, and every villager passes through it before noon.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'center', x: 0, y: 0 }) },
    { key: 'lords_hall', name: "Lord's Hall", description: 'A timber-framed manor house ringed by a low palisade, its hearth-smoke rising over the thatch of lesser roofs. Within, rushes cover the floor and the lord’s tithes are counted on a long oak board.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'side', x: 1, y: 0 }) },
    { key: 'market_row', name: 'Market Row', description: 'A crooked lane of trestle stalls hung with salt fish, woad-dyed cloth, and wheels of pale cheese. On market days the haggling carries clear across the green, and little is bought without half the village hearing of it.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'side', x: -1, y: 0 }) },
    { key: 'smithy', name: 'Smithy', description: 'A soot-blackened forge open to the lane, where the bellows wheeze and sparks die in the dirt. Horseshoes, billhooks, and broken plough-irons wait in heaps for the hammer.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'side', x: 0, y: 1 }) },
    { key: 'shrine_undercroft', name: 'Shrine Undercroft', description: 'A vaulted stone cellar beneath the wattle chapel, cold and candle-lit, where the bones of old saints rest in iron-bound chests. The villagers come down here to pray, to confess, and to leave the things they would not speak of above ground.', deck: 'under', layoutHint: JSON.stringify({ zone: 'lower', x: 0, y: 2 }) },
  ],
  edges: [
    { from: 'village_green', to: 'lords_hall', kind: 'path', bidirectional: true },
    { from: 'village_green', to: 'market_row', kind: 'path', bidirectional: true },
    { from: 'village_green', to: 'smithy', kind: 'path', bidirectional: true },
    { from: 'village_green', to: 'shrine_undercroft', kind: 'stair', bidirectional: true },
  ],
  crew: [
    { role: 'reeve', homeRoomKey: 'lords_hall', description: 'The lord’s man who runs the village in his name, tallying labour-dues and weighing every newcomer for trouble or profit. Keeps to the Lord’s Hall, ledger never far from his hand.' },
    { role: 'marketwife', homeRoomKey: 'market_row', description: 'A sharp-eyed trader with a tongue for gossip and a memory for debts, who knows everyone’s business before they know it themselves. Holds court at her stall along Market Row.' },
    { role: 'smith', homeRoomKey: 'smithy', description: 'Broad-shouldered and taciturn, the quiet strength the whole village leans on when iron or muscle is wanted. Found at the anvil in the smithy, hammer in hand.' },
    { role: 'priest', homeRoomKey: 'shrine_undercroft', description: 'A stooped keeper of the shrine who guards the village’s sins and secrets behind a mild face, and has gone down into the undercroft longer than any living soul. Found tending the candles in the shrine undercroft.' },
  ],
}

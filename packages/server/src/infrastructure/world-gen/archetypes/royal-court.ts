import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

// An imperial court of marble and intrigue; the meditation garden is the simulation room where the old sage tends his riddles.

export const ROYAL_COURT: WorldArchetype = {
  id: 'royal-court',
  name: 'Royal Court',
  isHub: true,
  eraTags: ['chinese'],
  genres: ['chinese', 'turkish', 'roman', 'english', 'persian'],
  simulationRoomKey: 'meditation_garden',
  entryLocationKey: 'throne_hall',
  initialSceneTitle: 'Arrival',
  defaultCharacterLabel: 'Newcomer',
  playerIntroTemplate: 'a newcomer presented at court, station not yet fixed',
  rooms: [
    { key: 'throne_hall', name: 'Throne Hall', description: 'A vast vaulted chamber where lacquered pillars march toward a dais of carved jade, and every word spoken beneath the high dragon-beams is weighed by a hundred listening ears. Petitioners kneel on cold stone while the sovereign\'s judgments fall like edicts of heaven.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'center', x: 0, y: 0 }) },
    { key: 'antechamber', name: 'Antechamber', description: 'A long waiting hall hung with silk screens and the smell of sandalwood, where supplicants linger for hours and a single nod from the right official decides who is admitted and who is turned away. Whispers and bribes pass here as freely as tea.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'side', x: 0, y: 1 }) },
    { key: 'private_quarters', name: 'Private Quarters', description: 'Behind embroidered curtains and a guarded threshold lie the inner apartments, warm with brazier-light and perfume, where the truths too dangerous for the throne hall are murmured across pillows. Few are ever invited past the lacquered doors.', deck: 'upper', layoutHint: JSON.stringify({ zone: 'upper', x: 1, y: 1 }) },
    { key: 'council_chamber', name: 'Council Chamber', description: 'A sober room of ledgers, maps, and ink-stained desks where the machinery of the realm grinds on long after the court has emptied. Here taxes are reckoned, armies provisioned, and rivals quietly undone with a brushstroke.', deck: 'ground', layoutHint: JSON.stringify({ zone: 'side', x: -1, y: 1 }) },
    { key: 'meditation_garden', name: 'Meditation Garden', description: 'A walled refuge of raked gravel, koi ponds, and a gnarled plum tree, where the noise of the palace fades to birdsong and the trickle of water. Those who walk its winding paths come seeking either silence or the one man who still speaks plainly.', deck: 'garden', layoutHint: JSON.stringify({ zone: 'outer', x: 0, y: 2 }) },
  ],
  edges: [
    { from: 'throne_hall', to: 'antechamber', kind: 'passage', bidirectional: true },
    { from: 'antechamber', to: 'private_quarters', kind: 'corridor', bidirectional: true },
    { from: 'antechamber', to: 'council_chamber', kind: 'passage', bidirectional: true },
    { from: 'throne_hall', to: 'meditation_garden', kind: 'gate', bidirectional: true },
  ],
  crew: [
    { role: 'chamberlain', homeRoomKey: 'antechamber', description: 'A smooth, watchful steward who controls who reaches the throne and who is left to wait, missing nothing and forgetting nothing. Found gliding through the antechamber, marking each arrival.' },
    { role: 'consort', homeRoomKey: 'private_quarters', description: 'The sovereign\'s closest confidant and the real power behind the painted screen, her counsel shaping decrees the council never sees. Found within the private quarters, beyond the guarded threshold.' },
    { role: 'minister', homeRoomKey: 'council_chamber', description: 'A patient bureaucrat who runs the realm\'s ledgers and armies and plays a game measured in years, not days. Found bent over his desks in the council chamber.' },
    { role: 'sage', homeRoomKey: 'meditation_garden', description: 'An old advisor who has outlasted three sovereigns, tending the plum tree and answering questions only with riddles. Found among the raked gravel of the meditation garden.' },
  ],
}

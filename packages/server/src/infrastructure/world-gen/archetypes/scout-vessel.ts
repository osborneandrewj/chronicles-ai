import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

// Deep-space scout vessel — one hub archetype among many (Phase B, B2). Six
// rooms across two decks, a single connected corridor/ladder graph, four crew
// slots. The sim deck doubles as the simulation room the player surfaces into on
// awakening. Genericised from the old single SCOUT_TEMPLATE — the ship is now
// row 1 of a data-driven registry, not a privileged path.

export const SCOUT_VESSEL: WorldArchetype = {
  id: 'scout-vessel',
  name: 'Deep-Space Scout Vessel',
  isHub: true,
  eraTags: ['sci-fi', 'space'],
  simulationRoomKey: 'sim_deck',
  entryLocationKey: 'bridge',
  initialSceneTitle: 'Arrival',
  defaultCharacterLabel: 'Newcomer',
  playerIntroTemplate: 'the newest member of the crew, just come aboard',
  rooms: [
    {
      key: 'bridge',
      name: 'Bridge',
      description:
        'The forward command deck: a cramped horseshoe of consoles wrapped around a single viewport, flight and sensor stations within arm’s reach of each other.',
      deck: 'A',
      layoutHint: JSON.stringify({ zone: 'fore', x: 0, y: 0 }),
    },
    {
      key: 'mess',
      name: 'Mess',
      description:
        'A communal galley and eating space amidships — a fold-down table, a recycler dispenser, and the only place aboard where the whole crew passes through in a day.',
      deck: 'A',
      layoutHint: JSON.stringify({ zone: 'mid', x: 0, y: 1 }),
    },
    {
      key: 'crew_quarters',
      name: 'Crew Quarters',
      description:
        'A short row of stacked sleeping berths with thin privacy curtains and personal lockers, kept dim and quiet on a rotating watch schedule.',
      deck: 'A',
      layoutHint: JSON.stringify({ zone: 'aft', x: 1, y: 1 }),
    },
    {
      key: 'sim_deck',
      name: 'Sim Deck',
      description:
        'A reconfigurable immersion bay with a reclining rig and a ring of projectors — used for mission rehearsal and full-sensory simulation runs.',
      deck: 'A',
      layoutHint: JSON.stringify({ zone: 'mid', x: -1, y: 1 }),
    },
    {
      key: 'med_bay',
      name: 'Med Bay',
      description:
        'A two-berth infirmary with a diagnostic arch, drug lockers, and a fold-out surgical surface — also the ship’s de facto counseling nook.',
      deck: 'A',
      layoutHint: JSON.stringify({ zone: 'aft', x: 1, y: 2 }),
    },
    {
      key: 'engine_room',
      name: 'Engine Room',
      description:
        'The lower-deck drive space: a hot, loud bay of reactor housing, coolant runs, and the maintenance crawl spaces only the engineer keeps straight.',
      deck: 'B',
      layoutHint: JSON.stringify({ zone: 'lower', x: -1, y: 2 }),
    },
  ],
  edges: [
    { from: 'bridge', to: 'mess', kind: 'corridor', bidirectional: true },
    { from: 'mess', to: 'crew_quarters', kind: 'corridor', bidirectional: true },
    { from: 'mess', to: 'sim_deck', kind: 'corridor', bidirectional: true },
    { from: 'crew_quarters', to: 'med_bay', kind: 'corridor', bidirectional: true },
    { from: 'sim_deck', to: 'engine_room', kind: 'ladder', bidirectional: true },
  ],
  crew: [
    {
      role: 'captain',
      homeRoomKey: 'bridge',
      description:
        'Commands the vessel; sets the mission tempo and carries the weight of every call. Warm with the new arrival, anchored to the bridge.',
    },
    {
      role: 'pilot',
      homeRoomKey: 'sim_deck',
      description:
        'Flies the ship and runs approach rehearsals; restless off-watch, drawn to the sim deck, quick to befriend a newcomer.',
    },
    {
      role: 'engineer',
      homeRoomKey: 'engine_room',
      description:
        'Keeps the drive and life support alive; happiest elbow-deep in the engine room, gruff but loyal.',
    },
    {
      role: 'medic',
      homeRoomKey: 'med_bay',
      description:
        'Tends the crew’s bodies and, quietly, their nerves; the ship’s confidant, based in the med bay.',
    },
  ],
}

import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

// Corporate research facility (Phase B, B2) — the Animus/Abstergo analogue. A
// clean, friendly research compound whose immersion lab is the simulation room
// the player surfaces into on awakening. Five rooms, one connected graph.

export const RESEARCH_FACILITY: WorldArchetype = {
  id: 'research-facility',
  name: 'Corporate Research Facility',
  isHub: true,
  simulationRoomKey: 'immersion_lab',
  entryLocationKey: 'atrium',
  initialSceneTitle: 'Arrival',
  defaultCharacterLabel: 'New Hire',
  playerIntroTemplate: 'a newly-onboarded researcher, badge still warm from the printer',
  rooms: [
    {
      key: 'atrium',
      name: 'Atrium',
      description:
        'A bright glass-walled reception with a living wall and a security turnstile; the company logo etched everywhere, the coffee genuinely good.',
      deck: '1',
      layoutHint: JSON.stringify({ zone: 'front', x: 0, y: 0 }),
    },
    {
      key: 'immersion_lab',
      name: 'Immersion Lab',
      description:
        'A hushed, cooled chamber dominated by a reclining immersion cradle ringed with sensor arrays — the heart of the program, where subjects go under.',
      deck: '1',
      layoutHint: JSON.stringify({ zone: 'core', x: 0, y: 1 }),
    },
    {
      key: 'commons',
      name: 'Staff Commons',
      description:
        'An open break area of soft couches, a kitchenette, and a wall of candid team photos — deliberately warm, the place the staff actually like each other.',
      deck: '1',
      layoutHint: JSON.stringify({ zone: 'side', x: 1, y: 1 }),
    },
    {
      key: 'archive',
      name: 'Data Archive',
      description:
        'Rows of cold storage and a single reading terminal; the recovered records the program mines, kept behind a badge reader most staff never use.',
      deck: 'B',
      layoutHint: JSON.stringify({ zone: 'lower', x: -1, y: 1 }),
    },
    {
      key: 'server_vault',
      name: 'Server Vault',
      description:
        'A freezing, roaring room of blinking racks behind a blast door — the compute that runs the simulations, tended by one wary engineer.',
      deck: 'B',
      layoutHint: JSON.stringify({ zone: 'lower', x: -1, y: 2 }),
    },
  ],
  edges: [
    { from: 'atrium', to: 'immersion_lab', kind: 'corridor', bidirectional: true },
    { from: 'atrium', to: 'commons', kind: 'corridor', bidirectional: true },
    { from: 'immersion_lab', to: 'archive', kind: 'stairwell', bidirectional: true },
    { from: 'archive', to: 'server_vault', kind: 'door', bidirectional: true },
  ],
  crew: [
    {
      role: 'director',
      homeRoomKey: 'atrium',
      description:
        'Runs the program with an easy, welcoming manner; greets every new hire personally. Anchored to the atrium.',
    },
    {
      role: 'lead_researcher',
      homeRoomKey: 'immersion_lab',
      description:
        'Operates the immersion cradle and reads the subjects’ traces; brilliant, kind, and a little too invested. Based in the lab.',
    },
    {
      role: 'archivist',
      homeRoomKey: 'archive',
      description:
        'Catalogues the recovered records; quietly curious about what they really are. Found among the cold storage.',
    },
    {
      role: 'systems_engineer',
      homeRoomKey: 'server_vault',
      description:
        'Keeps the compute alive; the one person uneasy about how much power the runs draw. Holed up in the vault.',
    },
  ],
}

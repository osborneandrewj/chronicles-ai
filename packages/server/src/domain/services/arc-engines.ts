// Pure domain service (Phase C, C8) — a small library of techno-thriller arc
// STRUCTURES (not IP) the Meta-Story Bible is built on, plus a deterministic
// picker. These are genre-neutral spines: they instantiate equally well whether
// the hub is a starship, an Abstergo-style lab, or a monastery, and whichever
// historical genres the player picks. No I/O, no Math.random — the seed is
// injected.

export type ArcEngine = {
  id: string
  name: string
  // The spine, handed to the bible generator as the conspiracy's shape.
  premise: string
  // Default bleed motifs the generator can lean on (a recurring wrongness).
  motifs: string[]
}

export const ARC_ENGINES: ArcEngine[] = [
  {
    id: 'erased-operative',
    name: 'The Erased Operative',
    premise:
      'The player is a made asset with wiped memory; the simulations are both conditioning and retrieval, and the program will sacrifice anyone to stay buried.',
    motifs: ['a face the player half-remembers', 'a phrase that triggers a blackout', 'a wound that predates every life'],
  },
  {
    id: 'memory-hunt',
    name: 'The Memory Hunt',
    premise:
      'The simulations mine recorded or ancestral memory for a hidden key — a location, a name, a code — and rival factions race for it through the player.',
    motifs: ['an object that appears in every era', 'a locked door behind the eyes', 'a name no one will say aloud'],
  },
  {
    id: 'the-drift',
    name: 'The Drift',
    premise:
      'The simulated people are beginning to wake; the controllers are losing the line between real and constructed — and so is the player.',
    motifs: ['an NPC who looks straight at the player', 'a glitch that repeats', 'a sky that flickers'],
  },
  {
    id: 'black-program',
    name: 'The Black Program',
    premise:
      'A strategic threat is encoded in history; the facility is a deniable program decoding it before a rival power, and betrayal runs to the top.',
    motifs: ['a coded message in period dress', 'a watcher who is never named', 'a countdown disguised as a calendar'],
  },
  {
    id: 'the-breach',
    name: 'The Breach',
    premise:
      'The technology has a catastrophic flaw; every simulation accelerates a countdown to collapse that the friendly crew is hiding.',
    motifs: ['a hairline crack that spreads', 'instruments that disagree', 'a hum that grows louder each cycle'],
  },
]

export function pickArcEngine(seed: number): ArcEngine {
  const index = Math.abs(Math.trunc(seed)) % ARC_ENGINES.length
  return ARC_ENGINES[index]
}

export function getArcEngine(id: string): ArcEngine | undefined {
  return ARC_ENGINES.find((a) => a.id === id)
}

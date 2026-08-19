// Curated, player-facing "What's New" highlights — hand-authored plain language,
// NOT generated from commit messages. One entry per released version, newest
// first. This is static presentational data (a driving-adapter concern only):
// no domain entity, no use case, no DB, no port.
//
// Release discipline: every version bump adds an entry here (see
// docs/RELEASING.md) so the header→notes link never goes stale. Versions follow
// the post-reset 0.x scheme restarted on 2026-06-05 (minor = feature, patch =
// fix); see docs/RELEASING.md.

export interface Release {
  version: string
  date: string // ISO yyyy-mm-dd
  highlights: string[]
}

export const RELEASES: Release[] = [
  {
    version: '0.14.1',
    date: '2026-08-18',
    highlights: [
      'The camera stays with you. If someone walks out and you did not follow, the next beat is still this room — they do not drag you to the next place.',
      'When you do go with someone, your place in the world catches up so the book and the map agree.',
      'Saying “continue” finishes what is already happening. It does not invent a new file, alarm, or destination to keep the plot moving.',
      'Naming a person in the room is not treated as taking up their story thread. Nearby people answer what you just did instead of restaging last turn’s pressure.',
    ],
  },
  {
    version: '0.14.0',
    date: '2026-08-18',
    highlights: [
      'Turns start speaking sooner. The world still plans what nearby people will do, but that work no longer holds the story still before the first sentence.',
      'Indoor and shipboard scenes no longer pause to look up real-world maps.',
    ],
  },
  {
    version: '0.13.0',
    date: '2026-08-18',
    highlights: [
      'Starting a world is three named types now — Animus, a generated world, or a custom world — instead of “begin an adventure” next to “generate a world.”',
      'An Animus is a named sci-fi home facility. You pick a first life, play starts there, and you can return to the facility. The homepage lists the Animus, not a hidden second world.',
      'The play screen matches the world: a quiet sci-fi HUD on the Animus, parchment on historical and fantasy lives.',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-08-18',
    highlights: [
      'New worlds open with a handful of real story threads — a mystery, a pressure, a relationship — instead of waiting for a medical symptom to become the plot.',
      'When you address someone by name, they answer. Colleagues no longer talk over them, and “wait for them to respond” is no longer treated as sitting out the turn.',
      'Talk scenes run as conversations: each speaker gets more than a one-liner, and the same bodily event is not restaged every beat.',
      'The Story inspector no longer lists a pile of closed-thread and completed-objective machinery. Active pressure stays; the archive stays in the log.',
    ],
  },
  {
    version: '0.11.0',
    date: '2026-08-18',
    highlights: [
      'Story arcs hold a clearer foreground: the world stages one beat at a time, with who initiates and what must happen this turn.',
      'Travel and contested actions stay honest — you cannot teleport, and a claimed outcome is judged before the prose continues.',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-08-11',
    highlights: [
      'Exiting a simulation writes a compact mission log on the hub — not raw turn dumps — so staff can pull Sequence Vigil from a console when cleared.',
      'Hub characters carry clearance levels; ambient turns only show a short index, while the simulation room can surface the compacted debrief.',
      'The program antagonist is a real hub NPC who builds a small model of how you play and can seed pressure (vessel / tags) into later simulations.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-08-11',
    highlights: [
      'The storyteller keeps the last twenty turns of conversation as full prose, so short-term continuity holds better across a scene.',
      'Quiet “look around / wait” beats no longer let the world-state extract fall more than two turns behind — ambient play still stays cheap, but soft facts catch up.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-08-12',
    highlights: [
      'Important characters develop a sticky way of speaking — clipped, warm, clinical, and so on — so dialogue feels less interchangeable.',
      'Talk-heavy scenes favor shorter spoken lines, one clear pressure at a time, and less re-describing the same room between every exchange (easier to listen to as well as read).',
      'When someone is about to speak, the story can stage how they deliver the line (interrupt, withhold, one hard question) without putting stage directions on the page.',
    ],
  },
  {
    version: '0.7.2',
    date: '2026-08-11',
    highlights: [
      'Finished plot threads and objectives stay finished — side notes and follow-up details no longer accidentally reopen a closed arc.',
      'The story remembers recently completed work in compact form, so characters and the world stop chasing goals that are already settled.',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-08-11',
    highlights: [
      'If the storyteller briefly refuses out of character, later turns no longer stay stuck in that loop — de-escalating or walking away can continue as fiction again.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-08-11',
    highlights: [
      'Whispers, asides, texts, DMs, and private calls stay with the intended audience — other people in the room (or off-scene) no longer act as if they heard the secret, unless the story later transmits it.',
      'The world tracks who was meant to hear private speech as a system fact, so co-present characters may notice a huddle without knowing the words.',
    ],
  },
  {
    version: '0.6.1',
    date: '2026-08-11',
    highlights: [
      'When a scene circles on the same pressure (“speak,” “wait,” “the chamber waits”) without a clear next step, present characters push a concrete demand you can act on — follow, hand something over, leave a named path, or face a real consequence — instead of restacking atmosphere.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-08-11',
    highlights: [
      'When you wait, continue, or skip ahead in time, the world is more likely to move on its own — characters press you, clocks bite, and scenes advance instead of restating the same stillness.',
      'Busy background activity (typing, watching a screen) no longer pretends to be the whole turn’s drama; real plot pressure can still break through.',
      'If you order someone brought, found, or waited on, the story tracks that open demand and works toward a concrete result — arrival, a report, a refusal, or a real obstacle.',
      'Narration has more room to write like a novel: freer length and texture, with fewer always-on “how to write this beat” checklists, while place, gear, and your agency stay fixed by the world ledger.',
    ],
  },
  {
    version: '0.5.1',
    date: '2026-08-10',
    highlights: [
      'Shared password login for the two-tester deploy — enter once, stay signed in for 30 days, with a Log out control on the home screen.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-08-09',
    highlights: [
      'Gear you buy or pick up sticks with you — even when the story uses a period name for the same thing (a xiphos still counts as your sword).',
      'Your character keeps one clear name across adventures and corrections, so the story does not split you into two people.',
      'Time moves forward in open-world stories, so deadlines and “three days until…” actually matter.',
      'When you drift, the main story pressure can resurface through the world — without a menu of quest options.',
      'Your active goals stay visible even as new ones pile up — a finished errand no longer crowds out what you actually care about.',
      'In grounded historical settings, superhuman feats and public violence draw real consequences: witnesses, fear, and the city’s response.',
      'Named strangers stay themselves more reliably when they finally tell you who they are.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-08-08',
    highlights: [
      'Narration voice starts sooner — often while the story is still writing, with less silence after the prose finishes.',
      'Adventures outside sci-fi stay grounded in their own world: historical and period settings no longer wrap you in a starship simulation by default.',
      'More period places and roles (castles, villages, courts, caravanserais, and the like) so non-modern stories feel at home.',
      'Turns feel snappier: less waiting before the first words appear, and the living-world memory of present characters works more reliably in production.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-06-13',
    highlights: [
      'The version number in the header is now clickable — tap it to see what changed in each release.',
      'A small dot marks the version when there is something new since your last visit.',
    ],
  },
  {
    version: '0.2.5',
    date: '2026-06-11',
    highlights: [
      'Fixed a rare hiccup that could interrupt a turn when a character’s plans were only partly filled in.',
    ],
  },
  {
    version: '0.2.4',
    date: '2026-06-11',
    highlights: [
      'The world now tracks who is holding what. Pick things up, drop them, or hand them to someone, and the story keeps it straight.',
    ],
  },
  {
    version: '0.2.3',
    date: '2026-06-10',
    highlights: [
      'New reading controls and a cleaner reader theme for a more comfortable read.',
    ],
  },
  {
    version: '0.2.2',
    date: '2026-06-10',
    highlights: [
      'Characters speak up and approach you on their own more often, instead of waiting to be addressed.',
      'Characters hold onto their goals and backstories more reliably across a session.',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-06-10',
    highlights: [
      'Redesigned the home screen.',
      'Finished playthroughs are saved to a browsable archive you can revisit.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-06-05',
    highlights: ['First tracked preview of Chronicles.'],
  },
]

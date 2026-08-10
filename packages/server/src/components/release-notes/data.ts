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

// Curated genre/subgenre labels offered in the Quick start world creator.
// Each label is fed verbatim to the world generator as the creative seed.
// This array is the single source of truth for the picker UI and the
// server-side allowlist.
export const GENRES = [
  'High Fantasy',
  'Dark Fantasy',
  'Urban Fantasy',
  'Sword & Sorcery',
  'Grimdark',
  'Portal/Isekai',
  'Gaslamp Fantasy',
  'Weird West',
  'Science Fiction',
  'Space Opera',
  'Cyberpunk',
  'Steampunk',
  'Post-Apocalyptic',
  'Military Sci-Fi',
  'Solarpunk/Hopepunk',
  'Biopunk/Nanopunk',
  'Time Travel/Alternate History',
  'First Contact/Alien Invasion',
  'Mecha/Giant Robot',
  'Dystopian Rebellion',
  'Mystery/Detective',
  'Noir',
  'Thriller/Espionage',
  'Paranormal/Occult Detective',
  'Heist',
  'Horror',
  'Cosmic Horror',
  'Historical',
  'Historical Adventure',
  'Western',
  'Pulp/Treasure-Hunting Adventure',
  'Survival/Wilderness',
  'Pirate/Swashbuckling',
  'Superhero/Powered Individuals',
  'Romance',
  'Mythological Retellings',
  'Cozy Adventure',
] as const

export type Genre = (typeof GENRES)[number]

export function isGenre(value: string): value is Genre {
  return (GENRES as readonly string[]).includes(value)
}

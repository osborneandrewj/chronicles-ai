import type { UiSkin, WorldLayer } from '@/domain/entities'

// Pure skin resolver. The play chrome has two identities: `signal` (modern /
// sci-fi HUD) and `relic` (historical / fantasy parchment).
//
// Layer wins over a stored column: an Animus hub is always signal, even if an
// older row was saved as relic. First lives and standalone worlds follow genre
// (historical/fantasy → relic, sci-fi/modern → signal). A stored pick is only
// used for standalone custom worlds. Untagged → relic.

const SIGNAL_TOKENS = new Set([
  'sci-fi',
  'science fiction',
  'science-fiction',
  'space',
  'space opera',
  'cyberpunk',
  'biopunk',
  'nanopunk',
  'solarpunk',
  'hopepunk',
  'military sci-fi',
  'first contact',
  'alien invasion',
  'mecha',
  'giant robot',
  'dystopian',
  'dystopian rebellion',
  'post-apocalyptic',
  'thriller',
  'espionage',
  'noir',
  'modern',
  'future',
  'generic',
  'superhero',
  'powered individuals',
])

const RELIC_TOKENS = new Set([
  'fantasy',
  'high fantasy',
  'dark fantasy',
  'urban fantasy',
  'sword & sorcery',
  'sword and sorcery',
  'grimdark',
  'portal',
  'isekai',
  'gaslamp fantasy',
  'weird west',
  'steampunk',
  'historical',
  'historical adventure',
  'western',
  'pirate',
  'swashbuckling',
  'mythological',
  'ancient',
  'roman',
  'latin',
  'greek',
  'egyptian',
  'persian',
  'norse',
  'viking',
  'scandinavian',
  'medieval',
  'medieval-english',
  'feudal-japan',
  'japanese',
  'mongol',
  'renaissance',
  'italian',
  'ottoman',
  'turkish',
  'arabic',
  'chinese',
  'nahua',
  'caribbean',
  'cozy adventure',
  'pulp',
  'treasure-hunting',
  'survival',
  'wilderness',
  'horror',
  'cosmic horror',
  'paranormal',
  'occult',
  'romance',
  'mystery',
  'detective',
  'heist',
])

export type ResolveUiSkinInput = {
  genreTags?: string[] | null
  explicit?: UiSkin | null
  aesthetic?: UiSkin | null
}

function tokenize(tag: string): string[] {
  const lower = tag.trim().toLowerCase()
  if (!lower) return []
  const parts = lower.split(/[/&,]+/).map((p) => p.trim()).filter(Boolean)
  return [lower, ...parts]
}

export function resolveUiSkin(input: ResolveUiSkinInput): UiSkin {
  if (input.explicit === 'signal' || input.explicit === 'relic') return input.explicit
  if (input.aesthetic === 'signal' || input.aesthetic === 'relic') return input.aesthetic

  const tags = input.genreTags ?? []
  let sawRelic = false
  for (const tag of tags) {
    for (const token of tokenize(tag)) {
      if (SIGNAL_TOKENS.has(token)) return 'signal'
      if (RELIC_TOKENS.has(token)) sawRelic = true
    }
  }
  return sawRelic ? 'relic' : 'relic'
}

export function isUiSkin(value: string | null | undefined): value is UiSkin {
  return value === 'signal' || value === 'relic'
}

export function effectiveUiSkin(
  stored: string | null | undefined,
  genreTags: string[] | null | undefined,
  worldLayer?: WorldLayer | null,
): UiSkin {
  if (worldLayer === 'hub') return 'signal'
  if (worldLayer === 'subworld') return resolveUiSkin({ genreTags })
  if (isUiSkin(stored)) return stored
  return resolveUiSkin({ genreTags })
}

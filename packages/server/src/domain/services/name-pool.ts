// Pure domain service: deterministic name sampling across cultural/era buckets.
// Phase A (A10) — eliminates the narrow default name band (e.g. "Voss" every story)
// by giving the crew-generator adapter a seeded candidate list to inject into prompts.
//
// Design decisions:
//  - Data is a flat array of NameBucket records; each bucket has `tags` (any string —
//    era / culture / genre labels), `given` names, and `surnames`.
//  - `sample()` takes tag hints, picks ALL matching buckets (union), falls back to the
//    'generic' bucket when nothing matches, deduplicates, shuffles with mulberry32
//    (a fast, tiny, deterministic 32-bit PRNG), and returns `n` pairs.
//  - No I/O, no Math.random, no wall-clock — safe in domain/.

// ── Tiny seeded PRNG (mulberry32) ────────────────────────────────────────────
// Returns a generator that yields numbers in [0, 1) given a 32-bit integer seed.
function* mulberry32(seed: number): Generator<number> {
  let state = seed | 0
  while (true) {
    state = (state + 0x6d2b79f5) | 0
    let z = state
    z = Math.imul(z ^ (z >>> 15), z | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    yield ((z ^ (z >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

// Fisher-Yates in-place shuffle using the supplied PRNG.
function shuffle<T>(arr: T[], rng: Generator<number>): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next().value * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ── Name buckets ─────────────────────────────────────────────────────────────

export type NameBucket = {
  tags: string[]
  given: string[]
  surnames: string[]
}

// NOTE: Phase B can extend this by importing and spreading additional buckets;
// the `sample()` function only cares about `NameBucket[]`.
export const NAME_POOL: NameBucket[] = [
  {
    tags: ['generic', 'modern', 'english'],
    given: [
      'Alex', 'Blake', 'Cameron', 'Casey', 'Dana', 'Drew', 'Ellis',
      'Fern', 'Harley', 'Ivy', 'Jamie', 'Jordan', 'Kay', 'Lee',
      'Morgan', 'Parker', 'Quinn', 'Reed', 'Sage', 'Skye', 'Taylor',
      'Wren',
    ],
    surnames: [
      'Adler', 'Ames', 'Brandt', 'Calder', 'Crane', 'Daley', 'Elmore',
      'Finch', 'Garner', 'Hale', 'Ingram', 'Jarvis', 'Keane', 'Lacy',
      'Marsh', 'Noel', 'Orton', 'Pryce', 'Rand', 'Shaw', 'Thorn',
      'Ulrich', 'Wade', 'York',
    ],
  },
  {
    tags: ['roman', 'latin', 'ancient'],
    given: [
      'Aurelia', 'Brutus', 'Cassia', 'Claudius', 'Drusilla', 'Faustus',
      'Gaius', 'Hostilia', 'Iulia', 'Junius', 'Livia', 'Lucius',
      'Marcus', 'Norbanus', 'Octavia', 'Paullus', 'Quintus', 'Rufus',
      'Servilia', 'Titus', 'Valeria', 'Veronica',
    ],
    surnames: [
      'Acilius', 'Caecilius', 'Cornelia', 'Domitia', 'Fabricius',
      'Gratius', 'Hortensius', 'Iunius', 'Labienus', 'Manlius',
      'Naevius', 'Opimius', 'Petronius', 'Quinctius', 'Rusticus',
      'Scaevola', 'Tullus', 'Umbricius', 'Vatinius', 'Vipsanius',
    ],
  },
  {
    tags: ['french', 'medieval-french', 'renaissance'],
    given: [
      'Adèle', 'Arnaud', 'Béatrice', 'Blanche', 'Cécile', 'Colombe',
      'Étienne', 'Gaston', 'Geneviève', 'Hugues', 'Isabeau', 'Jacques',
      'Jeanne', 'Lancelot', 'Léon', 'Margot', 'Mathieu', 'Noël',
      'Odette', 'Renée', 'Sylvain', 'Thibault', 'Yolande',
    ],
    surnames: [
      'Beaulieu', 'Bertrand', 'Bonnet', 'Bouchard', 'Chevalier',
      'Delacroix', 'Dumont', 'Dupont', 'Fontaine', 'Garnier',
      'Girard', 'Lacombe', 'Laurent', 'Lefevre', 'Lemaire',
      'Mercier', 'Morel', 'Renard', 'Richard', 'Rousseau',
    ],
  },
  {
    tags: ['norse', 'viking', 'scandinavian', 'nordic'],
    given: [
      'Asgerd', 'Birger', 'Brynja', 'Dagny', 'Einar', 'Fjord',
      'Freydís', 'Gunnar', 'Hallgrím', 'Ingrid', 'Ivar', 'Katla',
      'Leif', 'Magnea', 'Njord', 'Ragnhild', 'Sigrid', 'Sigrún',
      'Sven', 'Thorvald', 'Ulfhéðinn', 'Valdís', 'Yngvar',
    ],
    surnames: [
      'Bjornsen', 'Eriksen', 'Gjertsen', 'Halvorsen', 'Iversen',
      'Johannsen', 'Karlsen', 'Larsen', 'Magnusen', 'Nilsen',
      'Olsen', 'Pedersen', 'Rasmussen', 'Sigurdsen', 'Thorsen',
      'Ulriksen', 'Vikander', 'Wollaston',
    ],
  },
  {
    tags: ['japanese', 'edo', 'meiji', 'feudal-japan'],
    given: [
      'Akemi', 'Daisuke', 'Fumiko', 'Haruki', 'Izumi', 'Jun',
      'Kazue', 'Kenji', 'Makoto', 'Megumi', 'Naoki', 'Natsuki',
      'Reiko', 'Rin', 'Ryota', 'Satoshi', 'Shizuka', 'Takashi',
      'Tomoko', 'Yui', 'Yuki',
    ],
    surnames: [
      'Fujiwara', 'Hasegawa', 'Hayashi', 'Honda', 'Inoue', 'Ito',
      'Kato', 'Kobayashi', 'Matsumoto', 'Miki', 'Mori', 'Nakamura',
      'Nishida', 'Ono', 'Saito', 'Sato', 'Shimizu', 'Suzuki',
      'Tanaka', 'Watanabe', 'Yamamoto', 'Yoshida',
    ],
  },
  {
    tags: ['medieval-english', 'medieval', 'fantasy'],
    given: [
      'Aldric', 'Beatrix', 'Cedric', 'Edmund', 'Eleanor', 'Elspeth',
      'Erwin', 'Gilbert', 'Gwendolyn', 'Hadwyn', 'Isolde', 'Leofric',
      'Mabel', 'Oswin', 'Rohesia', 'Rowena', 'Sibyl', 'Thurstan',
      'Wulfric', 'Yvaine',
    ],
    surnames: [
      'Ashfield', 'Blackwell', 'Crompton', 'Devereux', 'Eldridge',
      'Fairfax', 'Greystone', 'Hartley', 'Ironside', 'Kendrick',
      'Longbow', 'Marsh', 'Norwood', 'Oakley', 'Pemberton',
      'Radley', 'Sutton', 'Trent', 'Whitmore', 'Wolsley',
    ],
  },
  {
    tags: ['sci-fi', 'space', 'future', 'starship'],
    given: [
      'Aeon', 'Calix', 'Cypris', 'Dex', 'Elix', 'Faye', 'Galen',
      'Hal', 'Indra', 'Jax', 'Kade', 'Lyra', 'Mira', 'Nyx',
      'Orin', 'Phelan', 'Rex', 'Sable', 'Tav', 'Uri', 'Vera',
      'Wex', 'Zara',
    ],
    surnames: [
      'Arken', 'Bray', 'Corvin', 'Dray', 'Elsin', 'Farro',
      'Grann', 'Holt', 'Idris', 'Joran', 'Kael', 'Lorn',
      'Meryn', 'Nolin', 'Okonkwo', 'Payne', 'Renn', 'Solvar',
      'Thane', 'Ulron', 'Varce', 'Westlin', 'Xen', 'Yarrow',
    ],
  },
]

// ── Public API ────────────────────────────────────────────────────────────────

export type SampledName = {
  given: string
  surname: string
}

export type SampleOptions = {
  /** Surnames to exclude from results (case-insensitive). */
  exclude?: string[]
  /** 32-bit integer seed for reproducible shuffles. */
  seed: number
}

/**
 * Returns up to `n` deterministically sampled name pairs from buckets whose
 * tags intersect `tags`. Falls back to the generic/modern bucket when no tag
 * matches. Pairs whose surname appears in `exclude` (case-insensitive) are
 * removed before the output is truncated to `n`.
 *
 * Same seed + same inputs → identical output. Pure, no I/O.
 */
export function sample(
  tags: string[],
  n: number,
  opts: SampleOptions,
): SampledName[] {
  const tagSet = new Set(tags.map((t) => t.toLowerCase()))

  // Collect matching buckets; fall back to 'generic' when none match.
  const matched = NAME_POOL.filter((b) =>
    b.tags.some((t) => tagSet.has(t.toLowerCase())),
  )
  const buckets = matched.length > 0 ? matched : NAME_POOL.filter((b) => b.tags.includes('generic'))

  // Build unique candidate pools across all matching buckets.
  const givenSet = new Set<string>()
  const surnameSet = new Set<string>()
  for (const b of buckets) {
    for (const g of b.given) givenSet.add(g)
    for (const s of b.surnames) surnameSet.add(s)
  }

  const excludeLower = new Set((opts.exclude ?? []).map((s) => s.toLowerCase()))
  const givens = shuffle([...givenSet], mulberry32(opts.seed))
  const surnames = shuffle(
    [...surnameSet].filter((s) => !excludeLower.has(s.toLowerCase())),
    mulberry32(opts.seed + 1),
  )

  // Zip into pairs up to the smaller pool size, capped by n.
  const count = Math.min(n, givens.length, surnames.length)
  const result: SampledName[] = []
  for (let i = 0; i < count; i++) {
    result.push({ given: givens[i], surname: surnames[i] })
  }
  return result
}

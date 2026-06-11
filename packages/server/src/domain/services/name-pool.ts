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
  // ── Phase B era buckets ───────────────────────────────────────────────────
  {
    tags: ['egyptian', 'ancient-egypt', 'pharaonic'],
    given: [
      'Ahmose', 'Amenhotep', 'Amunet', 'Ankhesenamun', 'Baketaten',
      'Hatshepsut', 'Horemheb', 'Hunefer', 'Iput', 'Isetnofret',
      'Khentkaus', 'Meritaten', 'Nefertari', 'Nefertiti', 'Ramesses',
      'Sethnakht', 'Sitamun', 'Thutmose', 'Tiye', 'Wadjet',
    ],
    surnames: [
      'of Abydos', 'of Akhetaten', 'of Avaris', 'of Edfu', 'of Heliopolis',
      'of Karnak', 'of Memphis', 'of Saqqara', 'of Thebes', 'of Waset',
      'sa-Amun', 'sa-Ptah', 'sa-Ra', 'sa-Sobek', 'sa-Thoth',
      'weret-Isis', 'weret-Mut', 'weret-Neith', 'weret-Sekhmet', 'weret-Wadjet',
    ],
  },
  {
    tags: ['greek', 'hellenic', 'ancient-greece'],
    given: [
      'Achilles', 'Alexios', 'Alkibiades', 'Ariadne', 'Aspasia',
      'Chryseis', 'Demetrios', 'Eirene', 'Eukleia', 'Hekabe',
      'Kallirrhoe', 'Kleisthenes', 'Lysander', 'Menandros', 'Nikias',
      'Perikles', 'Phaedra', 'Sostrate', 'Thucydides', 'Xanthippe',
    ],
    surnames: [
      'Alkmaionidai', 'Bouzyges', 'Eupatridai', 'ho Athenaios', 'ho Korinthios',
      'ho Lakedaimonios', 'ho Makedón', 'ho Milésios', 'ho Syrakosios', 'ho Thebaios',
      'Philaidai', 'tou Aischylou', 'tou Demosthenous', 'tou Kleomenous', 'tou Miltiádou',
      'tou Perikléous', 'tou Solonos', 'tou Themistokleous', 'tou Thukydidou', 'tou Xenophontos',
    ],
  },
  {
    tags: ['mongol', 'mongol-empire', 'steppe'],
    given: [
      'Alaqai', 'Arghun', 'Batu', 'Berke', 'Borte',
      'Chagatai', 'Guyuk', 'Hoelun', 'Hulagu', 'Jebe',
      'Jochi', 'Kublai', 'Muqali', 'Ogedei', 'Sorghaghtani',
      'Subutai', 'Temuge', 'Temujin', 'Toregene', 'Yesugei',
    ],
    surnames: [
      'Barlas', 'Borjigin', 'Jadaran', 'Jalayir', 'Kereyid',
      'Kiyad', 'Mangqut', 'Merkit', 'Naiman', 'Oirat',
      'Onggut', 'Qonggirat', "Taichi'ud", 'Uriankhai', 'Uyghur',
      'Wanyan', 'Xixia', 'Yesunin', 'Zunghar', 'Jalairs',
    ],
  },
  {
    tags: ['italian', 'renaissance-italy', 'renaissance'],
    given: [
      'Agnolo', 'Bartolomea', 'Benedetto', 'Caterina', 'Cosimo',
      'Fiammetta', 'Filippo', 'Ginevra', 'Giovanni', 'Giulia',
      'Jacopo', 'Leonora', 'Lorenzo', 'Lucrezia', 'Matteo',
      'Nicolò', 'Piero', 'Rinaldo', 'Simonetta', 'Vittoria',
    ],
    surnames: [
      'Alberti', 'Bandini', 'Borgia', 'Bracciolini', 'Castiglione',
      'della Rovere', 'di Medici', 'Farnese', 'Gonzaga', 'Grimaldi',
      'Machiavelli', 'Malaspina', 'Orsini', 'Pazzi', 'Piccolomini',
      'Sforza', 'Strozzi', 'Tornabuoni', 'Uzzano', 'Visconti',
    ],
  },
  {
    tags: ['american', 'american-revolution', 'colonial-american'],
    given: [
      'Abigail', 'Amos', 'Bathsheba', 'Benjamin', 'Caleb',
      'Deborah', 'Elias', 'Ezekiel', 'Hannah', 'Hezekiah',
      'Jedediah', 'Mercy', 'Nathaniel', 'Obadiah', 'Patience',
      'Prudence', 'Reuben', 'Silas', 'Submit', 'Thankful',
    ],
    surnames: [
      'Adams', 'Aldrich', 'Brewster', 'Cabot', 'Carver',
      'Choate', 'Cottle', 'Emerson', 'Fairfax', 'Hancock',
      'Harrison', 'Hooper', 'Jefferson', 'Madison', 'Monroe',
      'Otis', 'Revere', 'Standish', 'Washington', 'Wentworth',
    ],
  },
  {
    tags: ['turkish', 'ottoman', 'ottoman-empire'],
    given: [
      'Abdülhamid', 'Ayşe', 'Bayezid', 'Fatma', 'Hafsa',
      'Hürrem', 'Ibrahim', 'Kösem', 'Mahidevran', 'Mehmed',
      'Mihrimah', 'Murad', 'Mustafa', 'Nurbanu', 'Osman',
      'Rabia', 'Selim', 'Suleiman', 'Turhan', 'Yavuz',
    ],
    surnames: [
      'Akkoyunlu', 'Anadolu', 'Çelebi', 'Dülkadiroğlu', 'Enderunlu',
      'Germiyanoğlu', 'Hamidoğlu', 'Jandaroğlu', 'Karamanoğlu', 'Kızılahmedli',
      'Menteşeoğlu', 'Osmanoğlu', 'Ramazanoğlu', 'Saruhanoğlu', 'Sultanî',
      'Tekeoğlu', 'Ülkeroğlu', 'Zülkadiroğlu', 'Paşazade', 'Bey',
    ],
  },
  {
    tags: ['chinese', 'imperial-china', 'ming-china'],
    given: [
      'Bao', 'Changying', 'Fang', 'Guang', 'Hongwu',
      'Jiajing', 'Lan', 'Longqing', 'Meiling', 'Mingzhu',
      'Qiong', 'Ronglu', 'Shunzhi', 'Wei', 'Wuzetian',
      'Xiao', 'Yan', 'Yongle', 'Zhaodi', 'Zhengde',
    ],
    surnames: [
      'Cai', 'Chen', 'Cui', 'Han', 'Huang',
      'Li', 'Lin', 'Liu', 'Lu', 'Ma',
      'Sun', 'Wang', 'Wu', 'Xia', 'Xu',
      'Yang', 'Zhang', 'Zhao', 'Zheng', 'Zhou',
    ],
  },
  {
    tags: ['spanish', 'conquistador', 'golden-age-spain'],
    given: [
      'Álvaro', 'Beatriz', 'Cristóbal', 'Diego', 'Elvira',
      'Esperanza', 'Fernando', 'Francisco', 'Hernán', 'Inés',
      'Isabel', 'Juana', 'Leonor', 'Luis', 'María',
      'Pedro', 'Rodrigo', 'Sancho', 'Teresa', 'Ximena',
    ],
    surnames: [
      'Almagro', 'Alvarado', 'Balboa', 'Bobadilla', 'Cabeza de Vaca',
      'Cisneros', 'Coronado', 'de Ayala', 'de la Cruz', 'de Luna',
      'de Soto', 'de Valdivia', 'Grijalva', 'Mendoza', 'Narváez',
      'Ojeda', 'Ovando', 'Pizarro', 'Velázquez', 'Zumarraga',
    ],
  },
  {
    tags: ['nahua', 'aztec', 'mesoamerica'],
    given: [
      'Acolmiztli', 'Chimalli', 'Cihuatl', 'Coyolxauhqui', 'Cuauhtli',
      'Cuicatl', 'Ehecatl', 'Huitzil', 'Itzcoatl', 'Malinalli',
      'Mazatl', 'Necahual', 'Ocelotl', 'Tezcatl', 'Tlapalteotl',
      'Tonatiuh', 'Xochitl', 'Yaotl', 'Yohualli', 'Zipactli',
    ],
    surnames: [
      'Acamapichtli', 'Ahuizotl', 'Axayacatl', 'Chimalpopoca', 'Huitzilihuitl',
      'Motecuhzoma', 'Netzahualcoyotl', 'Tecuichpo', 'Tezozomoc', 'Tlacaelel',
      'Tlacopan', 'Tlatelolco', 'Tlotzin', 'Tochtli', 'Tollan',
      'Totoquihuaztli', 'Xayacatl', 'Xicoténcatl', 'Yacatecuhtli', 'Zumárraga',
    ],
  },
  {
    tags: ['caribbean', 'golden-age-piracy', 'buccaneer'],
    given: [
      'Anne', 'Baptiste', 'Bartholomew', 'Calico', 'Celestine',
      'Charles', 'Cochon', 'Delphine', 'Édouard', 'Edward',
      'Ezekiel', 'Françoise', 'Isadora', 'Jacques', 'Jean',
      'Josephine', 'Mary', 'Patience', 'Samuel', 'Thomas',
    ],
    surnames: [
      'Bellamy', 'Bonny', 'Capot', 'Condent', 'Davis',
      'de Graaf', 'England', 'Every', 'Hornigold', 'Jennings',
      'Kidd', 'Lafitte', 'Levasseur', 'Low', 'Rackham',
      'Read', 'Roberts', 'Teach', 'Vane', 'Williams',
    ],
  },
  {
    tags: ['persian', 'achaemenid', 'achaemenid-persia'],
    given: [
      'Amestris', 'Ariaramnes', 'Arsames', 'Artabazus', 'Artaphernes',
      'Artaxerxes', 'Atossa', 'Cambyses', 'Cassandane', 'Cyrus',
      'Darius', 'Gotarzes', 'Hystaspes', 'Mandane', 'Masistes',
      'Parysatis', 'Roxane', 'Smerdis', 'Stateira', 'Xerxes',
    ],
    surnames: [
      'Achaemenid', 'of Anshan', 'of Bactria', 'of Ecbatana', 'of Lydia',
      'of Media', 'of Pasargadae', 'of Persepolis', 'of Susa', 'of the Medes',
      'Parthian', 'Pharnacid', 'son of Arsames', 'son of Cambyses', 'son of Cyrus',
      'son of Darius', 'son of Hystaspes', 'son of Teispes', 'son of Vishtaspa', 'Teispid',
    ],
  },
  {
    tags: ['german', 'cold-war-berlin', 'cold-war'],
    given: [
      'Brigitte', 'Christoph', 'Dieter', 'Erika', 'Ernst',
      'Friedrich', 'Gerda', 'Hans', 'Ilse', 'Ingeborg',
      'Karl', 'Klaus', 'Lotte', 'Manfred', 'Marlene',
      'Rolf', 'Sigrid', 'Ulrich', 'Ursula', 'Werner',
    ],
    surnames: [
      'Bergmann', 'Brandt', 'Fischer', 'Hoffmann', 'Kaiser',
      'Klein', 'Koch', 'Krause', 'Lehmann', 'Meyer',
      'Müller', 'Neumann', 'Peters', 'Richter', 'Schäfer',
      'Schneider', 'Schulz', 'Schwarz', 'Wagner', 'Weber',
    ],
  },
  {
    tags: ['arabic', 'crusades-era', 'levantine'],
    given: [
      'Aisha', 'Ali', 'Dawud', 'Fatima', 'Hamza',
      'Hassan', 'Husayn', 'Ibrahim', 'Khalid', 'Khadija',
      'Maryam', 'Muhammad', 'Nur', 'Omar', 'Saladin',
      'Salih', 'Shajar', 'Umar', 'Usama', 'Zaynab',
    ],
    surnames: [
      'al-Ayyubi', 'al-Din', 'al-Fadl', 'al-Ghazali', 'al-Khwarizmi',
      'al-Mansur', 'al-Mawsili', 'al-Munqidh', 'al-Rashid', 'al-Zafir',
      'ibn Abi Talib', 'ibn Khaldun', 'ibn Rushd', 'ibn Shaddad', 'ibn Sina',
      'ibn Umar', 'ibn Zafir', 'of Damascus', 'of Jerusalem', 'of Mosul',
    ],
  },
  {
    tags: ['european', 'wwi-europe', 'wwii-europe'],
    given: [
      'Aleksander', 'Annelies', 'Casimir', 'Celeste', 'Dirk',
      'Elzbieta', 'Emile', 'Franziska', 'Helena', 'Henryk',
      'Jan', 'Klara', 'Lena', 'Marek', 'Mathilde',
      'Miroslav', 'Olga', 'Pavel', 'Renata', 'Stefaan',
    ],
    surnames: [
      'Bergström', 'Bonnet', 'Brouwer', 'Dabrowski', 'De Smet',
      'Dubois', 'Horváth', 'Jansen', 'Kowalski', 'Leblanc',
      'Mazur', 'Novak', 'Peeters', 'Poulain', 'Smits',
      'Svensson', 'Szabo', 'Vermeersch', 'Wiśniewski', 'Wolff',
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

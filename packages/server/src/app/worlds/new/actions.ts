'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createBoundedWorld } from '@/application/use-cases/create-bounded-world'
import { createWorld, type CreateWorldInput } from '@/application/use-cases/create-world'
import { enterSubworld } from '@/application/use-cases/enter-subworld'
import { getContainer } from '@/composition/container'
import { getGenrePreset } from '@/composition/onboarding'
import { pickArcEngine } from '@/domain/services/arc-engines'
import { generateCodename } from '@/domain/services/codename'
import { usesSimulationFrame } from '@/domain/services/meta-frame'
import { getPark } from '@/domain/services/park-catalog'
import { filterHubsByAesthetic, filterHubsByGenre, pickHubArchetype } from '@/domain/services/pick-hub-archetype'
import { isUiSkin, resolveUiSkin } from '@/domain/services/ui-skin'
import { isGenre } from '@/lib/genres'
import { generateOpeningTurn, type OpeningTurnDeps } from '@/lib/opening-turn'
import { extractSettingRegion } from '@/lib/region-extractor'
import { generateWorldFromGenre } from '@/lib/world-generator'

const CreateWorldSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  premise: z.string().trim().min(20, 'Premise is required (at least a sentence)').max(4000),
  location: z.string().trim().min(1, 'Location is required').max(400),
  time: z.string().trim().min(1).max(200).default('Day 1, morning'),
  playerName: z.string().trim().max(120).optional(),
  identity: z
    .string()
    .trim()
    .max(600)
    .default('Travel-worn newcomer — name not yet established.'),
})

const BasicWorldSchema = z.object({
  playerName: z.string().trim().max(120).optional(),
  genre: z.string().trim().refine(isGenre, 'Pick a genre from the list'),
})

// Concealed onboarding (Phase B, B6): the player picks a historical genre by
// label only; the world they get is named with an ambiguous codename, and the
// rich premise that seeds the narrator is NEVER surfaced. (The hub/session/sim
// drop-in is wired silently in C10; until then the genre adventure is created as
// a standalone playable world.)
const AdventureSchema = z.object({
  playerName: z.string().trim().max(120).optional(),
  genreId: z.string().trim().min(1),
})

// Deterministic, low-cost string hash for seeding the codename generator.
function hashString(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const StarshipWorldSchema = z.object({
  playerName: z.string().trim().max(120).optional(),
})

const AnimusSchema = z.object({
  playerName: z.string().trim().max(120).optional(),
  firstLifeKind: z.enum(['preset', 'genre']),
  firstLifeId: z.string().trim().min(1),
})

const ParkEnterSchema = z.object({
  parkId: z.string().trim().min(1),
  playerName: z.string().trim().max(120).optional(),
})

// Fixed dressing for the scout starship — the player picks neither name nor
// premise here; the bounded mode supplies a single authored vessel.
const STARSHIP_NAME = 'Scout Vessel'
const STARSHIP_PREMISE =
  'A lone scout vessel runs a long survey arc through empty space, its small crew ' +
  'sealed in together for the duration. The mission grinds on; tensions simmer in ' +
  'the close quarters, and the ship is already mid-watch when a newcomer comes aboard.'
const STARSHIP_SIM_TICKS = 12

export type CreateWorldFormState = {
  error?: string
}

// Shared tail for both creation modes: persist the world, extract a geocoding
// region from the premise, synthesize the narrator's opening move, then send
// the player into /play. `redirect` throws by design, so it must be the caller's
// last statement (and is therefore invoked here, not returned).
async function persistWorldSkin(
  worlds: ReturnType<typeof getContainer>['worlds'],
  worldId: number,
  genreTags: string[] | undefined,
  explicit?: 'signal' | 'relic',
): Promise<void> {
  const skin = resolveUiSkin({ genreTags, explicit })
  await worlds.setUiSkin(worldId, skin)
}

async function createAndOpenWorld(
  input: CreateWorldInput,
  genreTags?: string[],
  explicitSkin?: 'signal' | 'relic',
): Promise<never> {
  const c = getContainer()
  const { worldId } = await createWorld(input, {
    worlds: c.worlds,
    extractSettingRegion,
  })
  // Persist the genre signal (genre-coupling audit) so deterministic services
  // can adapt to the setting; null/absent when no genre was declared.
  if (genreTags && genreTags.length > 0) {
    await c.worlds.setGenreTags(worldId, JSON.stringify(genreTags))
  }
  await persistWorldSkin(c.worlds, worldId, genreTags, explicitSkin)
  await generateOpeningTurn(openingTurnDeps(c), worldId, input.premise)
  redirect(`/worlds/${worldId}/play`)
}

// The read ports `generateOpeningTurn` assembles narrator context from (P2).
function openingTurnDeps(c: ReturnType<typeof getContainer>): OpeningTurnDeps {
  return {
    characters: c.characters,
    dossiers: c.dossiers,
    occupancy: c.occupancy,
    places: c.places,
    scenes: c.scenes,
    turns: c.turns,
    worlds: c.worlds,
  }
}

export async function createWorldAction(
  _prev: CreateWorldFormState,
  formData: FormData,
): Promise<CreateWorldFormState> {
  const parsed = CreateWorldSchema.safeParse({
    name: formData.get('name'),
    premise: formData.get('premise'),
    location: formData.get('location'),
    time: formData.get('time') || undefined,
    playerName: formData.get('playerName') || undefined,
    identity: formData.get('identity') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  const { name, premise, location, time, playerName, identity } = parsed.data
  const skinRaw = formData.get('uiSkin')
  const explicitSkin = typeof skinRaw === 'string' && isUiSkin(skinRaw) ? skinRaw : 'relic'
  return createAndOpenWorld(
    {
      name,
      premise,
      initialState: { time, location, identity, playerName },
    },
    undefined,
    explicitSkin,
  )
}

export async function createBasicWorldAction(
  _prev: CreateWorldFormState,
  formData: FormData,
): Promise<CreateWorldFormState> {
  const parsed = BasicWorldSchema.safeParse({
    playerName: formData.get('playerName') || undefined,
    genre: formData.get('genre'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  const { playerName, genre } = parsed.data

  let generated
  try {
    generated = await generateWorldFromGenre(genre, playerName ?? null)
  } catch (err) {
    console.error('[world generator failed]', err)
    return { error: "Couldn't generate a world — try again, or use Advanced." }
  }

  return createAndOpenWorld(
    {
      name: generated.name,
      premise: generated.premise,
      initialState: {
        time: generated.time,
        location: generated.location,
        identity: generated.identity,
        playerName: playerName ?? undefined,
      },
    },
    [genre],
  )
}

// Concealed adventure creation (Phase B, B6). The player chose a genre LABEL;
// we look up its hidden premise, mint an ambiguous codename for the world's
// player-facing name, and create a playable world. Nothing here surfaces the
// premise or any simulation/hub vocabulary — the codename is all the player
// sees. `redirect` throws by design, so it stays outside the try.
export async function createAdventureAction(
  _prev: CreateWorldFormState,
  formData: FormData,
): Promise<CreateWorldFormState> {
  const parsed = AdventureSchema.safeParse({
    playerName: formData.get('playerName') || undefined,
    genreId: formData.get('genreId'),
  })
  if (!parsed.success) {
    return { error: 'Pick an adventure from the list.' }
  }
  const { playerName, genreId } = parsed.data
  const preset = getGenrePreset(genreId)
  if (!preset) {
    return { error: 'Pick an adventure from the list.' }
  }

  // Seed the codename + selections from the genre id plus per-creation entropy.
  const seed = (hashString(genreId) ^ Date.now()) >>> 0
  const codename = generateCodename(seed)

  // Genre-coupling audit, Phase 1 — the simulation meta-frame is OPT-IN. A
  // grounded preset (every shipped historical setting) plays as a plain
  // standalone world seeded from its rich hidden premise: no concealed hub, no
  // Meta-Story Bible, no session, and — because it never becomes a `subworld` —
  // no REALITY cue, lucidity, or bleed. The narrator/archivist prompts are
  // already genre-neutral, so this is the correct, simulation-free experience.
  if (!usesSimulationFrame(preset.metaFrameKind)) {
    return createAndOpenWorld(
      {
        name: codename,
        premise: preset.hiddenPremise,
        initialState: {
          time: 'Day 1, morning',
          location: preset.label,
          identity: 'a newcomer, name not yet established',
          playerName,
        },
      },
      [...preset.eraTags, ...preset.toneTags],
    )
  }

  const c = getContainer()

  // The full concealed-onboarding flow (C10): silently seed a randomly-designated
  // hub (+ its Meta-Story Bible), open a session, then drop the player into the
  // chosen historical simulation. The player sees ONLY the codename and the
  // adventure; the hub stays hidden (concealmentView) until the first awakening.
  let subworldId: number
  try {
    // 1. Pick the hub archetype. The hub premise and arc engine are determined
    //    before world creation so the bible can supply the hub's name.
    const hubs = (await c.decks.all()).filter((a) => a.isHub)
    // Genre-coupling audit (Phase 2): draw a hub appropriate to the chosen
    // genre's era, so a medieval simulation never awakens into a starship.
    const hub = pickHubArchetype(filterHubsByGenre(hubs, preset.eraTags), seed)
    const hubPremise = `A ${hub.name.toLowerCase()} with a small, friendly resident crew; ${
      hub.playerIntroTemplate ?? 'a newcomer has just arrived'
    }.`
    const arcEngine = pickArcEngine(seed)

    // 2. Generate the Meta-Story Bible BEFORE creating the hub world so its
    //    institutionName can become the hub's player-facing name. Best-effort —
    //    never blocks play; falls back to an opaque codename on failure.
    let bible: Awaited<ReturnType<typeof c.metaStoryGenerator.generate>> | undefined
    try {
      bible = await c.metaStoryGenerator.generate({
        hubName: hub.name,
        hubPremise,
        arcEngine,
        genreLabels: [preset.label],
        seed,
      })
    } catch (err) {
      console.error('[meta-story generation]', err)
    }

    // The hub's in-fiction name comes from the bible; fallback is an opaque
    // codename — never the raw archetype label, which would spoil the story.
    const hubName = bible?.institutionName?.trim() || generateCodename(seed)

    // 3. Silently seed the hub world (friendly resident crew). Never surfaced.
    const hubResult = await createBoundedWorld(
      { templateId: hub.id, name: hubName, premise: hubPremise, playerName },
      { ...c, crew: c.ensembleGenerator },
    )
    await c.worlds.setLayer(hubResult.worldId, 'hub', null)

    // 4. Persist the bible if it was successfully generated; link antagonist.
    if (bible) {
      await c.worlds.setMetaStory(hubResult.worldId, JSON.stringify(bible))
    }
    try {
      const { ensureHubAntagonist } = await import(
        '@/application/use-cases/ensure-hub-antagonist'
      )
      await ensureHubAntagonist(hubResult.worldId, {
        worlds: c.worlds,
        characters: c.characters,
        places: c.places,
      })
    } catch (err) {
      console.error('[hub antagonist link]', err)
    }

    // 5. Open the durable session pointer.
    const session = await c.sessions.create({
      hub_world_id: hubResult.worldId,
      player_identity: playerName?.trim() || 'the newcomer',
    })

    // 6. Drop the player into the chosen historical simulation (what they see).
    const sub = await enterSubworld(
      {
        hubWorldId: hubResult.worldId,
        sessionId: session.id,
        name: codename,
        premise: preset.hiddenPremise,
        initialState: {
          time: 'Day 1, morning',
          location: preset.label,
          identity: 'a newcomer, name not yet established',
          playerName,
        },
      },
      { worlds: c.worlds, sessions: c.sessions, simRuns: c.simRuns },
    )
    subworldId = sub.subworldId
    await generateOpeningTurn(openingTurnDeps(c), subworldId, preset.hiddenPremise)
  } catch (err) {
    console.error('[adventure creation failed]', err)
    return { error: "Couldn't begin — try again." }
  }

  redirect(`/worlds/${subworldId}/play`)
}

export async function createAnimusAction(
  _prev: CreateWorldFormState,
  formData: FormData,
): Promise<CreateWorldFormState> {
  const parsed = AnimusSchema.safeParse({
    playerName: formData.get('playerName') || undefined,
    firstLifeKind: formData.get('firstLifeKind'),
    firstLifeId: formData.get('firstLifeId'),
  })
  if (!parsed.success) {
    return { error: 'Choose a first narrative.' }
  }
  const { playerName, firstLifeKind, firstLifeId } = parsed.data

  let firstName: string
  let firstPremise: string
  let firstLocation: string
  let firstTags: string[]
  let firstTime = 'Day 1, morning'
  let firstIdentity = 'a newcomer, name not yet established'

  if (firstLifeKind === 'preset') {
    const preset = getGenrePreset(firstLifeId)
    if (!preset) return { error: 'Pick a first narrative from the list.' }
    const seed = (hashString(firstLifeId) ^ Date.now()) >>> 0
    firstName = generateCodename(seed)
    firstPremise = preset.hiddenPremise
    firstLocation = preset.label
    firstTags = [...preset.eraTags, ...preset.toneTags]
  } else {
    if (!isGenre(firstLifeId)) return { error: 'Pick a first narrative from the list.' }
    try {
      const generated = await generateWorldFromGenre(firstLifeId, playerName ?? null)
      firstName = generated.name
      firstPremise = generated.premise
      firstLocation = generated.location
      firstTime = generated.time
      firstIdentity = generated.identity
      firstTags = [firstLifeId]
    } catch (err) {
      console.error('[animus first-life generator failed]', err)
      return { error: "Couldn't invent that narrative — try another, or a prepared setting." }
    }
  }

  const c = getContainer()
  const seed = (hashString(firstLifeId) ^ Date.now()) >>> 0
  let subworldId: number
  try {
    const hubs = (await c.decks.all()).filter((a) => a.isHub)
    const hub = pickHubArchetype(filterHubsByAesthetic(hubs, 'signal'), seed)
    const hubPremise = `A ${hub.name.toLowerCase()} with a small, friendly resident crew; ${
      hub.playerIntroTemplate ?? 'a newcomer has just arrived'
    }.`
    const arcEngine = pickArcEngine(seed)

    let bible: Awaited<ReturnType<typeof c.metaStoryGenerator.generate>> | undefined
    try {
      bible = await c.metaStoryGenerator.generate({
        hubName: hub.name,
        hubPremise,
        arcEngine,
        genreLabels: [firstLocation],
        seed,
      })
    } catch (err) {
      console.error('[meta-story generation]', err)
    }

    const hubName = bible?.institutionName?.trim() || generateCodename(seed)
    const hubResult = await createBoundedWorld(
      { templateId: hub.id, name: hubName, premise: hubPremise, playerName },
      { ...c, crew: c.ensembleGenerator },
    )
    await c.worlds.setLayer(hubResult.worldId, 'hub', null)
    await persistWorldSkin(c.worlds, hubResult.worldId, ['sci-fi', 'modern'], 'signal')
    if (bible) {
      await c.worlds.setMetaStory(hubResult.worldId, JSON.stringify(bible))
    }
    try {
      const { ensureHubAntagonist } = await import(
        '@/application/use-cases/ensure-hub-antagonist'
      )
      await ensureHubAntagonist(hubResult.worldId, {
        worlds: c.worlds,
        characters: c.characters,
        places: c.places,
      })
    } catch (err) {
      console.error('[hub antagonist link]', err)
    }

    const session = await c.sessions.create({
      hub_world_id: hubResult.worldId,
      player_identity: playerName?.trim() || 'the newcomer',
    })

    const sub = await enterSubworld(
      {
        hubWorldId: hubResult.worldId,
        sessionId: session.id,
        name: firstName,
        premise: firstPremise,
        initialState: {
          time: firstTime,
          location: firstLocation,
          identity: firstIdentity,
          playerName,
        },
      },
      { worlds: c.worlds, sessions: c.sessions, simRuns: c.simRuns },
    )
    subworldId = sub.subworldId
    if (firstTags.length > 0) {
      await c.worlds.setGenreTags(subworldId, JSON.stringify(firstTags))
    }
    await persistWorldSkin(c.worlds, subworldId, firstTags)
    await generateOpeningTurn(openingTurnDeps(c), subworldId, firstPremise)
  } catch (err) {
    console.error('[animus creation failed]', err)
    return { error: "Couldn't forge the facility — try again." }
  }

  redirect(`/worlds/${subworldId}/play`)
}

export async function createParkAction(
  _prev: CreateWorldFormState,
  formData: FormData,
): Promise<CreateWorldFormState> {
  const parsed = ParkEnterSchema.safeParse({
    parkId: formData.get('parkId'),
    playerName: formData.get('playerName') || undefined,
  })
  if (!parsed.success) {
    return { error: 'Pick a park from the catalog.' }
  }
  const park = getPark(parsed.data.parkId)
  if (!park) {
    return { error: 'Pick a park from the catalog.' }
  }
  const { playerName } = parsed.data

  const c = getContainer()
  const seed = (hashString(park.id) ^ Date.now()) >>> 0
  let worldId: number
  try {
    const arcEngine = pickArcEngine(seed)
    let bible: Awaited<ReturnType<typeof c.metaStoryGenerator.generate>> | undefined
    try {
      bible = await c.metaStoryGenerator.generate({
        hubName: park.name,
        hubPremise: park.premise,
        arcEngine,
        genreLabels: park.narrativeLabels,
        seed,
      })
    } catch (err) {
      console.error('[park meta-story generation]', err)
    }

    const hubResult = await createBoundedWorld(
      { templateId: park.templateId, name: park.name, premise: park.premise, playerName },
      { ...c, crew: c.ensembleGenerator },
    )
    worldId = hubResult.worldId
    await c.worlds.setLayer(worldId, 'hub', null)
    await persistWorldSkin(c.worlds, worldId, ['sci-fi', 'modern'], 'signal')
    if (bible) {
      await c.worlds.setMetaStory(worldId, JSON.stringify(bible))
    }
    try {
      const { ensureHubAntagonist } = await import(
        '@/application/use-cases/ensure-hub-antagonist'
      )
      await ensureHubAntagonist(worldId, {
        worlds: c.worlds,
        characters: c.characters,
        places: c.places,
      })
    } catch (err) {
      console.error('[hub antagonist link]', err)
    }

    await c.sessions.create({
      hub_world_id: worldId,
      player_identity: playerName?.trim() || 'the newcomer',
    })
    await generateOpeningTurn(openingTurnDeps(c), worldId, park.premise)
  } catch (err) {
    console.error('[park creation failed]', err)
    return { error: "Couldn't open the park — try again." }
  }

  redirect(`/worlds/${worldId}/play`)
}

// Bounded "living world" mode: seed the authored scout ship (real Grok crew),
// run the player-less forward sim (real Haiku beats), drop the player aboard as a
// newcomer on the Bridge, then send them into /play already mid-motion. The
// create+sim work is kept in the try; `redirect` throws by design and so stays
// outside it (its special error must not be swallowed by the catch).
export async function createStarshipWorldAction(
  _prev: CreateWorldFormState,
  formData: FormData,
): Promise<CreateWorldFormState> {
  const parsed = StarshipWorldSchema.safeParse({
    playerName: formData.get('playerName') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  const { playerName } = parsed.data

  // The container names the crew-generator port `ensembleGenerator`; the seed use
  // case's deps call it `crew`, so map it here at the wiring edge.
  const c = getContainer()

  let worldId: number
  try {
    const result = await createBoundedWorld(
      {
        templateId: c.decks.defaultTemplateId(),
        name: STARSHIP_NAME,
        premise: STARSHIP_PREMISE,
        playerName,
        ticks: STARSHIP_SIM_TICKS,
      },
      { ...c, crew: c.ensembleGenerator },
    )
    worldId = result.worldId
    await persistWorldSkin(c.worlds, worldId, ['sci-fi', 'space'], 'signal')
    await generateOpeningTurn(openingTurnDeps(c), worldId, STARSHIP_PREMISE)
  } catch (err) {
    console.error('[starship launch failed]', err)
    return { error: "Couldn't launch the ship — try again." }
  }

  redirect(`/worlds/${worldId}/play`)
}

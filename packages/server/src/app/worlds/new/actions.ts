'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createStarshipWorld } from '@/application/use-cases/create-starship-world'
import { createWorld, type CreateWorldInput } from '@/application/use-cases/create-world'
import { getContainer } from '@/composition/container'
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

const StarshipWorldSchema = z.object({
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
async function createAndOpenWorld(input: CreateWorldInput): Promise<never> {
  const c = getContainer()
  const { worldId } = await createWorld(input, {
    worlds: c.worlds,
    extractSettingRegion,
  })
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
  return createAndOpenWorld({
    name,
    premise,
    initialState: { time, location, identity, playerName },
  })
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

  return createAndOpenWorld({
    name: generated.name,
    premise: generated.premise,
    initialState: {
      time: generated.time,
      location: generated.location,
      identity: generated.identity,
      playerName: playerName ?? undefined,
    },
  })
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

  // The container names the crew-generator port `crewGenerator`; the seed use
  // case's deps call it `crew`, so map it here at the wiring edge.
  const c = getContainer()

  let worldId: number
  try {
    const result = await createStarshipWorld(
      {
        templateId: c.decks.defaultTemplateId(),
        name: STARSHIP_NAME,
        premise: STARSHIP_PREMISE,
        playerName,
        ticks: STARSHIP_SIM_TICKS,
      },
      { ...c, crew: c.crewGenerator },
    )
    worldId = result.worldId
    await generateOpeningTurn(openingTurnDeps(c), worldId, STARSHIP_PREMISE)
  } catch (err) {
    console.error('[starship launch failed]', err)
    return { error: "Couldn't launch the ship — try again." }
  }

  redirect(`/worlds/${worldId}/play`)
}

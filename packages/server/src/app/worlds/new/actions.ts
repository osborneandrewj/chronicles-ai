'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { isGenre } from '@/lib/genres'
import { generateOpeningTurn } from '@/lib/opening-turn'
import { generateWorldFromGenre } from '@/lib/world-generator'
import { createWorld, setSettingRegionForWorld, type CreateWorldInput } from '@/lib/worlds'

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

export type CreateWorldFormState = {
  error?: string
}

// Shared tail for both creation modes: persist the world, extract a geocoding
// region from the premise, synthesize the narrator's opening move, then send
// the player into /play. `redirect` throws by design, so it must be the caller's
// last statement (and is therefore invoked here, not returned).
async function createAndOpenWorld(input: CreateWorldInput): Promise<never> {
  const world = createWorld(input)
  await setSettingRegionForWorld(world.id, input.premise, input.initialState.location)
  await generateOpeningTurn(world.id, input.premise)
  redirect(`/worlds/${world.id}/play`)
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

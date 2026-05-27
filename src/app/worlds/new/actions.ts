'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { generateOpeningTurn } from '@/lib/opening-turn'
import { createWorld, setSettingRegionForWorld } from '@/lib/worlds'

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

export type CreateWorldFormState = {
  error?: string
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
  const world = createWorld({
    name,
    premise,
    initialState: { time, location, identity, playerName },
  })
  // Extract a Nominatim-friendly region string from the premise (e.g.
  // "Hayden, Idaho, USA") and persist it before the opening turn fires.
  // This biases real-world geocoding for every place created in this world.
  // Failures are swallowed inside the helper — a missing region just means
  // less-biased lookups, not a broken world.
  await setSettingRegionForWorld(world.id, premise, location)
  // Synthesize the narrator's opening move before redirecting so the player
  // lands on a live fictional moment instead of an empty page. Awaited
  // intentionally: the action stays blocked until both the narrator and the
  // archivist have run, so /play hydrates with the opening already in place
  // and the inspector reflects any newly-introduced state. Failures inside
  // generateOpeningTurn are swallowed (logged) — a flaky LLM call shouldn't
  // strand the user without a world.
  await generateOpeningTurn(world.id, premise)
  redirect(`/worlds/${world.id}/play`)
}

'use server'

import { redirect } from 'next/navigation'

import { closeSubworldAndReturn } from '@/application/use-cases/close-subworld-and-return'
import { getContainer } from '@/composition/container'
import { generateOpeningTurn } from '@/lib/opening-turn'

export async function returnToAnimusAction(worldId: number): Promise<void> {
  const container = getContainer()
  const { characters, decks, dossiers, occupancy, places, scenes, sessions, simRuns, worlds, turns } =
    container
  const session = await sessions.byWorld(worldId)
  if (!session || session.status !== 'in_subworld') {
    redirect(`/worlds/${worldId}/play`)
  }

  const result = await closeSubworldAndReturn(
    {
      session,
      subworldId: session.subworld_world_id ?? worldId,
      exitKind: 'awakening',
      sourceTurnId: null,
    },
    {
      worlds,
      places,
      scenes,
      characters,
      sessions,
      decks,
      simRuns,
      turns,
      dossiers,
    },
  )
  const hubWorldId = result?.hubWorldId ?? session.hub_world_id
  const existing = await turns.latestTurns(hubWorldId, 1)
  if (existing.length === 0) {
    const hub = await worlds.getWorld(hubWorldId)
    const premise = [
      hub?.premise ?? '',
      'The protagonist has just returned from another life and surfaces in the home facility, the resident crew close by.',
    ]
      .filter(Boolean)
      .join(' ')
    await generateOpeningTurn(
      { characters, dossiers, occupancy, places, scenes, turns, worlds },
      hubWorldId,
      premise,
    ).catch((err) => console.error('[animus return opening]', err))
  }
  redirect(`/worlds/${hubWorldId}/play`)
}

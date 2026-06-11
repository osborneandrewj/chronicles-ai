import { notFound, redirect } from 'next/navigation'

import { returnToHub } from '@/application/use-cases/return-to-hub'
import { Chat, type ChroniclesMessage } from '@/components/Chat'
import { HubSimulationsMenu, type HubSimulationEntry } from '@/components/HubSimulationsMenu'
import { getContainer } from '@/composition/container'
import { resolveActiveWorldId } from '@/domain/services/resolve-active-world'
import { generateOpeningTurn } from '@/lib/opening-turn'
import { summarizeTurn, type TurnCost } from '@/lib/turn-cost'

export const dynamic = 'force-dynamic'

type Params = { worldId: string }

// Initial render hydrates the last N turns + matching assistant metadata. The
// client renders "Load older" if the world has more turns before this slice.
// 60 is a starting guess — ~3 sessions of play in current Mevagissey data;
// revisit once production play settles into a rhythm.
const INITIAL_TURN_LIMIT = 60

export default async function PlayPage({ params }: { params: Promise<Params> }) {
  const { worldId: rawId } = await params
  const worldId = Number(rawId)
  if (!Number.isInteger(worldId) || worldId <= 0) notFound()

  const container = getContainer()
  const { characters, decks, dossiers, occupancy, places, scenes, sessions, worlds, turns: turnRepo } =
    container
  const world = await worlds.getWorld(worldId)
  if (!world) notFound()

  // Simulation-hub navigation (C4/C5/C6 wiring). The session is the authority on
  // where the player actually is. If they died in the live simulation, awaken
  // them into the hub here — anchored on the authoritative `status: 'dead'`, not
  // fragile prose matching — then route to wherever they now are. Guarded by
  // has_awoken so it runs exactly once.
  const session = await sessions.byWorld(worldId)
  if (session) {
    if (
      session.status === 'in_subworld' &&
      session.subworld_world_id === worldId &&
      session.has_awoken === 0
    ) {
      const cast = await characters.forWorld(worldId)
      const player = cast.find((c) => c.is_player === 1)
      if (player?.status === 'dead') {
        const result = await returnToHub(
          { session },
          { worlds, places, scenes, characters, sessions, decks },
        )
        const hubWorldId = result?.hubWorldId ?? session.hub_world_id
        // Item 4: the narrator takes the first hub turn — the awakening lands
        // with prose, not an empty scene. Runs exactly once (this branch is
        // gated on has_awoken===0, which returnToHub then flips). Best-effort.
        const hub = await worlds.getWorld(hubWorldId)
        const awakeningPremise = [
          hub?.premise ?? '',
          "The protagonist has just died inside a simulation and surfaces into the waking world — the facility's simulation room, the resident crew close by. This is the reveal: the codename, the room, and the people suddenly make sense. Open on the disorientation of coming to.",
        ]
          .filter(Boolean)
          .join(' ')
        await generateOpeningTurn(
          { characters, dossiers, occupancy, places, scenes, turns: turnRepo, worlds },
          hubWorldId,
          awakeningPremise,
        ).catch((err) => console.error('[hub awakening opening]', err))
        redirect(`/worlds/${hubWorldId}/play`)
      }
    }
    const activeWorldId = resolveActiveWorldId(worldId, session)
    if (activeWorldId !== worldId) redirect(`/worlds/${activeWorldId}/play`)
  }

  const turns = await turnRepo.latestTurns(worldId, INITIAL_TURN_LIMIT)
  const initialMessages: ChroniclesMessage[] = turns.map((t) => ({
    id: String(t.id),
    role: t.role,
    metadata: { createdAt: t.created_at },
    parts: [{ type: 'text', text: t.content }],
  }))

  // Metadata only for the rendered slice. Older slices fetch their own
  // metadata via /api/turns alongside the turns themselves.
  const oldestVisibleId = turns[0]?.id ?? Number.MAX_SAFE_INTEGER
  const initialUsage: TurnCost[] = (
    await turnRepo.assistantMetadataSince(worldId, oldestVisibleId)
  ).map(({ id, metadata }) => summarizeTurn(id, metadata))

  const hasOlder = turns.length > 0 ? await turnRepo.hasTurnBefore(worldId, turns[0].id) : false

  // In the hub, surface the read-only archive of past simulations (v0.2.1).
  const pastSimulations: HubSimulationEntry[] =
    world.world_layer === 'hub'
      ? (await worlds.simulationsForHub(worldId)).map((s) => ({
          id: s.id,
          name: s.name,
          turnCount: s.turn_count,
        }))
      : []

  const chat = (
    <Chat
      worldId={worldId}
      worldName={world.name}
      initialMessages={initialMessages}
      initialUsage={initialUsage}
      initialOldestId={turns[0]?.id ?? null}
      initialHasOlder={hasOlder}
    />
  )

  if (world.world_layer !== 'hub') return chat
  return (
    <div className="relative">
      {chat}
      <HubSimulationsMenu simulations={pastSimulations} />
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Chat, type ChroniclesMessage } from '@/components/Chat'
import { getContainer } from '@/composition/container'
import { summarizeTurn, type TurnCost } from '@/lib/turn-cost'

export const dynamic = 'force-dynamic'

type Params = { worldId: string }

const INITIAL_TURN_LIMIT = 200

// Read-only review of a completed simulation (v0.2.1, Item 2). Reached from the
// hub's "Past Simulations" archive. Renders the simulation's own transcript with
// no composer and no active-world redirect (the play page would bounce a
// finished simulation back to the hub). Sim-only — 404 for anything else.
export default async function ReviewPage({ params }: { params: Promise<Params> }) {
  const { worldId: rawId } = await params
  const worldId = Number(rawId)
  if (!Number.isInteger(worldId) || worldId <= 0) notFound()

  const { worlds, turns: turnRepo } = getContainer()
  const world = await worlds.getWorld(worldId)
  if (!world || world.world_layer !== 'subworld') notFound()

  const turns = await turnRepo.latestTurns(worldId, INITIAL_TURN_LIMIT)
  const initialMessages: ChroniclesMessage[] = turns.map((t) => ({
    id: String(t.id),
    role: t.role,
    metadata: { createdAt: t.created_at },
    parts: [{ type: 'text', text: t.content }],
  }))
  const oldestVisibleId = turns[0]?.id ?? Number.MAX_SAFE_INTEGER
  const initialUsage: TurnCost[] = (
    await turnRepo.assistantMetadataSince(worldId, oldestVisibleId)
  ).map(({ id, metadata }) => summarizeTurn(id, metadata))
  const hasOlder = turns.length > 0 ? await turnRepo.hasTurnBefore(worldId, turns[0].id) : false

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="flex items-center justify-between border-b border-neutral-900 px-4 py-2.5 sm:px-6">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-500/80">
          Simulation record — read only
        </span>
        {world.parent_world_id !== null && (
          <Link
            href={`/worlds/${world.parent_world_id}/play`}
            className="text-sm text-neutral-500 transition hover:text-neutral-300"
          >
            ← Back to hub
          </Link>
        )}
      </div>
      <Chat
        worldId={worldId}
        worldName={world.name}
        initialMessages={initialMessages}
        initialUsage={initialUsage}
        initialOldestId={turns[0]?.id ?? null}
        initialHasOlder={hasOlder}
        readOnly
      />
    </div>
  )
}

import { notFound } from 'next/navigation'

import { Chat, type ChroniclesMessage } from '@/components/Chat'
import { assistantMetadataSince, hasTurnBefore, latestTurns } from '@/lib/db'
import { summarizeTurn, type TurnCost } from '@/lib/turn-cost'
import { getWorld } from '@/lib/worlds'

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

  const world = getWorld(worldId)
  if (!world) notFound()

  const turns = latestTurns(worldId, INITIAL_TURN_LIMIT)
  const initialMessages: ChroniclesMessage[] = turns.map((t) => ({
    id: String(t.id),
    role: t.role,
    metadata: { createdAt: t.created_at },
    parts: [{ type: 'text', text: t.content }],
  }))

  // Metadata only for the rendered slice. Older slices fetch their own
  // metadata via /api/turns alongside the turns themselves.
  const oldestVisibleId = turns[0]?.id ?? Number.MAX_SAFE_INTEGER
  const initialUsage: TurnCost[] = assistantMetadataSince(worldId, oldestVisibleId).map(
    ({ id, metadata }) => summarizeTurn(id, metadata),
  )

  const hasOlder = turns.length > 0 ? hasTurnBefore(worldId, turns[0].id) : false

  return (
    <Chat
      worldId={worldId}
      worldName={world.name}
      initialMessages={initialMessages}
      initialUsage={initialUsage}
      initialOldestId={turns[0]?.id ?? null}
      initialHasOlder={hasOlder}
    />
  )
}

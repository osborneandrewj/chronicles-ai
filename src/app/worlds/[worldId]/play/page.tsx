import { notFound } from 'next/navigation'
import type { UIMessage } from 'ai'

import { Chat } from '@/components/Chat'
import { allAssistantMetadata, allTurns } from '@/lib/db'
import { summarizeTurn, type TurnCost } from '@/lib/turn-cost'
import { getWorld } from '@/lib/worlds'

export const dynamic = 'force-dynamic'

type Params = { worldId: string }

export default async function PlayPage({ params }: { params: Promise<Params> }) {
  const { worldId: rawId } = await params
  const worldId = Number(rawId)
  if (!Number.isInteger(worldId) || worldId <= 0) notFound()

  const world = getWorld(worldId)
  if (!world) notFound()

  const initialMessages: UIMessage[] = allTurns(worldId).map((t) => ({
    id: String(t.id),
    role: t.role,
    parts: [{ type: 'text', text: t.content }],
  }))

  const initialUsage: TurnCost[] = allAssistantMetadata(worldId).map(({ id, metadata }) =>
    summarizeTurn(id, metadata),
  )

  return (
    <Chat
      worldId={worldId}
      worldName={world.name}
      initialMessages={initialMessages}
      initialUsage={initialUsage}
    />
  )
}

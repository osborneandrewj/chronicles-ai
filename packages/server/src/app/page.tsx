import Link from 'next/link'

import pkg from '../../package.json'
import { ArchivedSection } from '@/components/ArchivedSection'
import { WhatsNewDialog } from '@/components/release-notes/WhatsNewDialog'
import { WorldRowMenu } from '@/components/WorldRowMenu'
import { getContainer } from '@/composition/container'
import type { WorldSummary } from '@/domain/entities'
import { isWorldListVisible } from '@/domain/services/world-visibility'

export const dynamic = 'force-dynamic'

export default async function Home() {
  // Read the world list through the repository port (not lib/worlds directly) so
  // the homepage reflects the ACTIVE persistence model — under PERSISTENCE=mongo
  // it lists Mongo worlds, not the SQLite file. (P6: strangle SQL-reading Server
  // Components onto ports.)
  const { sessions, worlds: worldRepo } = getContainer()
  const allWorlds = await worldRepo.listWorlds()
  // One entry per playthrough (v0.2.1): the active simulation while the hub is
  // concealed, the hub once the player has awoken (past simulations move into
  // the hub's archive). Standalone worlds always show. The pure
  // isWorldListVisible rule decides; we just resolve each world's session.
  const visibility = await Promise.all(
    allWorlds.map(async (w) => isWorldListVisible(w, await sessions.byWorld(w.id))),
  )
  const worlds = allWorlds.filter((_, i) => visibility[i])
  const archived = await worldRepo.listArchivedWorlds()

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col overflow-x-hidden bg-black px-4 py-5 sm:px-8 sm:py-8">
      <header className="mb-7 flex min-h-14 min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-neutral-100">
              Chronicles
            </h1>
            <WhatsNewDialog version={pkg.version} />
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {worlds.length} world{worlds.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/worlds/new"
          aria-label="Create new world"
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-amber-500 px-4 text-sm font-semibold text-neutral-950 shadow-lg shadow-amber-950/30 transition hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          <PlusIcon />
          <span>New</span>
        </Link>
      </header>

      {worlds.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {worlds.map((w) => (
            <li key={w.id}>
              <WorldRow world={w} menuVariant="archive" />
            </li>
          ))}
        </ul>
      )}

      <ArchivedSection worlds={archived} />
    </main>
  )
}

function EmptyState() {
  return (
    <div className="flex min-h-[55svh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-neutral-800 bg-[#1b1c1f]/70 px-6 py-12 text-center">
      <p className="font-serif text-lg italic leading-relaxed text-neutral-300">No worlds yet.</p>
      <Link
        href="/worlds/new"
        className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-amber-500 px-5 text-sm font-semibold text-neutral-950 shadow-lg shadow-amber-950/30 transition hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        <PlusIcon />
        <span>New world</span>
      </Link>
    </div>
  )
}

function WorldRow({
  world,
  menuVariant,
}: {
  world: WorldSummary
  menuVariant: 'archive' | 'unarchive'
}) {
  const muted = menuVariant === 'unarchive'
  return (
    <div
      className={`group relative flex min-h-28 max-w-full items-center gap-3 overflow-hidden rounded-[1.75rem] border border-neutral-800 bg-[#1b1c1f] px-4 py-4 shadow-lg shadow-black/20 transition hover:border-neutral-700 hover:bg-[#1f2024] sm:px-5 ${
        muted ? 'opacity-60' : ''
      }`}
    >
      <Link
        href={`/worlds/${world.id}/play`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[1.5rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-lg font-semibold tracking-tight text-neutral-100">
              {world.name}
            </span>
            <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-1 text-xs tabular-nums text-neutral-400">
              {world.turn_count}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 break-words font-serif text-base leading-relaxed text-neutral-300">
            {world.premise}
          </p>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-neutral-500">
            <ClockIcon />
            <span>{formatCreatedAt(world.created_at)}</span>
            <span aria-hidden>·</span>
            <span>
              {world.turn_count} turn{world.turn_count === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </Link>
      <WorldRowMenu worldId={world.id} variant={menuVariant} />
    </div>
  )
}

function PlusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M8 3.5v9" />
      <path d="M3.5 8h9" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.25l2 1.25" />
    </svg>
  )
}

function formatCreatedAt(raw: string): string {
  // SQLite returns ISO-like "YYYY-MM-DD HH:MM:SS" in UTC. Render the date only;
  // exact time doesn't matter in the list.
  const datePart = raw.split(' ')[0] ?? raw
  return datePart
}

import Link from 'next/link'

import pkg from '../../package.json'
import { listWorlds, type WorldSummary } from '@/lib/worlds'

export const dynamic = 'force-dynamic'

export default function Home() {
  const worlds = listWorlds()

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-black px-4 py-5 sm:px-8 sm:py-8">
      <header className="mb-7 flex min-h-14 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-neutral-100">
              Chronicles
            </h1>
            <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300">
              v{pkg.version}
            </span>
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
              <WorldRow world={w} />
            </li>
          ))}
        </ul>
      )}
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

function WorldRow({ world }: { world: WorldSummary }) {
  return (
    <Link
      href={`/worlds/${world.id}/play`}
      className="group flex min-h-28 items-center gap-3 rounded-[1.75rem] border border-neutral-800 bg-[#1b1c1f] px-4 py-4 shadow-lg shadow-black/20 transition hover:border-neutral-700 hover:bg-[#1f2024] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 sm:px-5"
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
        <p className="mt-2 line-clamp-2 font-serif text-base leading-relaxed text-neutral-300">
          {world.premise}
        </p>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
          <ClockIcon />
          <span>{formatCreatedAt(world.created_at)}</span>
          <span aria-hidden>·</span>
          <span>
            {world.turn_count} turn{world.turn_count === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <span
        aria-hidden
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral-700/80 text-neutral-300 transition group-hover:border-amber-500/50 group-hover:text-amber-200"
      >
        <ArrowRightIcon />
      </span>
    </Link>
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

function ArrowRightIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
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

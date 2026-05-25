import Link from 'next/link'

import pkg from '../../package.json'
import { listWorlds, type WorldSummary } from '@/lib/worlds'

export const dynamic = 'force-dynamic'

export default function Home() {
  const worlds = listWorlds()

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-10">
      <header className="mb-10 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-neutral-100">Chronicles</span>
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-500/80">
            v{pkg.version}
          </span>
        </div>
        <Link
          href="/worlds/new"
          className="rounded-lg bg-amber-500/90 px-3.5 py-1.5 text-sm font-medium text-neutral-950 transition hover:bg-amber-400"
        >
          New world
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
    <div className="rounded-xl border border-dashed border-neutral-800 px-6 py-12 text-center text-sm text-neutral-500">
      <p className="font-serif italic">No worlds yet.</p>
      <p className="mt-2">
        Start one from <span className="text-neutral-300">New world</span>.
      </p>
    </div>
  )
}

function WorldRow({ world }: { world: WorldSummary }) {
  return (
    <Link
      href={`/worlds/${world.id}/play`}
      className="block rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 transition hover:border-neutral-700 hover:bg-neutral-900/70"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base font-medium text-neutral-100">{world.name}</span>
        <span className="text-xs tabular-nums text-neutral-500">
          {world.turn_count} turn{world.turn_count === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 font-serif text-sm leading-relaxed text-neutral-400">
        {world.premise}
      </p>
      <div className="mt-2 text-[11px] text-neutral-600">{formatCreatedAt(world.created_at)}</div>
    </Link>
  )
}

function formatCreatedAt(raw: string): string {
  // SQLite returns ISO-like "YYYY-MM-DD HH:MM:SS" in UTC. Render the date only;
  // exact time doesn't matter in the list.
  const datePart = raw.split(' ')[0] ?? raw
  return datePart
}

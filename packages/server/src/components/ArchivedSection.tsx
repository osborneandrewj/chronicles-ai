'use client'

import Link from 'next/link'
import { useState } from 'react'

import { WorldRowMenu } from '@/components/WorldRowMenu'
import type { WorldSummary } from '@/lib/worlds'

export function ArchivedSection({ worlds }: { worlds: WorldSummary[] }) {
  const [open, setOpen] = useState(false)

  if (worlds.length === 0) return null

  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left text-xs font-medium uppercase tracking-[0.14em] text-neutral-500 transition hover:text-neutral-300 focus:outline-none"
      >
        <ChevronIcon open={open} />
        <span>Archived ({worlds.length})</span>
      </button>
      {open && (
        <ul className="mt-3 space-y-3">
          {worlds.map((w) => (
            <li key={w.id}>
              <ArchivedRow world={w} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ArchivedRow({ world }: { world: WorldSummary }) {
  return (
    <div className="group relative flex min-h-24 items-center gap-3 rounded-[1.75rem] border border-neutral-800/70 bg-[#161719] px-4 py-4 opacity-60 transition hover:opacity-100 sm:px-5">
      <Link
        href={`/worlds/${world.id}/play`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[1.5rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-semibold tracking-tight text-neutral-200">
              {world.name}
            </span>
            <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-1 text-xs tabular-nums text-neutral-500">
              {world.turn_count}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-1 font-serif text-sm leading-relaxed text-neutral-400">
            {world.premise}
          </p>
        </div>
      </Link>
      <WorldRowMenu worldId={world.id} variant="unarchive" />
    </div>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}

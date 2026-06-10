'use client'

import Link from 'next/link'
import { useState } from 'react'

export interface HubSimulationEntry {
  id: number
  name: string
  turnCount: number
}

interface HubSimulationsMenuProps {
  simulations: HubSimulationEntry[]
}

// The hub's read-only archive of past simulations (v0.2.1, Item 2). A small
// floating control in the hub view; opening an entry routes to that
// simulation's read-only transcript (/worlds/[id]/review).
export function HubSimulationsMenu({ simulations }: HubSimulationsMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-20 sm:right-6 sm:top-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-lg border border-neutral-800 bg-neutral-900/80 px-3 py-1.5 text-xs font-medium text-neutral-300 backdrop-blur transition hover:border-neutral-700 hover:text-neutral-100"
      >
        Past Simulations ({simulations.length})
      </button>
      {open && (
        <div className="mt-2 w-72 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/95 shadow-xl backdrop-blur">
          {simulations.length === 0 ? (
            <p className="px-3 py-3 text-xs text-neutral-500">No completed simulations yet.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {simulations.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/worlds/${s.id}/review`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
                  >
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 text-[11px] text-neutral-500">{s.turnCount} turns</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

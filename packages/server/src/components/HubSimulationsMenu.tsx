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

// The hub's read-only archive of past simulations (v0.2.1, Item 2). Lives in
// the play header so it cannot overlay inspector / audio / reader controls.
// Opening an entry routes to that simulation's read-only transcript.
export function HubSimulationsMenu({ simulations }: HubSimulationsMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-11 max-w-[9.5rem] items-center whitespace-nowrap rounded-full px-2.5 text-sm font-medium reader-muted transition reader-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 sm:max-w-none"
      >
        <span className="sm:hidden">Sims ({simulations.length})</span>
        <span className="hidden sm:inline">Past Simulations ({simulations.length})</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-20 w-[min(calc(100vw-1.5rem),20rem)] overflow-hidden rounded-xl border reader-border reader-panel shadow-xl backdrop-blur"
        >
          {simulations.length === 0 ? (
            <p className="px-3 py-3 text-sm reader-faint">No completed simulations yet.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {simulations.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/worlds/${s.id}/review`}
                    role="menuitem"
                    className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm reader-button-text transition reader-hover"
                  >
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 text-xs reader-faint">{s.turnCount} turns</span>
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

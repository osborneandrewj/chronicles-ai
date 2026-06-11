'use client'

import { useState } from 'react'

import { AdventurePicker } from './AdventurePicker'
import { CreateWorldForm } from './CreateWorldForm'
import { QuickStartForm } from './QuickStartForm'
import { StarshipLaunch } from './StarshipLaunch'

type Mode = 'basic' | 'advanced'

interface CreateModeTabsProps {
  // When provided (SIM_HUB flag on), the concealed adventure picker replaces the
  // legacy bounded-world launch. Labels only — no premise or architecture leaks.
  adventureOptions?: { id: string; label: string }[] | null
}

export function CreateModeTabs({ adventureOptions = null }: CreateModeTabsProps) {
  const [mode, setMode] = useState<Mode>('basic')
  const concealed = adventureOptions !== null && adventureOptions.length > 0

  return (
    <div className="space-y-6">
      <div className="inline-flex max-w-full rounded-xl border border-neutral-800 bg-neutral-900/60 p-1">
        <TabButton active={mode === 'basic'} onClick={() => setMode('basic')}>
          Quick start
        </TabButton>
        <TabButton active={mode === 'advanced'} onClick={() => setMode('advanced')}>
          Advanced
        </TabButton>
      </div>

      {mode === 'basic' ? (
        <div className="space-y-6">
          {concealed ? <AdventurePicker options={adventureOptions} /> : <StarshipLaunch />}
          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden>
              <div className="w-full border-t border-neutral-800" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-neutral-950 px-3 text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">
                or generate a world
              </span>
            </div>
          </div>
          <QuickStartForm />
        </div>
      ) : (
        <CreateWorldForm />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none ${
        active ? 'bg-amber-500/90 text-neutral-950' : 'text-neutral-400 hover:text-neutral-100'
      }`}
    >
      {children}
    </button>
  )
}

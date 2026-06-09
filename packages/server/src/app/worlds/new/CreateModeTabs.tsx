'use client'

import { useState } from 'react'

import { CreateWorldForm } from './CreateWorldForm'
import { QuickStartForm } from './QuickStartForm'
import { StarshipLaunch } from './StarshipLaunch'

type Mode = 'basic' | 'advanced'

export function CreateModeTabs() {
  const [mode, setMode] = useState<Mode>('basic')

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-xl border border-neutral-800 bg-neutral-900/60 p-1">
        <TabButton active={mode === 'basic'} onClick={() => setMode('basic')}>
          Quick start
        </TabButton>
        <TabButton active={mode === 'advanced'} onClick={() => setMode('advanced')}>
          Advanced
        </TabButton>
      </div>

      {mode === 'basic' ? (
        <div className="space-y-6">
          <StarshipLaunch />
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
      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition focus:outline-none ${
        active ? 'bg-amber-500/90 text-neutral-950' : 'text-neutral-400 hover:text-neutral-100'
      }`}
    >
      {children}
    </button>
  )
}

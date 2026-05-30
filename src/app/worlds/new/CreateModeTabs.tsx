'use client'

import { useState } from 'react'

import { CreateWorldForm } from './CreateWorldForm'
import { QuickStartForm } from './QuickStartForm'

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

      {mode === 'basic' ? <QuickStartForm /> : <CreateWorldForm />}
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

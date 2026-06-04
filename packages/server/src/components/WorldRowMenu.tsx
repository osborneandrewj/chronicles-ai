'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

import { archiveWorldAction, unarchiveWorldAction } from '@/app/worlds/actions'

type WorldRowMenuProps = {
  worldId: number
  variant: 'archive' | 'unarchive'
}

export function WorldRowMenu({ worldId, variant }: WorldRowMenuProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function runAction() {
    setOpen(false)
    startTransition(async () => {
      if (variant === 'archive') {
        await archiveWorldAction(worldId)
      } else {
        await unarchiveWorldAction(worldId)
      }
    })
  }

  const label = variant === 'archive' ? 'Archive' : 'Unarchive'

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`${label} world`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:opacity-50"
      >
        <DotsIcon />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-10 min-w-32 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 py-1 shadow-xl shadow-black/40"
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              runAction()
            }}
            className="block w-full px-3 py-2 text-left text-sm text-neutral-200 transition hover:bg-neutral-800"
          >
            {label}
          </button>
        </div>
      )}
    </div>
  )
}

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="8" cy="3" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="8" cy="13" r="1.4" />
    </svg>
  )
}

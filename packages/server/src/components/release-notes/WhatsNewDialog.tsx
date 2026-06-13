'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { RELEASES } from './data'
import { ReleaseNotes } from './ReleaseNotes'

interface WhatsNewDialogProps {
  version: string
}

const STORAGE_KEY = 'chronicles:lastSeenVersion'
const LATEST_VERSION = RELEASES[0]?.version ?? ''

// The header version chip, turned into a "What's New" trigger (v0.3.0). Renders
// the same amber chip as a button plus an optional unread dot, and owns the
// modal listing recent releases. Pure presentation — no domain/use-case import;
// the release data is a static module.
export function WhatsNewDialog({ version }: WhatsNewDialogProps) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Unread dot: resolved after mount so the server/client markup matches (the
  // dot depends on localStorage, which is client-only).
  useEffect(() => {
    try {
      const lastSeen = window.localStorage.getItem(STORAGE_KEY)
      setUnread(LATEST_VERSION !== '' && lastSeen !== LATEST_VERSION)
    } catch {
      // localStorage unavailable (private mode / SSR) — no dot, no failure.
    }
  }, [])

  const handleOpen = useCallback(() => {
    setOpen(true)
    setUnread(false)
    try {
      window.localStorage.setItem(STORAGE_KEY, LATEST_VERSION)
    } catch {
      // Ignore — failing to persist only means the dot may reappear later.
    }
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Esc to close + focus the close button on open + lock body scroll.
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, handleClose])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Version ${version} — what’s new`}
        className="relative shrink-0 rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300 transition hover:bg-amber-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      >
        v{version}
        {unread && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-black"
          />
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={handleClose}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="whats-new-title"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85svh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-neutral-800 bg-[#1b1c1f] shadow-2xl shadow-black/50 sm:rounded-3xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
              <h2
                id="whats-new-title"
                className="text-lg font-semibold tracking-tight text-neutral-100"
              >
                What’s New
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={handleClose}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              >
                <CloseIcon />
              </button>
            </header>
            <div className="overflow-y-auto px-5 py-5">
              <ReleaseNotes releases={RELEASES} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

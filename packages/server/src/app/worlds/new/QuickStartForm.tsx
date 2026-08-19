'use client'

import { useActionState, useState } from 'react'

import { GENRES } from '@/lib/genres'
import { createBasicWorldAction, type CreateWorldFormState } from './actions'

const INITIAL: CreateWorldFormState = {}

export function QuickStartForm() {
  const [state, formAction, pending] = useActionState(createBasicWorldAction, INITIAL)
  const [genre, setGenre] = useState<string>('')

  return (
    <form action={formAction} className="space-y-6 pb-28 sm:pb-0">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-neutral-400">
          Your name
        </span>
        <input
          name="playerName"
          type="text"
          placeholder="Leave blank for an unnamed protagonist"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2.5 text-base text-neutral-100 placeholder:text-neutral-500 transition focus:border-neutral-600 focus:bg-neutral-900 focus:outline-none"
        />
      </label>

      <div>
        <span className="mb-2 block text-xs font-medium uppercase tracking-[0.1em] text-neutral-400">
          Genre <span className="ml-1 text-amber-500/80">*</span>
        </span>
        <input type="hidden" name="genre" value={genre} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GENRES.map((g) => {
            const selected = g === genre
            return (
              <button
                type="button"
                key={g}
                onClick={() => setGenre(g)}
                aria-pressed={selected}
                className={`min-h-11 rounded-xl border px-3 py-2.5 text-left text-sm leading-snug transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
                  selected
                    ? 'border-amber-500/80 bg-amber-500/15 text-amber-100'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900'
                }`}
              >
                {g}
              </button>
            )
          })}
        </div>
      </div>

      {state.error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-800 bg-neutral-950/95 px-5 py-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        <div className="mx-auto flex max-w-2xl justify-end pb-[env(safe-area-inset-bottom)] sm:pb-0">
          <button
            type="submit"
            disabled={pending || genre === ''}
            className="min-h-12 w-full rounded-lg bg-amber-500/90 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500 sm:w-auto"
          >
            {pending ? 'Generating…' : 'Generate park'}
          </button>
        </div>
      </div>
    </form>
  )
}

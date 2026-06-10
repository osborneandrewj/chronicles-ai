'use client'

import { useActionState, useState } from 'react'

import { createAdventureAction, type CreateWorldFormState } from './actions'

const INITIAL: CreateWorldFormState = {}

interface AdventureOption {
  id: string
  label: string
}

interface AdventurePickerProps {
  options: AdventureOption[]
}

// Concealed onboarding picker (Phase B, B6). Lists adventure LABELS only — no
// premise, no setting blurb, no "ship"/"hub"/"simulation"/"sub-world" vocabulary.
// The player chooses an adventure; the server mints an ambiguous codename and
// drops them in. The architecture is revealed only in fiction, never in this UI.
export function AdventurePicker({ options }: AdventurePickerProps) {
  const [state, formAction, pending] = useActionState(createAdventureAction, INITIAL)
  const [genreId, setGenreId] = useState<string>('')

  return (
    <form action={formAction} className="space-y-6">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">
          Your name
        </span>
        <input
          name="playerName"
          type="text"
          placeholder="Leave blank for an unnamed protagonist"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-[15px] text-neutral-100 placeholder:text-neutral-500 transition focus:border-neutral-600 focus:bg-neutral-900 focus:outline-none"
        />
      </label>

      <div>
        <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">
          Choose an adventure <span className="ml-1 text-amber-500/80">*</span>
        </span>
        <input type="hidden" name="genreId" value={genreId} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.map((o) => {
            const selected = o.id === genreId
            return (
              <button
                type="button"
                key={o.id}
                onClick={() => setGenreId(o.id)}
                aria-pressed={selected}
                className={`rounded-xl border px-3 py-2.5 text-left text-[13px] leading-snug transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
                  selected
                    ? 'border-amber-500/80 bg-amber-500/15 text-amber-100'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900'
                }`}
              >
                {o.label}
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

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || genreId === ''}
          className="rounded-lg bg-amber-500/90 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {pending ? 'Beginning…' : 'Begin'}
        </button>
      </div>
    </form>
  )
}

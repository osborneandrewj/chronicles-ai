'use client'

import { useActionState } from 'react'

import { createStarshipWorldAction, type CreateWorldFormState } from './actions'

const INITIAL: CreateWorldFormState = {}

// The bounded "living world" entry — visually set apart from the amber genre grid
// with a sky/cyan accent. Its own <form> + useActionState so its pending/error
// state is independent of the genre flow below. The player name is optional; the
// ship and premise are authored, so there is nothing else to choose.
export function StarshipLaunch() {
  const [state, formAction, pending] = useActionState(createStarshipWorldAction, INITIAL)

  return (
    <form
      action={formAction}
      className="rounded-xl border border-sky-500/40 bg-sky-500/[0.07] p-4 space-y-4"
    >
      <div className="space-y-1.5">
        <span className="block text-xs font-medium uppercase tracking-[0.14em] text-sky-300/90">
          Living world · experimental
        </span>
        <h3 className="text-base font-semibold text-neutral-100">Starship</h3>
        <p className="text-sm text-neutral-400">
          A crewed scout ship, already in motion before you board.
        </p>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-sky-300/80">
          Your name <span className="text-neutral-500">(optional)</span>
        </span>
        <input
          name="playerName"
          type="text"
          placeholder="Leave blank to board as an unnamed newcomer"
          className="w-full rounded-lg border border-sky-500/30 bg-neutral-900/60 px-3 py-2 text-[15px] text-neutral-100 placeholder:text-neutral-500 transition focus:border-sky-500/60 focus:bg-neutral-900 focus:outline-none"
        />
      </label>

      {state.error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-sky-500/90 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {pending ? 'Launching your ship…' : 'Launch the scout'}
        </button>
      </div>
    </form>
  )
}

'use client'

import { useActionState } from 'react'

import { loginAction, type LoginState } from './actions'

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    null,
  )

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-300">
          Password
        </span>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          placeholder="Shared tester password"
          className="h-12 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-amber-500/70 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        />
      </label>
      {state?.error ? (
        <p className="text-sm text-rose-400" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-12 w-full items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-neutral-950 shadow-lg shadow-amber-950/30 transition hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Checking…' : 'Continue'}
      </button>
    </form>
  )
}

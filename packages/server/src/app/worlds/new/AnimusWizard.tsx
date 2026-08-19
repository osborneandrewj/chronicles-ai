'use client'

import { useActionState, useEffect, useRef, useState, type Ref } from 'react'

import { createAnimusAction, type CreateWorldFormState } from './actions'

const INITIAL: CreateWorldFormState = {}

type FirstLife =
  | { kind: 'preset'; id: string }
  | { kind: 'genre'; id: string }
  | { kind: ''; id: '' }

interface AnimusWizardProps {
  presets: { id: string; label: string }[]
  signalGenres: readonly string[]
}

export function AnimusWizard({ presets, signalGenres }: AnimusWizardProps) {
  const [state, formAction, pending] = useActionState(createAnimusAction, INITIAL)
  const [firstLife, setFirstLife] = useState<FirstLife>({ kind: '', id: '' })
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (firstLife.id) selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [firstLife.id])

  const canSubmit = firstLife.id !== ''

  return (
    <form action={formAction} className="space-y-8 pb-28">
      <input type="hidden" name="firstLifeKind" value={firstLife.kind} />
      <input type="hidden" name="firstLifeId" value={firstLife.id} />

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-neutral-400">
          Your name
        </span>
        <input
          name="playerName"
          type="text"
          placeholder="Leave blank for an unnamed newcomer"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2.5 text-base text-neutral-100 placeholder:text-neutral-500 transition focus:border-neutral-600 focus:bg-neutral-900 focus:outline-none"
        />
      </label>

      <section>
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">
          First narrative <span className="ml-1 text-amber-500/80">*</span>
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          The first narrative you enter from this facility. Play starts there.
        </p>

        <p className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
          Prepared settings
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {presets.map((o) => {
            const selected = firstLife.kind === 'preset' && firstLife.id === o.id
            return (
              <LifeChip
                key={o.id}
                label={o.label}
                selected={selected}
                chipRef={selected ? selectedRef : undefined}
                onSelect={() => setFirstLife({ kind: 'preset', id: o.id })}
              />
            )
          })}
        </div>

        {signalGenres.length > 0 ? (
          <>
            <p className="mt-5 mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
              Modern / sci-fi narratives
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {signalGenres.map((g) => {
                const selected = firstLife.kind === 'genre' && firstLife.id === g
                return (
                  <LifeChip
                    key={g}
                    label={g}
                    selected={selected}
                    chipRef={selected ? selectedRef : undefined}
                    onSelect={() => setFirstLife({ kind: 'genre', id: g })}
                  />
                )
              })}
            </div>
          </>
        ) : null}
      </section>

      {state.error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-800 bg-neutral-950/95 px-5 py-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        <div className="mx-auto flex max-w-2xl justify-end pb-[env(safe-area-inset-bottom)] sm:pb-0">
          <button
            type="submit"
            disabled={pending || !canSubmit}
            className="min-h-12 w-full rounded-lg bg-amber-500/90 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500 sm:w-auto"
          >
            {pending ? 'Forging…' : 'Enter the first narrative'}
          </button>
        </div>
      </div>
    </form>
  )
}

function LifeChip({
  label,
  selected,
  onSelect,
  chipRef,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  chipRef?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      type="button"
      ref={chipRef}
      onClick={onSelect}
      aria-pressed={selected}
      className={`min-h-12 rounded-xl border px-3 py-2.5 text-left text-sm leading-snug transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
        selected
          ? 'border-amber-500/80 bg-amber-500/15 text-amber-100'
          : 'border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900'
      }`}
    >
      {label}
    </button>
  )
}

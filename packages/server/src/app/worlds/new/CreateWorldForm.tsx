'use client'

import { useActionState, useState } from 'react'

import { createWorldAction, type CreateWorldFormState } from './actions'

const INITIAL: CreateWorldFormState = {}

export function CreateWorldForm() {
  const [state, formAction, pending] = useActionState(createWorldAction, INITIAL)
  const [uiSkin, setUiSkin] = useState<'relic' | 'signal'>('relic')

  return (
    <form action={formAction} className="space-y-5 pb-28 sm:pb-0">
      <input type="hidden" name="uiSkin" value={uiSkin} />
      <Field
        label="Name"
        name="name"
        placeholder="e.g. Mevagissey 1897"
        required
        defaultValue=""
      />

      <Field
        label="Premise"
        name="premise"
        as="textarea"
        rows={6}
        required
        defaultValue=""
        placeholder="One short paragraph. Setting, era, tone, what's currently happening, who the protagonist is."
        hint="Grounds every narrator turn. Concrete sensory detail beats abstract mood words."
      />

      <Field
        label="Opening location"
        name="location"
        placeholder="e.g. Mevagissey harbour, Cornwall — pubs and quay still in view"
        required
        defaultValue=""
        hint="Where the very first turn opens."
      />

      <Field
        label="Opening time"
        name="time"
        placeholder="Day 1, morning"
        defaultValue=""
        hint="In-world time. Defaults to “Day 1, morning” if left blank."
      />

      <Field
        label="Your character — name"
        name="playerName"
        defaultValue=""
        placeholder="Leave blank for an unnamed protagonist"
        hint="Optional. Defaults to “Player” if blank; you can name your character in play later."
      />

      <Field
        label="Your character — description"
        name="identity"
        as="textarea"
        rows={3}
        defaultValue=""
        placeholder="Travel-worn newcomer — name not yet established."
        hint="1–2 sentences on who the protagonist is, what they look like, what they're carrying."
      />

      <div>
        <span className="mb-2 block text-xs font-medium uppercase tracking-[0.1em] text-neutral-400">
          Play look
        </span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={uiSkin === 'relic'}
            onClick={() => setUiSkin('relic')}
            className={`min-h-12 rounded-xl border px-3 py-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
              uiSkin === 'relic'
                ? 'border-amber-500/80 bg-amber-500/15 text-amber-100'
                : 'border-neutral-800 bg-neutral-900/60 text-neutral-300'
            }`}
          >
            Historical / Fantasy
          </button>
          <button
            type="button"
            aria-pressed={uiSkin === 'signal'}
            onClick={() => setUiSkin('signal')}
            className={`min-h-12 rounded-xl border px-3 py-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
              uiSkin === 'signal'
                ? 'border-amber-500/80 bg-amber-500/15 text-amber-100'
                : 'border-neutral-800 bg-neutral-900/60 text-neutral-300'
            }`}
          >
            Modern / Sci-fi
          </button>
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
            disabled={pending}
            className="min-h-12 w-full rounded-lg bg-amber-500/90 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500 sm:w-auto"
          >
            {pending ? 'Creating…' : 'Create park'}
          </button>
        </div>
      </div>
    </form>
  )
}

type FieldProps = {
  label: string
  name: string
  defaultValue: string
  placeholder?: string
  hint?: string
  required?: boolean
} & ({ as?: 'input' } | { as: 'textarea'; rows: number })

function Field(props: FieldProps) {
  const isTextarea = props.as === 'textarea'
  const baseInput =
    'w-full rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2.5 text-base text-neutral-100 placeholder:text-neutral-500 transition focus:border-neutral-600 focus:bg-neutral-900 focus:outline-none'
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-neutral-400">
        {props.label}
        {props.required && <span className="ml-1 text-amber-500/80">*</span>}
      </span>
      {isTextarea ? (
        <textarea
          name={props.name}
          rows={(props as { rows: number }).rows}
          required={props.required}
          placeholder={props.placeholder}
          defaultValue={props.defaultValue}
          className={`${baseInput} resize-y leading-relaxed`}
        />
      ) : (
        <input
          name={props.name}
          type="text"
          required={props.required}
          placeholder={props.placeholder}
          defaultValue={props.defaultValue}
          className={baseInput}
        />
      )}
      {props.hint && <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">{props.hint}</p>}
    </label>
  )
}

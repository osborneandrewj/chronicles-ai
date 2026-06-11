'use client'

import { useActionState } from 'react'

import { createWorldAction, type CreateWorldFormState } from './actions'

const INITIAL: CreateWorldFormState = {}

export function CreateWorldForm() {
  const [state, formAction, pending] = useActionState(createWorldAction, INITIAL)

  return (
    <form action={formAction} className="space-y-5">
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

      {state.error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-amber-500/90 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {pending ? 'Creating…' : 'Create world'}
        </button>
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

import Link from 'next/link'

import { CreateWorldForm } from './CreateWorldForm'

export const dynamic = 'force-dynamic'

export default function NewWorldPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-10">
      <header className="mb-8 flex items-baseline justify-between">
        <Link href="/" className="text-sm text-neutral-500 transition hover:text-neutral-300">
          ← Worlds
        </Link>
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-500/80">
          New world
        </span>
      </header>

      <h1 className="mb-1 text-xl font-semibold tracking-tight text-neutral-100">
        Start a new world
      </h1>
      <p className="mb-8 max-w-prose font-serif text-sm leading-relaxed text-neutral-400">
        The premise and opening state ground every narrator turn. Be specific about setting and
        tone — the narrator will hew closer to vivid concrete details than to vague mood words.
      </p>

      <CreateWorldForm />
    </main>
  )
}

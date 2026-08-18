import Link from 'next/link'

import { isAnimusEnabled, listGenrePresets } from '@/composition/onboarding'
import { resolveUiSkin } from '@/domain/services/ui-skin'
import { GENRES } from '@/lib/genres'

import { AnimusWizard } from './AnimusWizard'
import { CreateWorldForm } from './CreateWorldForm'
import { PathChooser } from './PathChooser'
import { QuickStartForm } from './QuickStartForm'
import { StarshipLaunch } from './StarshipLaunch'

export const dynamic = 'force-dynamic'

type Search = { path?: string }

export default async function NewWorldPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const { path } = await searchParams
  const animusEnabled = isAnimusEnabled()
  const signalGenres = GENRES.filter((g) => resolveUiSkin({ genreTags: [g] }) === 'signal')

  const title =
    path === 'animus'
      ? 'Forge an Animus'
      : path === 'generated'
        ? 'Generate a world'
        : path === 'custom'
          ? 'Write a custom world'
          : 'New world'

  const blurb =
    path === 'animus'
      ? 'A sci-fi home facility you return to. Pick the first life you will enter.'
      : path === 'generated'
        ? 'Pick a genre. We invent a standalone world. It is not an Animus — there is no home facility to return to.'
        : path === 'custom'
          ? 'You write the name, premise, and opening. One standalone world.'
          : 'Choose what kind of world you are making. Each type plays differently.'

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-10">
      <header className="mb-8 flex items-baseline justify-between">
        <Link
          href={path ? '/worlds/new' : '/'}
          className="text-sm text-neutral-500 transition hover:text-neutral-300"
        >
          {path ? '← World types' : '← Worlds'}
        </Link>
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-500/80">
          {path === 'animus' ? 'Animus' : path === 'generated' ? 'Generated' : path === 'custom' ? 'Custom' : 'New'}
        </span>
      </header>

      <h1 className="mb-1 text-xl font-semibold tracking-tight text-neutral-100">{title}</h1>
      <p className="mb-8 max-w-prose font-serif text-sm leading-relaxed text-neutral-400">{blurb}</p>

      {!path ? <PathChooser animusEnabled={animusEnabled} /> : null}
      {path === 'animus' && animusEnabled ? (
        <AnimusWizard presets={listGenrePresets()} signalGenres={signalGenres} />
      ) : null}
      {path === 'animus' && !animusEnabled ? (
        <p className="text-sm text-neutral-400">Animus creation is turned off.</p>
      ) : null}
      {path === 'generated' ? (
        <div className="space-y-8">
          <QuickStartForm />
          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden>
              <div className="w-full border-t border-neutral-800" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-neutral-950 px-3 text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">
                or a living ship
              </span>
            </div>
          </div>
          <StarshipLaunch />
        </div>
      ) : null}
      {path === 'custom' ? <CreateWorldForm /> : null}
    </main>
  )
}

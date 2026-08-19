import Link from 'next/link'

import { isAnimusEnabled, listGenrePresets } from '@/composition/onboarding'
import { getPark, PARK_CATALOG } from '@/domain/services/park-catalog'
import { resolveUiSkin } from '@/domain/services/ui-skin'
import { GENRES } from '@/lib/genres'

import { AnimusWizard } from './AnimusWizard'
import { CreateWorldForm } from './CreateWorldForm'
import { ParkCatalog } from './ParkCatalog'
import { ParkEnterForm } from './ParkEnterForm'
import { PathChooser } from './PathChooser'
import { QuickStartForm } from './QuickStartForm'
import { StarshipLaunch } from './StarshipLaunch'

export const dynamic = 'force-dynamic'

type Search = { path?: string; park?: string }

export default async function NewWorldPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const { path, park: parkId } = await searchParams
  const park = parkId ? getPark(parkId) : undefined
  const animusEnabled = isAnimusEnabled()
  const signalGenres = GENRES.filter((g) => resolveUiSkin({ genreTags: [g] }) === 'signal')
  const inLabChild = path === 'animus' || path === 'generated' || path === 'custom'
  const chrome = pageChrome(path, park, parkId)

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-10">
      <header className="mb-8 flex items-baseline justify-between">
        <Link
          href={inLabChild ? '/worlds/new?path=lab' : path || parkId ? '/worlds/new' : '/'}
          className="text-sm text-neutral-500 transition hover:text-neutral-300"
        >
          {inLabChild ? '← Lab' : '← Parks'}
        </Link>
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-500/80">
          {chrome.eyebrow}
        </span>
      </header>

      <h1 className="mb-1 text-xl font-semibold tracking-tight text-neutral-100">{chrome.title}</h1>
      <p className="mb-8 max-w-prose font-serif text-sm leading-relaxed text-neutral-400">
        {chrome.blurb}
      </p>

      {!path && !parkId ? <ParkCatalog parks={PARK_CATALOG} /> : null}
      {parkId && !park ? (
        <p className="text-sm text-neutral-400">That park is not in the catalog.</p>
      ) : null}
      {park ? <ParkEnterForm parkId={park.id} parkName={park.name} /> : null}
      {path === 'lab' && !parkId ? <PathChooser animusEnabled={animusEnabled} /> : null}
      {path === 'animus' && animusEnabled && !parkId ? (
        <AnimusWizard presets={listGenrePresets()} signalGenres={signalGenres} />
      ) : null}
      {path === 'animus' && !animusEnabled && !parkId ? (
        <p className="text-sm text-neutral-400">Facility creation is turned off.</p>
      ) : null}
      {path === 'generated' && !parkId ? (
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
      {path === 'custom' && !parkId ? <CreateWorldForm /> : null}
    </main>
  )
}

function pageChrome(
  path: string | undefined,
  park: ReturnType<typeof getPark>,
  parkId: string | undefined,
): { title: string; blurb: string; eyebrow: string } {
  if (park) {
    return { title: `Enter ${park.name}`, blurb: park.promise, eyebrow: 'Park' }
  }
  if (parkId) {
    return {
      title: 'Park not found',
      blurb: 'That park is not in the catalog.',
      eyebrow: 'Catalog',
    }
  }
  if (path === 'lab') {
    return {
      title: 'Lab',
      blurb: 'Sandbox paths. Catalog parks are the front door; this is for generated and custom play.',
      eyebrow: 'Sandbox',
    }
  }
  if (path === 'animus') {
    return {
      title: 'Forge a facility',
      blurb: 'A home facility you return to. Pick the first narrative you will enter.',
      eyebrow: 'Lab',
    }
  }
  if (path === 'generated') {
    return {
      title: 'Generate a park',
      blurb: 'Pick a genre. We invent a standalone park. There is no home facility to return to.',
      eyebrow: 'Lab',
    }
  }
  if (path === 'custom') {
    return {
      title: 'Write a custom park',
      blurb: 'You write the name, premise, and opening. One standalone park.',
      eyebrow: 'Lab',
    }
  }
  return {
    title: 'Parks',
    blurb: 'Enter a park. Live among its people. Leave with a chronicle.',
    eyebrow: 'Catalog',
  }
}

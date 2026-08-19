import Link from 'next/link'

import type { ParkCatalogEntry } from '@/domain/services/park-catalog'

export function ParkCatalog({ parks }: { parks: readonly ParkCatalogEntry[] }) {
  return (
    <div className="space-y-8">
      <ul className="space-y-3">
        {parks.map((park) => (
          <li key={park.id}>
            <Link
              href={`/worlds/new?park=${park.id}`}
              className="block min-h-28 rounded-[1.5rem] border border-neutral-800 bg-[#1b1c1f] px-4 py-4 transition hover:border-neutral-600 hover:bg-[#1f2024] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 sm:px-5"
            >
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-500/80">
                {park.era}
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-neutral-100">
                {park.name}
              </h2>
              <p className="mt-2 font-serif text-sm leading-relaxed text-neutral-400">
                {park.promise}
              </p>
              {park.hasFacility ? (
                <p className="mt-3 text-xs text-neutral-500">Has a facility you return to.</p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-center text-sm text-neutral-500">
        <Link
          href="/worlds/new?path=lab"
          className="underline decoration-neutral-700 underline-offset-4 transition hover:text-neutral-300"
        >
          Lab
        </Link>
        <span className="text-neutral-600"> — genre grid and custom</span>
      </p>
    </div>
  )
}

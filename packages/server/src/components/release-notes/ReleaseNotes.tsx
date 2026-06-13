import type { Release } from './data'

interface ReleaseNotesProps {
  releases: Release[]
}

// Presentational only — renders a list of releases newest-first. No state, no
// interactivity; safe to render from a Server Component or inside the dialog.
export function ReleaseNotes({ releases }: ReleaseNotesProps) {
  return (
    <ol className="space-y-6">
      {releases.map((release) => (
        <li key={release.version}>
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-semibold tracking-tight text-neutral-100">
              v{release.version}
            </h3>
            <span className="text-xs tabular-nums text-neutral-500">
              {formatReleaseDate(release.date)}
            </span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {release.highlights.map((highlight, i) => (
              <li
                key={i}
                className="flex gap-2 font-serif text-sm leading-relaxed text-neutral-300"
              >
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-400/70" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

function formatReleaseDate(iso: string): string {
  // Parse the yyyy-mm-dd as a local calendar date (no timezone shift) and render
  // a short human form, e.g. "Jun 13, 2026".
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

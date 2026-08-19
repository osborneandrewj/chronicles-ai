import Link from 'next/link'

export function PathChooser({ animusEnabled }: { animusEnabled: boolean }) {
  return (
    <ul className="space-y-3">
      {animusEnabled ? (
        <li>
          <PathCard
            href="/worlds/new?path=animus"
            eyebrow="Lab"
            title="Facility + narrative"
            body="A home facility you return to. Enter a first narrative from it; later narratives launch from the same facility."
          />
        </li>
      ) : null}
      <li>
        <PathCard
          href="/worlds/new?path=generated"
          eyebrow="Lab"
          title="Generated park"
          body="Pick a genre. We invent a unique standalone park — name, place, opening — and you play there. No home facility."
        />
      </li>
      <li>
        <PathCard
          href="/worlds/new?path=custom"
          eyebrow="Lab"
          title="Custom park"
          body="You write the name, premise, and opening yourself."
        />
      </li>
    </ul>
  )
}

function PathCard({
  href,
  eyebrow,
  title,
  body,
}: {
  href: string
  eyebrow: string
  title: string
  body: string
}) {
  return (
    <Link
      href={href}
      className="block min-h-28 rounded-[1.5rem] border border-neutral-800 bg-[#1b1c1f] px-4 py-4 transition hover:border-neutral-600 hover:bg-[#1f2024] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 sm:px-5"
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-500/80">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight text-neutral-100">{title}</h2>
      <p className="mt-2 font-serif text-sm leading-relaxed text-neutral-400">{body}</p>
    </Link>
  )
}

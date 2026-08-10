import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const next = typeof params.next === 'string' ? params.next : '/'

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-[1.75rem] border border-neutral-800 bg-[#1b1c1f] px-6 py-8 shadow-xl shadow-black/40 sm:px-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-amber-500/90">
          Passages
        </p>
        <h1 className="mt-2 font-serif text-3xl font-medium tracking-tight text-neutral-100">
          Enter the shared password
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          One password for the two of you. Stays signed in for 30 days on this
          device.
        </p>
        <div className="mt-6">
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  )
}

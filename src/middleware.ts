import { NextResponse, type NextRequest } from 'next/server'

const REALM = 'Chronicles'

// Two-tester shared-login gate. The env var APP_PASSWORD *is* the secret;
// constant-time compare avoids leaking length-prefix information to a
// network observer. No session, no login page — browsers cache the Basic
// credential per-origin until the tab clears site data.
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}"` },
  })
}

export function middleware(req: NextRequest): NextResponse {
  // Next.js invokes middleware during static prerender too. Prerenders have no
  // user auth headers, so gating them would 401 every static page and break the
  // build. Always pass through during the build phase.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return NextResponse.next()
  }

  const expected = process.env.APP_PASSWORD
  if (!expected) {
    // Dev convenience: an unset password means "no gate" so `npm run dev`
    // works out of the box. Prod refuses to serve — a missing secret in
    // production is a misconfiguration we want to scream about, not paper over.
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('APP_PASSWORD is not configured', { status: 500 })
    }
    return NextResponse.next()
  }

  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Basic ')) return unauthorized()

  let decoded: string
  try {
    decoded = atob(header.slice(6))
  } catch {
    return unauthorized()
  }

  // "user:password" — we ignore the user half, only the password matters.
  const sep = decoded.indexOf(':')
  const supplied = sep >= 0 ? decoded.slice(sep + 1) : decoded
  if (!timingSafeEqual(supplied, expected)) return unauthorized()

  return NextResponse.next()
}

// Match everything except Next.js static assets and the favicon. Auth covers
// /api/* and the homepage; there is no public surface by design.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

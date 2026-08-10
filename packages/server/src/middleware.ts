import { NextResponse, type NextRequest } from 'next/server'

import { AUTH_COOKIE, isValidSessionToken } from '@/lib/app-auth'

/**
 * Shared-password gate for the two-tester deploy.
 *
 * - Unset APP_PASSWORD + non-production → open (local `npm run dev`).
 * - Unset APP_PASSWORD + production → 500 (misconfiguration).
 * - Set APP_PASSWORD → require a valid session cookie (set by /login).
 *
 * Cloudflare Access is no longer required; the app owns the gate.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  // Next.js invokes middleware during static prerender. Pass through so the
  // build is not blocked by a missing cookie / password.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return NextResponse.next()
  }

  const expected = process.env.APP_PASSWORD
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('APP_PASSWORD is not configured', { status: 500 })
    }
    return NextResponse.next()
  }

  const { pathname } = req.nextUrl

  // Login page + its POST action must stay reachable without a session.
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    const token = req.cookies.get(AUTH_COOKIE)?.value
    if (await isValidSessionToken(token, expected)) {
      return NextResponse.redirect(new URL('/', req.url))
    }
    return NextResponse.next()
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (await isValidSessionToken(token, expected)) {
    return NextResponse.next()
  }

  // API clients get 401 JSON; browsers get redirected to the login form.
  const wantsHtml = (req.headers.get('accept') ?? '').includes('text/html')
  if (!wantsHtml || pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const login = new URL('/login', req.url)
  const next = `${pathname}${req.nextUrl.search}`
  if (next && next !== '/') {
    login.searchParams.set('next', next)
  }
  return NextResponse.redirect(login)
}

// Gate the whole app except Next.js static assets and the favicon.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

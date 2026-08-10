'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  AUTH_COOKIE,
  AUTH_MAX_AGE_SECONDS,
  deriveSessionToken,
  timingSafeEqual,
} from '@/lib/app-auth'

export type LoginState = { error: string } | null

function safeNextPath(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/'
  }
  return raw
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const expected = process.env.APP_PASSWORD
  if (!expected) {
    // Local dev with no gate configured — just go home.
    redirect('/')
  }

  const supplied = String(formData.get('password') ?? '')
  if (!timingSafeEqual(supplied, expected)) {
    return { error: 'Wrong password. Try again.' }
  }

  const token = await deriveSessionToken(expected)
  const jar = await cookies()
  jar.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_MAX_AGE_SECONDS,
  })

  redirect(safeNextPath(formData.get('next')))
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies()
  jar.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  redirect('/login')
}

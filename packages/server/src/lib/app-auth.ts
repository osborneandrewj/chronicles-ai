// Shared-password gate helpers for the two-tester deploy.
// Used by Edge middleware and the login Server Action. No domain imports —
// this is an inbound adapter concern (HTTP session), not world state.

export const AUTH_COOKIE = 'chronicles_auth'

/** 30 days — long enough that two testers rarely re-enter the password. */
export const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/** Constant-time string compare (length-leak resistant). */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/**
 * Derive the session cookie value from APP_PASSWORD.
 * The cookie never stores the password; presenting this digest proves knowledge
 * of the current secret. Rotating APP_PASSWORD invalidates every session.
 */
export async function deriveSessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`chronicles-session-v1:${password}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return bufferToHex(hash)
}

export async function isValidSessionToken(
  token: string | undefined,
  password: string,
): Promise<boolean> {
  if (!token) return false
  const expected = await deriveSessionToken(password)
  return timingSafeEqual(token, expected)
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

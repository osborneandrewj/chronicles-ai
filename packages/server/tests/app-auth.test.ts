import { describe, expect, it } from 'vitest'

import {
  deriveSessionToken,
  isValidSessionToken,
  timingSafeEqual,
} from '@/lib/app-auth'

describe('timingSafeEqual', () => {
  it('accepts identical strings', () => {
    expect(timingSafeEqual('secret', 'secret')).toBe(true)
  })

  it('rejects different strings of equal length', () => {
    expect(timingSafeEqual('secret', 'sekret')).toBe(false)
  })

  it('rejects different lengths without throwing', () => {
    expect(timingSafeEqual('ab', 'abc')).toBe(false)
    expect(timingSafeEqual('', 'x')).toBe(false)
  })
})

describe('session token', () => {
  it('derives a stable hex digest for a password', async () => {
    const a = await deriveSessionToken('test-password')
    const b = await deriveSessionToken('test-password')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the password changes', async () => {
    const a = await deriveSessionToken('one')
    const b = await deriveSessionToken('two')
    expect(a).not.toBe(b)
  })

  it('validates only the matching token', async () => {
    const token = await deriveSessionToken('gate')
    expect(await isValidSessionToken(token, 'gate')).toBe(true)
    expect(await isValidSessionToken(token, 'wrong')).toBe(false)
    expect(await isValidSessionToken(undefined, 'gate')).toBe(false)
    expect(await isValidSessionToken('', 'gate')).toBe(false)
  })
})

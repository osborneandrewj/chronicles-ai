import { describe, expect, it } from 'vitest'

import { buildTtsRequestBody, resolveSpeed } from '../src/lib/tts'

describe('buildTtsRequestBody', () => {
  it('builds the base body with no speed field when speed is undefined', () => {
    const body = buildTtsRequestBody('Hello there.', 'eve', undefined)
    expect(body).toEqual({
      text: 'Hello there.',
      voice_id: 'eve',
      language: 'auto',
      output_format: { codec: 'mp3' },
    })
    expect('speed' in body).toBe(false)
  })

  it('includes speed when provided', () => {
    const body = buildTtsRequestBody('Hello.', 'ara', 1.1)
    expect(body.speed).toBe(1.1)
    expect(body.voice_id).toBe('ara')
  })
})

describe('resolveSpeed', () => {
  it('returns undefined for unset / empty env', () => {
    expect(resolveSpeed(undefined)).toBeUndefined()
    expect(resolveSpeed('')).toBeUndefined()
  })

  it('parses a valid speed within xAI range 0.7–1.5', () => {
    expect(resolveSpeed('1.0')).toBe(1.0)
    expect(resolveSpeed('0.7')).toBe(0.7)
    expect(resolveSpeed('1.5')).toBe(1.5)
  })

  it('rejects out-of-range or non-numeric values (returns undefined, no body field)', () => {
    expect(resolveSpeed('0.5')).toBeUndefined()
    expect(resolveSpeed('2.0')).toBeUndefined()
    expect(resolveSpeed('fast')).toBeUndefined()
  })
})

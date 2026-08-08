import { describe, expect, it } from 'vitest'

import {
  buildTtsRequestBody,
  resolveSpeed,
  resolveStreamingLatency,
} from '../src/lib/tts'

describe('buildTtsRequestBody', () => {
  it('builds the base body with default streaming latency and no speed when unset', () => {
    const body = buildTtsRequestBody('Hello there.', 'eve', undefined)
    expect(body).toEqual({
      text: 'Hello there.',
      voice_id: 'eve',
      language: 'auto',
      output_format: { codec: 'mp3' },
      optimize_streaming_latency: 1,
    })
    expect('speed' in body).toBe(false)
  })

  it('includes speed when provided', () => {
    const body = buildTtsRequestBody('Hello.', 'ara', 1.1)
    expect(body.speed).toBe(1.1)
    expect(body.voice_id).toBe('ara')
  })

  it('omits optimize_streaming_latency when explicitly set to 0 (quality mode)', () => {
    const body = buildTtsRequestBody('Hello.', 'eve', undefined, 0)
    expect('optimize_streaming_latency' in body).toBe(false)
  })

  it('includes optimize_streaming_latency when set to 2', () => {
    const body = buildTtsRequestBody('Hello.', 'eve', undefined, 2)
    expect(body.optimize_streaming_latency).toBe(2)
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

describe('resolveStreamingLatency', () => {
  it('defaults to 1 when unset or empty', () => {
    expect(resolveStreamingLatency(undefined)).toBe(1)
    expect(resolveStreamingLatency('')).toBe(1)
  })

  it('accepts 0–2', () => {
    expect(resolveStreamingLatency('0')).toBe(0)
    expect(resolveStreamingLatency('1')).toBe(1)
    expect(resolveStreamingLatency('2')).toBe(2)
  })

  it('falls back to 1 for invalid values', () => {
    expect(resolveStreamingLatency('3')).toBe(1)
    expect(resolveStreamingLatency('fast')).toBe(1)
  })
})

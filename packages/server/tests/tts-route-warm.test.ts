import { describe, expect, it } from 'vitest'

import { POST } from '../src/app/api/tts/route'

describe('POST /api/tts?warm=1', () => {
  it('returns 204 with no body and does not require a request body', async () => {
    const res = await POST(new Request('http://localhost/api/tts?warm=1', { method: 'POST' }))
    expect(res.status).toBe(204)
    const text = await res.text()
    expect(text).toBe('')
  })

  it('does not warm on a normal request (missing text still 400, not 204)', async () => {
    const res = await POST(
      new Request('http://localhost/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })
})

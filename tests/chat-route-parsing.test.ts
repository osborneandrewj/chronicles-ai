import { beforeAll, describe, expect, it } from 'vitest'

import { POST } from '@/app/api/chat/route'
import { createWorld } from '@/lib/worlds'

// These tests exercise the request-validation layer of POST /api/chat. They
// stay on the 400/404 paths so no LLM call ever fires — the moment the route
// reaches classifyAction or streamText, real network I/O would start. Valid-
// body smoke testing is handled by the manual exit criteria in the milestone.

const ENDPOINT = 'http://localhost/api/chat'

function buildRequest(worldId: number | string, body: BodyInit): Request {
  return new Request(`${ENDPOINT}?worldId=${worldId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

describe('POST /api/chat — request parsing', () => {
  let worldId: number

  beforeAll(() => {
    worldId = createWorld({
      name: `chat-parsing-${Math.random()}`,
      premise: 'A coastal village in autumn 1897.',
      initialState: {
        time: 'Late afternoon',
        location: 'Mevagissey harbour, Cornwall',
        identity: 'Travel-worn letter-writer.',
        playerName: 'Edith',
      },
    }).id
  })

  it('rejects a missing worldId with 400 (no JSON parse attempted)', async () => {
    const req = new Request(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"messages":[]}',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects an unknown worldId with 404', async () => {
    const res = await POST(buildRequest(999_999, '{"messages":[]}'))
    expect(res.status).toBe(404)
  })

  it('rejects malformed JSON with 400, not 500', async () => {
    const res = await POST(buildRequest(worldId, 'not json'))
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Invalid JSON')
  })

  it('rejects an empty object body with 400 (missing `messages`)', async () => {
    const res = await POST(buildRequest(worldId, '{}'))
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Invalid request body')
  })

  it('rejects a body whose messages is not an array with 400', async () => {
    const res = await POST(buildRequest(worldId, '{"messages":"oops"}'))
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Invalid request body')
  })

  it('rejects an empty messages array with 400', async () => {
    const res = await POST(buildRequest(worldId, '{"messages":[]}'))
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Invalid request body')
  })

  it('rejects messages whose last entry has no text parts with 400', async () => {
    const body = JSON.stringify({
      messages: [
        { role: 'user', parts: [{ type: 'image', url: 'http://example.com/x.png' }] },
      ],
    })
    const res = await POST(buildRequest(worldId, body))
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Empty player action')
  })

  it('ignores non-text parts and accepts the text content of the last user message', async () => {
    // The last message has a non-text part followed by a text part; only the
    // text contributes to extractText. The route then proceeds past the empty-
    // text guard and into the meta-command branch (since `/help` is meta), so
    // we get a 200 without ever hitting the LLM.
    const body = JSON.stringify({
      messages: [
        {
          role: 'user',
          parts: [
            { type: 'image', url: 'http://example.com/x.png' },
            { type: 'text', text: '/help' },
          ],
        },
      ],
    })
    const res = await POST(buildRequest(worldId, body))
    expect(res.status).toBe(200)
  })
})

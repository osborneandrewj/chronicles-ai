import { describe, expect, it } from 'vitest'

import { loadPrompt } from '@/lib/prompt-files'

describe('prompt content guards', () => {
  it('narrator prompt carries the historical-fidelity rule', () => {
    const p = loadPrompt('narrator-system').toLowerCase()
    expect(p).toContain('historical')
    expect(p).toContain('era-appropriate')
  })

  it('npc-agent prompt carries the historical-fidelity rule', () => {
    const p = loadPrompt('npc-agent-system').toLowerCase()
    expect(p).toContain('era-appropriate')
  })
})

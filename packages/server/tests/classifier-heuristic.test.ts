import { describe, expect, it } from 'vitest'

import { classifyAction } from '@/lib/classifier'

describe('classifyAction heuristic path', () => {
  it('classifies obvious physical actions without an LLM call', async () => {
    const result = await classifyAction('I open my texts')

    expect(result).toMatchObject({
      stance: 'do',
      input_mode: 'in-character',
      method: 'heuristic',
      model: 'rule-based-classifier',
    })
    expect(result.usage).toBeUndefined()
  })

  it('treats bare questions as speech when an NPC is present', async () => {
    const result = await classifyAction('What is your name?', 'PRESENT NPCS: Diane')

    expect(result).toMatchObject({
      stance: 'say',
      input_mode: 'in-character',
      method: 'heuristic',
    })
  })

  it('classifies explicit OOC/system questions locally', async () => {
    const result = await classifyAction('(ooc) what model are you?')

    expect(result).toMatchObject({
      stance: 'meta',
      input_mode: 'ooc',
      method: 'heuristic',
    })
  })
})

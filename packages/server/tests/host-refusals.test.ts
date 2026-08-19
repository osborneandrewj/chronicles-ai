import { describe, expect, it } from 'vitest'

import {
  filterMustStageAgainstRefusals,
  mustStageContradictsRefusal,
  parseRefusals,
} from '@/domain/services/host-refusals'

describe('parseRefusals', () => {
  it('reads a JSON string list and ignores junk', () => {
    expect(parseRefusals('["will not brief during intimacy","will not leave the vault"]')).toEqual([
      'will not brief during intimacy',
      'will not leave the vault',
    ])
    expect(parseRefusals(null)).toEqual([])
    expect(parseRefusals('not-json')).toEqual([])
    expect(parseRefusals('{"no":"array"}')).toEqual([])
  })
})

describe('mustStage vs refusals', () => {
  const jordan = 'Jordan Lacy'
  const refusals = ['will not brief during intimacy', 'will not restate the Hale folder']

  it('drops a mustStage that names the host and reuses a refusal token', () => {
    expect(
      mustStageContradictsRefusal(
        'Jordan briefs the Hale folder from the ops board',
        jordan,
        refusals,
      ),
    ).toBe(true)
    expect(
      mustStageContradictsRefusal('Jordan restates the Hale file', jordan, refusals),
    ).toBe(true)
  })

  it('keeps a mustStage that does not reuse refusal tokens', () => {
    expect(
      mustStageContradictsRefusal(
        'Jordan initiates — they act first; do not wait for the protagonist to prompt them.',
        jordan,
        refusals,
      ),
    ).toBe(false)
    expect(
      mustStageContradictsRefusal('Stay with this beat. Do not introduce a new file.', jordan, refusals),
    ).toBe(false)
  })

  it('does not match a refusal against a different present person', () => {
    const lines = [
      'Lee restates the Hale folder',
      'Jordan initiates — they act first.',
    ]
    expect(
      filterMustStageAgainstRefusals(lines, [
        { name: 'Jordan Lacy', refusals },
        { name: 'Lee Ingram', refusals: [] },
      ]),
    ).toEqual(['Lee restates the Hale folder', 'Jordan initiates — they act first.'])
  })
})

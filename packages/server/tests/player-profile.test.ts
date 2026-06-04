import { describe, expect, it } from 'vitest'

import { organizePlayerProfileFacts } from '@/lib/player-profile'

describe('organizePlayerProfileFacts', () => {
  it('dedupes repeated player facts and groups them by playable continuity', () => {
    const groups = organizePlayerProfileFacts(
      [
        "Carries Elara's silver Gaulish bracelet on his wrist. [t:1]",
        "Carries a silver Gaulish bracelet pressed into his hand by Elara as he left Gaul. [t:2]",
        'Carries a loaded pistol at his hip. [t:3]',
        'Carries a pistol at his hip. [t:4]',
        'Invited Maya to lunch at 1 PM. [t:5]',
        'Committed to Linda Haft that he will deliver the USACE project review by 5 PM Friday. [t:6]',
        "Discovered Latin inscription on the silver bracelet reading 'Return when the Senate falls.' [t:7]",
        "Received a bulk order sample from 'M' with positive feedback on Big Guns USA deodorant quality. [t:8]",
      ].join('\n'),
    )

    expect(groups.map((g) => g.label)).toEqual([
      'Gear',
      'People',
      'Business',
      'Discoveries',
      'Commitments',
    ])
    expect(groups.find((g) => g.label === 'Gear')?.entries.map((e) => e.text)).toEqual([
      'Carries a silver Gaulish bracelet pressed into his hand by Elara as he left Gaul.',
      'Carries a loaded pistol at his hip.',
    ])
    expect(groups.find((g) => g.label === 'People')?.entries[0].text).toContain('Maya')
    expect(groups.find((g) => g.label === 'Work')).toBeUndefined()
    expect(groups.find((g) => g.label === 'Commitments')?.entries[0].text).toContain('Linda Haft')
  })

  it('separates bracelet injury/condition from the bracelet as gear', () => {
    const groups = organizePlayerProfileFacts(
      [
        "Carries Elara's silver Gaulish bracelet on his wrist. [t:1]",
        'Carries a Gaulish silver bracelet that leaves marks on his wrist from exertion. [t:2]',
      ].join('\n'),
    )

    expect(groups.find((g) => g.label === 'Gear')?.entries[0].text).toContain('bracelet on his wrist')
    expect(groups.find((g) => g.label === 'Condition')?.entries[0].text).toContain('leaves marks')
  })
})

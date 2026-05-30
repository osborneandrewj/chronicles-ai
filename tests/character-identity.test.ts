import { describe, expect, it } from 'vitest'

import { isDescriptorName, nameKey } from '@/lib/character-identity'

describe('isDescriptorName', () => {
  it('flags article-led descriptor/title placeholders', () => {
    expect(isDescriptorName('The Attendant at the Gates')).toBe(true)
    expect(isDescriptorName('the bartender')).toBe(true)
    expect(isDescriptorName('A Man in a High-Vis Vest')).toBe(true)
  })

  it('does not flag proper names or mononyms', () => {
    expect(isDescriptorName('Jérôme Moreau')).toBe(false)
    expect(isDescriptorName('Marcus')).toBe(false)
    expect(isDescriptorName('')).toBe(false)
  })
})

describe('nameKey', () => {
  it('normalizes articles/punctuation/case for comparison', () => {
    expect(nameKey('The Anchor, Tavern')).toBe('anchor tavern')
    expect(nameKey('Jérôme Moreau')).toBe('jérôme moreau')
  })
})

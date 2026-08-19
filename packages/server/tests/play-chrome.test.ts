import { describe, expect, it } from 'vitest'

import { playLayerLabel, returnToParkLabel } from '@/components/play/chrome'

describe('play chrome labels', () => {
  it('drops Animus and text-adventure type labels', () => {
    expect(playLayerLabel('hub')).toBeNull()
    expect(playLayerLabel('standalone')).toBeNull()
    expect(playLayerLabel('subworld')).toBe('Narrative')
  })

  it('names the park on the facility return', () => {
    expect(returnToParkLabel('Project THRESHOLD')).toBe('Return to Project THRESHOLD')
    expect(returnToParkLabel('  ')).toBe('Return to the park')
    expect(returnToParkLabel(null)).toBe('Return to the park')
  })
})

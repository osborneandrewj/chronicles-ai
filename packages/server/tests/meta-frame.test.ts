import { describe, expect, it } from 'vitest'

import { PRESET_LIST } from '@/infrastructure/world-gen/genre-presets/presets'
import {
  DEFAULT_META_FRAME_KIND,
  resolveMetaFrameKind,
  usesSimulationFrame,
} from '@/domain/services/meta-frame'

// Genre-coupling audit, Phase 1: the simulation meta-frame is opt-in, never the
// default for a genre.
describe('meta-frame policy', () => {
  it('defaults an absent kind to grounded', () => {
    expect(DEFAULT_META_FRAME_KIND).toBe('grounded')
    expect(resolveMetaFrameKind(undefined)).toBe('grounded')
    expect(resolveMetaFrameKind(null)).toBe('grounded')
  })

  it('treats only the simulation kind as using the concealed-simulation machinery', () => {
    expect(usesSimulationFrame('simulation')).toBe(true)
    expect(usesSimulationFrame('grounded')).toBe(false)
    expect(usesSimulationFrame('supernatural')).toBe(false)
    expect(usesSimulationFrame('noir')).toBe(false)
    expect(usesSimulationFrame(undefined)).toBe(false)
  })
})

describe('shipped genre presets', () => {
  it('are all grounded — no historical setting triggers the simulation meta-frame', () => {
    for (const preset of PRESET_LIST) {
      expect(
        usesSimulationFrame(preset.metaFrameKind),
        `${preset.id} must not opt into the simulation meta-frame`,
      ).toBe(false)
    }
  })
})

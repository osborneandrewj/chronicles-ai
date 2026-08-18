import { describe, expect, it } from 'vitest'

import { effectiveUiSkin, isUiSkin, resolveUiSkin } from '@/domain/services/ui-skin'

describe('resolveUiSkin', () => {
  it('lets an explicit pick win', () => {
    expect(resolveUiSkin({ explicit: 'signal', genreTags: ['medieval'] })).toBe('signal')
    expect(resolveUiSkin({ explicit: 'relic', genreTags: ['cyberpunk'] })).toBe('relic')
  })

  it('lets an Animus aesthetic win when no explicit skin is set', () => {
    expect(resolveUiSkin({ aesthetic: 'signal', genreTags: ['roman'] })).toBe('signal')
    expect(resolveUiSkin({ aesthetic: 'relic' })).toBe('relic')
  })

  it('maps sci-fi and modern genre labels to signal', () => {
    expect(resolveUiSkin({ genreTags: ['Science Fiction'] })).toBe('signal')
    expect(resolveUiSkin({ genreTags: ['Cyberpunk'] })).toBe('signal')
    expect(resolveUiSkin({ genreTags: ['Noir'] })).toBe('signal')
    expect(resolveUiSkin({ genreTags: ['Military Sci-Fi'] })).toBe('signal')
    expect(resolveUiSkin({ genreTags: ['sci-fi', 'space'] })).toBe('signal')
  })

  it('maps historical and fantasy tags to relic', () => {
    expect(resolveUiSkin({ genreTags: ['High Fantasy'] })).toBe('relic')
    expect(resolveUiSkin({ genreTags: ['roman', 'ancient'] })).toBe('relic')
    expect(resolveUiSkin({ genreTags: ['Historical Adventure'] })).toBe('relic')
    expect(resolveUiSkin({ genreTags: ['medieval-english'] })).toBe('relic')
  })

  it('defaults untagged worlds to relic', () => {
    expect(resolveUiSkin({})).toBe('relic')
    expect(resolveUiSkin({ genreTags: [] })).toBe('relic')
    expect(resolveUiSkin({ genreTags: ['unrecognized-tag'] })).toBe('relic')
  })
})

describe('effectiveUiSkin', () => {
  it('forces signal on an Animus hub, even if a relic column was stored', () => {
    expect(effectiveUiSkin('relic', ['medieval'], 'hub')).toBe('signal')
    expect(effectiveUiSkin(null, ['High Fantasy'], 'hub')).toBe('signal')
  })

  it('paints a first life from its genre, not the stored hub look', () => {
    expect(effectiveUiSkin('signal', ['roman', 'ancient'], 'subworld')).toBe('relic')
    expect(effectiveUiSkin('relic', ['Cyberpunk'], 'subworld')).toBe('signal')
  })

  it('uses the stored column for a standalone custom world', () => {
    expect(effectiveUiSkin('signal', ['medieval'], 'standalone')).toBe('signal')
  })

  it('infers from genre tags when the column is null', () => {
    expect(effectiveUiSkin(null, ['Cyberpunk'])).toBe('signal')
    expect(effectiveUiSkin(undefined, ['High Fantasy'])).toBe('relic')
  })
})

describe('isUiSkin', () => {
  it('accepts only the two stored values', () => {
    expect(isUiSkin('signal')).toBe(true)
    expect(isUiSkin('relic')).toBe(true)
    expect(isUiSkin('dark')).toBe(false)
    expect(isUiSkin(null)).toBe(false)
  })
})

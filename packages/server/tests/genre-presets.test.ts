import { describe, expect, it } from 'vitest'

import {
  GENRE_PRESETS,
  getGenrePreset,
  listGenrePresets,
} from '@/infrastructure/world-gen/genre-presets/index'

describe('genre-preset registry', () => {
  it('contains at least 20 presets', () => {
    expect(GENRE_PRESETS.size).toBeGreaterThanOrEqual(20)
  })

  it('every preset has a non-empty id, label, hiddenPremise, and at least one eraTag', () => {
    for (const [, preset] of GENRE_PRESETS) {
      expect(preset.id.trim(), `id empty for ${preset.label}`).toBeTruthy()
      expect(preset.label.trim(), `label empty for ${preset.id}`).toBeTruthy()
      expect(
        preset.hiddenPremise.trim(),
        `hiddenPremise empty for ${preset.id}`,
      ).toBeTruthy()
      expect(
        preset.eraTags.length,
        `eraTags empty for ${preset.id}`,
      ).toBeGreaterThanOrEqual(1)
    }
  })

  it('all ids are unique', () => {
    const ids = [...GENRE_PRESETS.keys()]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all ids are kebab-case (lowercase letters, digits, hyphens only)', () => {
    for (const id of GENRE_PRESETS.keys()) {
      expect(id, `id '${id}' is not kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('listGenrePresets() returns only id and label — no hiddenPremise key', () => {
    const items = listGenrePresets()
    expect(items.length).toBeGreaterThanOrEqual(20)
    for (const item of items) {
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('label')
      // The concealment guarantee: hiddenPremise must NOT appear on the returned object
      expect(item).not.toHaveProperty('hiddenPremise')
      expect(item).not.toHaveProperty('eraTags')
      expect(item).not.toHaveProperty('toneTags')
    }
  })

  it('listGenrePresets() count matches GENRE_PRESETS size', () => {
    expect(listGenrePresets().length).toBe(GENRE_PRESETS.size)
  })

  it('getGenrePreset round-trips a known id and returns the full preset', () => {
    const known = getGenrePreset('ancient-rome')
    expect(known).toBeDefined()
    expect(known?.id).toBe('ancient-rome')
    expect(known?.label).toBe('Ancient Rome')
    expect(known?.hiddenPremise.length).toBeGreaterThan(0)
    expect(known?.eraTags).toContain('roman')
  })

  it('getGenrePreset returns undefined for an unknown id', () => {
    expect(getGenrePreset('does-not-exist')).toBeUndefined()
    expect(getGenrePreset('')).toBeUndefined()
  })

  it('all presets have at least one toneTags entry', () => {
    for (const [, preset] of GENRE_PRESETS) {
      expect(
        preset.toneTags.length,
        `toneTags empty for ${preset.id}`,
      ).toBeGreaterThanOrEqual(1)
    }
  })
})

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { buildGroups, buildHooks, densityForCount, hashSeed, inferPlaceProfile, mulberry32, resolveTemplates } from '@/lib/place-population'
import type { StoryThread } from '@/lib/db'
import {
  db,
  getLatestOccupancySnapshotRow,
  getPopulationTemplatesForKind,
  insertOccupancySnapshot,
} from '@/lib/db'
import { runMigrations } from '@/lib/migrations'
import { createWorld } from '@/lib/worlds'

function freshWorld(): number {
  return createWorld({
    name: `Pop-${Math.random()}`,
    premise: 'A quiet town with secrets.',
    initialState: {
      time: 'Day 1, 20:00',
      location: 'The Anchor Tavern',
      identity: 'A traveler.',
      playerName: 'Wren',
    },
  }).id
}

describe('migration v22 — place population schema', () => {
  it('creates the three tables, the threads tag column, and passes FK check', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(22)

    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all() as Array<{ name: string }>).map((r) => r.name)
    expect(tables).toContain('place_profiles')
    expect(tables).toContain('population_templates')
    expect(tables).toContain('place_occupancy_snapshots')

    const threadCols = (db.prepare('PRAGMA table_info(story_threads)').all() as Array<{
      name: string
    }>).map((c) => c.name)
    expect(threadCols).toContain('relevance_tags_json')

    expect((db.pragma('foreign_key_check') as unknown[]).length).toBe(0)
    db.close()
  })
})

describe('occupancy snapshot persistence', () => {
  it('round-trips a snapshot row as JSON', () => {
    const worldId = freshWorld()
    const placeId = (db.prepare(
      "SELECT id FROM places WHERE world_id = ? LIMIT 1",
    ).get(worldId) as { id: number }).id

    insertOccupancySnapshot({
      worldId,
      placeId,
      sceneId: null,
      sourceTurnId: null,
      worldTime: 'Day 1, 20:00',
      occupancyJson: '{"density":"busy","seed":"abc","groups":[],"traffic":null,"encounter_hooks":[]}',
    })

    const row = getLatestOccupancySnapshotRow(worldId, placeId)
    expect(row).not.toBeNull()
    expect(JSON.parse(row!.occupancy_json).density).toBe('busy')
  })

  it('returns empty array when no population_templates exist for the world', () => {
    const worldId = freshWorld()
    expect(getPopulationTemplatesForKind(worldId, 'bar')).toEqual([])
  })
})

describe('deterministic PRNG', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(hashSeed('world:1|place:2|scene:3'))
    const b = mulberry32(hashSeed('world:1|place:2|scene:3'))
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('produces a different sequence for a different seed', () => {
    const a = mulberry32(hashSeed('world:1|place:2|scene:3'))
    const b = mulberry32(hashSeed('world:1|place:2|scene:4'))
    expect(a()).not.toEqual(b())
  })

  it('produces a known first value for a fixed seed (regression guard)', () => {
    const rng = mulberry32(hashSeed('world:1|place:2|scene:3'))
    expect(rng()).toBeCloseTo(0.9102079933509231, 6)
  })
})

describe('profile inference', () => {
  it('infers a bar profile from kind', () => {
    const p = inferPlaceProfile({ name: 'The Anchor', kind: 'bar' })
    expect(p.profileKind).toBe('bar')
    expect(p.matchTags).toContain('bar')
    expect(p.capacityMax).toBeGreaterThan(p.capacityMin)
  })

  it('infers a road profile from name keywords when kind is null', () => {
    const p = inferPlaceProfile({ name: 'Highway 7 shoulder', kind: null })
    expect(p.profileKind).toBe('road')
    expect(p.trafficLevel).not.toBe('none')
  })

  it('falls back to generic for unrecognized places', () => {
    const p = inferPlaceProfile({ name: 'A featureless void', kind: null })
    expect(p.profileKind).toBe('generic')
  })
})

describe('group selection', () => {
  it('respects capacity bounds and caps group count at 6', () => {
    const profile = inferPlaceProfile({ name: 'The Anchor', kind: 'bar' })
    const templates = resolveTemplates([], profile.profileKind)
    const rng = mulberry32(hashSeed('seed-A'))
    const { groups } = buildGroups(profile, templates, rng)
    const total = groups.reduce((n, g) => n + g.count, 0)
    expect(total).toBeLessThanOrEqual(profile.capacityMax)
    expect(groups.length).toBeLessThanOrEqual(6)
    expect(groups.every((g) => g.count >= 1)).toBe(true)
  })

  it('is stable for the same seed', () => {
    const profile = inferPlaceProfile({ name: 'The Anchor', kind: 'bar' })
    const templates = resolveTemplates([], profile.profileKind)
    const first = buildGroups(profile, templates, mulberry32(hashSeed('seed-B'))).groups
    const second = buildGroups(profile, templates, mulberry32(hashSeed('seed-B'))).groups
    expect(second).toEqual(first)
  })

  it('maps counts to a density band', () => {
    expect(densityForCount(0, 12)).toBe('empty')
    expect(densityForCount(1, 12)).toBe('sparse')
    expect(densityForCount(3, 12)).toBe('moderate')
    expect(densityForCount(7, 12)).toBe('busy')
    expect(densityForCount(11, 12)).toBe('packed')
  })

  it('returns empty groups when traffic target is 0', () => {
    const base = inferPlaceProfile({ name: 'Desolate Road', kind: 'road' })
    const profile = { ...base, trafficLevel: 'none' as const }
    const { groups, total } = buildGroups(profile, resolveTemplates([], 'road'), mulberry32(hashSeed('x')))
    expect(groups).toEqual([])
    expect(total).toBe(0)
  })
})

function thread(partial: Partial<StoryThread>): StoryThread {
  return {
    id: 1, world_id: 1, title: 'T', kind: 'mystery', status: 'active',
    summary: null, stakes: null, rewards: null, consequences: null, hidden: null,
    relevance_tags_json: '[]', source_turn_id: null, resolved_turn_id: null,
    created_at: '', updated_at: '', ...partial,
  }
}

describe('hook matching', () => {
  it('emits a continuation hook when a thread tag overlaps the place', () => {
    const profile = inferPlaceProfile({ name: 'The Anchor', kind: 'bar' })
    const templates = resolveTemplates([], profile.profileKind)
    const rng = mulberry32(hashSeed('hooks-A'))
    const { groups, sources } = buildGroups(profile, templates, rng)
    const threads = [thread({ id: 42, title: 'The missing courier', relevance_tags_json: '["bar","rumor"]' })]
    const hooks = buildHooks(profile, groups, sources, threads, rng)
    const cont = hooks.find((h) => h.kind === 'continuation')
    expect(cont).toBeDefined()
    expect(cont!.thread_id).toBe(42)
    expect(cont!.thread_ref).toBe('The missing courier')
  })

  it('emits a seed hook when no thread overlaps but a promotable carrier exists', () => {
    const profile = inferPlaceProfile({ name: 'The Anchor', kind: 'bar' })
    const templates = resolveTemplates([], profile.profileKind)
    const rng = mulberry32(hashSeed('hooks-B'))
    const { groups, sources } = buildGroups(profile, templates, rng)
    const hooks = buildHooks(profile, groups, sources, [], rng)
    expect(hooks.some((h) => h.kind === 'seed')).toBe(true)
    expect(hooks.length).toBeLessThanOrEqual(3)
  })

  it('does not exceed 3 hooks total', () => {
    const profile = inferPlaceProfile({ name: 'The Anchor', kind: 'bar' })
    const templates = resolveTemplates([], profile.profileKind)
    const rng = mulberry32(hashSeed('hooks-C'))
    const { groups, sources } = buildGroups(profile, templates, rng)
    const threads = Array.from({ length: 6 }, (_, i) =>
      thread({ id: 100 + i, title: `Thread ${i}`, relevance_tags_json: '["bar","social","rumor"]' }),
    )
    const hooks = buildHooks(profile, groups, sources, threads, rng)
    expect(hooks.length).toBeLessThanOrEqual(3)
  })
})

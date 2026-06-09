import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { buildGroups, buildHooks, buildPlaceOccupancySnapshot, classifyPlaceKind, densityForCount, hashSeed, inferPlaceProfile, mulberry32, resolveTemplates } from '@/lib/place-population'
import { applyArchivistPatch } from '@/lib/archivist'
import type { StoryThread } from '@/lib/db'
import {
  db,
  getLatestOccupancySnapshotRow,
  getPlaceProfileRow,
  getPlacesForWorld,
  getPopulationTemplatesForKind,
  getStoryDossierForWorld,
  insertOccupancySnapshot,
} from '@/lib/db'
import { runMigrations } from '@/lib/migrations'
import { formatStateBlock, getNarratorWorldState } from '@/lib/world-state'
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

describe('classifyPlaceKind', () => {
  it('returns the profile kind when a keyword matches', () => {
    expect(classifyPlaceKind('The Anchor Tavern')).toBe('bar')
    expect(classifyPlaceKind('Gare de Lyon station')).toBe('transit')
    expect(classifyPlaceKind('a narrow service alley')).toBe('road')
    expect(classifyPlaceKind('the morning market')).toBe('market')
  })

  it('returns null when no keyword matches', () => {
    expect(classifyPlaceKind('Paris')).toBeNull()
    expect(classifyPlaceKind('Mevagissey harbour')).toBeNull()
  })
})

describe('createWorld place kind (C1)', () => {
  it('classifies a keyworded location into places.kind', () => {
    const id = createWorld({
      name: `KindA-${Math.random()}`,
      premise: 'x',
      initialState: { time: 't', location: 'The Brass Lantern Tavern', identity: 'i', playerName: 'P' },
    }).id
    expect(getPlacesForWorld(id)[0].kind).toBe('bar')
  })

  it('leaves kind null for a bare city location', () => {
    const id = createWorld({
      name: `KindB-${Math.random()}`,
      premise: 'x',
      initialState: { time: 't', location: 'Paris', identity: 'i', playerName: 'P' },
    }).id
    expect(getPlacesForWorld(id)[0].kind).toBeNull()
  })
})

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

  it('filters out threads whose tags do not overlap (empty tags)', () => {
    const profile = inferPlaceProfile({ name: 'The Anchor', kind: 'bar' })
    const templates = resolveTemplates([], profile.profileKind)
    const rng = mulberry32(hashSeed('hooks-empty'))
    const { groups, sources } = buildGroups(profile, templates, rng)
    const threads = [thread({ id: 7, title: 'Unrelated', relevance_tags_json: '[]' })]
    const hooks = buildHooks(profile, groups, sources, threads, rng)
    expect(hooks.some((h) => h.kind === 'continuation')).toBe(false)
  })

  it('emits a place-level continuation hook (occupant_id null) when no promotable occupants exist', () => {
    const profile = inferPlaceProfile({ name: 'Highway 7 shoulder', kind: 'road' })
    const templates = resolveTemplates([], profile.profileKind)
    const rng = mulberry32(hashSeed('hooks-road'))
    const { groups, sources } = buildGroups(profile, templates, rng)
    const threads = [thread({ id: 9, title: 'The tail car', relevance_tags_json: '["road","travel"]' })]
    const hooks = buildHooks(profile, groups, sources, threads, rng)
    const cont = hooks.find((h) => h.kind === 'continuation')
    expect(cont).toBeDefined()
    expect(cont!.occupant_id).toBeNull()
  })

  it('marks strength strong at overlap>=2 and ambient at overlap 1', () => {
    const profile = inferPlaceProfile({ name: 'The Anchor', kind: 'bar' })
    const templates = resolveTemplates([], profile.profileKind)
    const ambientRng = mulberry32(hashSeed('hooks-ambient'))
    const amb = buildGroups(profile, templates, ambientRng)
    const ambientHooks = buildHooks(
      profile, amb.groups, amb.sources,
      [thread({ id: 11, title: 'Nightlife rumor', relevance_tags_json: '["nightlife"]' })],
      ambientRng,
    )
    expect(ambientHooks.find((h) => h.kind === 'continuation')!.strength).toBe('ambient')

    const strongRng = mulberry32(hashSeed('hooks-strong'))
    const str = buildGroups(profile, templates, strongRng)
    const strongHooks = buildHooks(
      profile, str.groups, str.sources,
      [thread({ id: 12, title: 'Bar rumor', relevance_tags_json: '["bar","rumor"]' })],
      strongRng,
    )
    expect(strongHooks.find((h) => h.kind === 'continuation')!.strength).toBe('strong')
  })
})

function seedScene(worldId: number, placeName: string, kind: string): { placeId: number } {
  const placeId = (db.prepare(
    'INSERT INTO places (world_id, name, kind) VALUES (?, ?, ?) RETURNING id',
  ).get(worldId, placeName, kind) as { id: number }).id
  const nextNumber =
    (db.prepare(
      'SELECT COALESCE(MAX(scene_number), 0) AS m FROM scenes WHERE world_id = ?',
    ).get(worldId) as { m: number }).m + 1
  const sceneId = (db.prepare(
    "INSERT INTO scenes (world_id, place_id, title, scene_number, status) VALUES (?, ?, 'Scene', ?, 'active') RETURNING id",
  ).get(worldId, placeId, nextNumber) as { id: number }).id
  db.prepare('UPDATE worlds SET current_scene_id = ?, world_time = ? WHERE id = ?').run(
    sceneId, 'Day 1, 20:00', worldId,
  )
  return { placeId }
}

describe('buildPlaceOccupancySnapshot', () => {
  it('builds, persists, and returns occupancy for the active place', () => {
    const worldId = freshWorld()
    const { placeId } = seedScene(worldId, 'The Lantern Room', 'bar')
    const occ = buildPlaceOccupancySnapshot(worldId, null)
    expect(occ).not.toBeNull()
    expect(occ!.groups.length).toBeGreaterThan(0)
    expect(getLatestOccupancySnapshotRow(worldId, placeId)).not.toBeNull()
  })

  it('reuses the snapshot while in the same scene rather than re-rolling', () => {
    const worldId = freshWorld()
    seedScene(worldId, 'The Lantern Room', 'bar')
    const first = buildPlaceOccupancySnapshot(worldId, null)
    const second = buildPlaceOccupancySnapshot(worldId, null)
    expect(second).toEqual(first)
    const count = db.prepare(
      'SELECT COUNT(*) AS n FROM place_occupancy_snapshots WHERE world_id = ?',
    ).get(worldId) as { n: number }
    expect(count.n).toBe(1)
  })

  it('returns null when the active scene has no linked place', () => {
    const worldId = freshWorld()
    db.prepare(
      "INSERT INTO scenes (world_id, place_id, title, scene_number, status) VALUES (?, NULL, 'Void', 999, 'active')",
    ).run(worldId)
    expect(buildPlaceOccupancySnapshot(worldId, null)).toBeNull()
  })

  it('returns null when there is no active scene/place', () => {
    const worldId = freshWorld()
    db.prepare("UPDATE scenes SET status = 'completed' WHERE world_id = ?").run(worldId)
    expect(buildPlaceOccupancySnapshot(worldId, null)).toBeNull()
  })

  it('persists an inferred place profile on first build', () => {
    const worldId = freshWorld()
    const { placeId } = seedScene(worldId, 'The Lantern Room', 'bar')
    buildPlaceOccupancySnapshot(worldId, null)
    const row = getPlaceProfileRow(worldId, placeId)
    expect(row).not.toBeNull()
    expect(row!.profile_kind).toBe('bar')
  })

  it('respects a pre-existing stored profile over inference', () => {
    const worldId = freshWorld()
    const { placeId } = seedScene(worldId, 'The Lantern Room', 'bar')
    // Pre-store a profile that yields an empty room (traffic none, capacity 0),
    // which inference for a bar would never produce.
    db.prepare(
      `INSERT INTO place_profiles (world_id, place_id, profile_kind, capacity_min, capacity_max, traffic_level, match_tags_json, typical_roles_json)
       VALUES (?, ?, 'bar', 0, 0, 'none', '[]', '[]')`,
    ).run(worldId, placeId)
    const occ = buildPlaceOccupancySnapshot(worldId, null)
    expect(occ).not.toBeNull()
    expect(occ!.groups.length).toBe(0)
  })
})

describe('occupancy in the narrator state block', () => {
  it('renders a compact occupancy section with density, groups, and hooks', () => {
    const worldId = freshWorld()
    seedScene(worldId, 'The Lantern Room', 'bar')
    db.prepare(
      "INSERT INTO story_threads (world_id, title, kind, status, relevance_tags_json) VALUES (?, 'The missing courier', 'quest', 'active', '[\"bar\",\"rumor\"]')",
    ).run(worldId)

    buildPlaceOccupancySnapshot(worldId, null)
    const state = getNarratorWorldState(worldId)
    const block = formatStateBlock(state)

    expect(block).toContain('### NEARBY (ambient — not durable characters)')
    expect(block).toContain('density:')
    expect(block).toContain('possible encounters (latent')
  })

  it('omits the occupancy section when there is no snapshot', () => {
    const worldId = freshWorld()
    const state = getNarratorWorldState(worldId)
    expect(formatStateBlock(state)).not.toContain('### NEARBY')
  })
})

describe('archivist relevance tags', () => {
  it('persists relevance_tags on a thread and exposes them on the dossier', async () => {
    const worldId = freshWorld()
    const turnId = (db.prepare(
      "INSERT INTO turns (world_id, role, content) VALUES (?, 'assistant', 'x') RETURNING id",
    ).get(worldId) as { id: number }).id

    await applyArchivistPatch(worldId, turnId, {
      story_threads: [
        {
          title: 'The missing courier',
          kind: 'quest',
          relevance_tags: ['bar', 'rumor', 'courier'],
        },
      ],
    })

    const threads = getStoryDossierForWorld(worldId).threads
    const t = threads.find((x) => x.title === 'The missing courier')
    expect(t).toBeDefined()
    expect(JSON.parse(t!.relevance_tags_json)).toEqual(['bar', 'rumor', 'courier'])
  })

  it('overwrites relevance_tags when an existing thread is updated with new tags', async () => {
    const worldId = freshWorld()
    const turnId = (db.prepare(
      "INSERT INTO turns (world_id, role, content) VALUES (?, 'assistant', 'x') RETURNING id",
    ).get(worldId) as { id: number }).id
    await applyArchivistPatch(worldId, turnId, {
      story_threads: [{ title: 'Thread A', kind: 'quest', relevance_tags: ['bar'] }],
    })
    await applyArchivistPatch(worldId, turnId, {
      story_threads: [{ title: 'Thread A', relevance_tags: ['docks', 'smuggling'] }],
    })
    const t = getStoryDossierForWorld(worldId).threads.find((x) => x.title === 'Thread A')
    expect(JSON.parse(t!.relevance_tags_json)).toEqual(['docks', 'smuggling'])
  })

  it('preserves existing relevance_tags when an update omits them', async () => {
    const worldId = freshWorld()
    const turnId = (db.prepare(
      "INSERT INTO turns (world_id, role, content) VALUES (?, 'assistant', 'x') RETURNING id",
    ).get(worldId) as { id: number }).id
    await applyArchivistPatch(worldId, turnId, {
      story_threads: [{ title: 'Thread B', kind: 'quest', relevance_tags: ['bar', 'rumor'] }],
    })
    await applyArchivistPatch(worldId, turnId, {
      story_threads: [{ title: 'Thread B', summary: 'updated summary' }],
    })
    const t = getStoryDossierForWorld(worldId).threads.find((x) => x.title === 'Thread B')
    expect(JSON.parse(t!.relevance_tags_json)).toEqual(['bar', 'rumor'])
    expect(t!.summary).toBe('updated summary')
  })
})

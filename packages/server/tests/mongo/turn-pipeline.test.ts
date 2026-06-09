import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyArchivistPatch } from '@/application/use-cases/apply-archivist-patch'
import { createWorld } from '@/application/use-cases/create-world'
import { seedBoundedWorld } from '@/application/use-cases/seed-bounded-world'
import { MongoUnitOfWork } from '@/infrastructure/persistence/mongo/mongo-unit-of-work'
import { MongoCharacterRepository } from '@/infrastructure/persistence/mongo/repositories/character-repository.mongo'
import { MongoDossierRepository } from '@/infrastructure/persistence/mongo/repositories/dossier-repository.mongo'
import { MongoDossierWriter } from '@/infrastructure/persistence/mongo/repositories/dossier-writer.mongo'
import { MongoOccupancyRepository } from '@/infrastructure/persistence/mongo/repositories/occupancy-repository.mongo'
import { MongoPlaceConnectionRepository } from '@/infrastructure/persistence/mongo/repositories/place-connection-repository.mongo'
import { MongoPlaceRepository } from '@/infrastructure/persistence/mongo/repositories/place-repository.mongo'
import { MongoRelationshipRepository } from '@/infrastructure/persistence/mongo/repositories/relationship-repository.mongo'
import { MongoReverieRepository } from '@/infrastructure/persistence/mongo/repositories/reverie-repository.mongo'
import { MongoSceneRepository } from '@/infrastructure/persistence/mongo/repositories/scene-repository.mongo'
import { MongoTimelineWriter } from '@/infrastructure/persistence/mongo/repositories/timeline-writer.mongo'
import { MongoTurnRepository } from '@/infrastructure/persistence/mongo/repositories/turn-repository.mongo'
import { MongoWorldRepository } from '@/infrastructure/persistence/mongo/repositories/world-repository.mongo'
import { SystemClock } from '@/infrastructure/clock/system-clock'
import { AuthoredDeckPlanProvider } from '@/infrastructure/world-gen/deck-plan-provider'
import { StubCrewGenerator } from '@/infrastructure/world-gen/stub-crew-generator'
import { getNarratorWorldStateVia } from '@/lib/world-state'

import { replSetAvailable, startReplSet, type ReplSetHandle } from './replset'

// Mongo turn-pipeline e2e harness (P3 cutover). Boots a real MongoMemoryReplSet
// and drives the actual use cases (CreateWorld / SeedBoundedWorld) against the
// Mongo port set, asserting both worlds round-trip through the ports. Each later
// cutover phase un-skips a slice; the final exit criterion (a turn played
// end-to-end on Mongo) is the skipped placeholder at the bottom, un-skipped in
// Phase 5. Guarded behind availability: if the memory server can't run here,
// every test skips (mongo work complete-but-unverified, NEVER gate-passed).

const available = await replSetAvailable()
const d = available ? describe : describe.skip

if (!available) {
  console.warn(
    '[mongo suite] MongoMemoryReplSet unavailable — skipping mongo turn-pipeline tests. ' +
      'The mongo adapter code is complete but UNVERIFIED in this environment.',
  )
}

d('mongo turn pipeline (e2e)', () => {
  let h: ReplSetHandle

  beforeAll(async () => {
    const handle = await startReplSet()
    if (!handle) throw new Error('replica set unexpectedly unavailable')
    h = handle
  }, 120_000)

  afterAll(async () => {
    if (h) await h.stop()
  })

  it('creates an OPEN world via the CreateWorld use case, readable through the ports', async () => {
    const worlds = new MongoWorldRepository(h.ctx)
    const places = new MongoPlaceRepository(h.ctx)
    const characters = new MongoCharacterRepository(h.ctx)

    const { worldId } = await createWorld(
      {
        name: 'Mevagissey 1897',
        premise: 'a Cornish fishing village at the close of the century',
        initialState: {
          time: 'dawn',
          location: 'Mevagissey harbour — Cornwall',
          identity: 'a returning sailor',
        },
      },
      { worlds, extractSettingRegion: async () => null },
    )
    expect(typeof worldId).toBe('number')

    // The world appears in the (non-archived) world list.
    const list = await worlds.listWorlds()
    expect(list.some((w) => w.id === worldId)).toBe(true)

    // The seed place + player character round-trip through the ports.
    const seededPlaces = await places.forWorld(worldId)
    expect(seededPlaces).toHaveLength(1)
    const seededCharacters = await characters.forWorld(worldId)
    expect(seededCharacters.some((c) => c.is_player === 1)).toBe(true)
  })

  it('assembles narrator context from MONGO via getNarratorWorldStateVia (port-driven read)', async () => {
    const worlds = new MongoWorldRepository(h.ctx)
    const scenes = new MongoSceneRepository(h.ctx)
    const places = new MongoPlaceRepository(h.ctx)
    const characters = new MongoCharacterRepository(h.ctx)
    const occupancy = new MongoOccupancyRepository(h.ctx)
    const dossiers = new MongoDossierRepository(h.ctx)

    const { worldId } = await createWorld(
      {
        name: 'Polperro 1901',
        premise: 'a smuggler village waking to the modern age',
        initialState: {
          time: 'dusk',
          location: 'Polperro quay — Cornwall',
          identity: 'a customs officer',
        },
      },
      { worlds, extractSettingRegion: async () => null },
    )

    // The P2 assembler now sources its rows from the injected READ PORTS — here
    // the Mongo port set — so this asserts the assembled context reads MONGO,
    // not SQLite.
    const state = await getNarratorWorldStateVia(
      { worlds, scenes, places, characters, occupancy, dossiers },
      worldId,
    )

    // Active scene + its place come back from Mongo.
    expect(state.currentScene).not.toBeNull()
    expect(state.currentPlace).not.toBeNull()
    const seededPlaces = await places.forWorld(worldId)
    expect(state.currentPlace?.id).toBe(seededPlaces[0]?.id)

    // The seeded player character is present and among the known characters.
    const seededCharacters = await characters.forWorld(worldId)
    expect(state.knownCharacters.map((c) => c.id).sort()).toEqual(
      seededCharacters.map((c) => c.id).sort(),
    )
    expect(state.presentCharacters.some((c) => c.is_player === 1)).toBe(true)
    expect(state.knownPlaces.map((p) => p.id)).toContain(seededPlaces[0]?.id)
  })

  it('seeds a BOUNDED world via SeedBoundedWorld (StubCrewGenerator), readable through the ports', async () => {
    const decks = new AuthoredDeckPlanProvider()
    const worlds = new MongoWorldRepository(h.ctx)
    const places = new MongoPlaceRepository(h.ctx)
    const placeConnections = new MongoPlaceConnectionRepository(h.ctx)
    const characters = new MongoCharacterRepository(h.ctx)
    const relationships = new MongoRelationshipRepository(h.ctx)

    const result = await seedBoundedWorld(
      { templateId: decks.defaultTemplateId(), name: 'Scout Vessel', premise: 'a long survey run' },
      {
        decks,
        crew: new StubCrewGenerator(),
        worlds,
        places,
        placeConnections,
        characters,
        relationships,
        clock: new SystemClock(),
      },
    )
    expect(typeof result.worldId).toBe('number')

    // The bounded world appears in the world list and is flagged bounded.
    const list = await worlds.listWorlds()
    expect(list.some((w) => w.id === result.worldId)).toBe(true)
    const world = await worlds.getWorld(result.worldId)
    expect(world?.spatial_mode).toBe('bounded')

    // Its rooms + crew round-trip through the ports.
    const seededPlaces = await places.forWorld(result.worldId)
    expect(seededPlaces.length).toBe(result.placeIds.length)
    expect(seededPlaces.length).toBeGreaterThan(0)
    const seededCharacters = await characters.forWorld(result.worldId)
    expect(seededCharacters.length).toBe(result.characterIds.length)
    expect(seededCharacters.length).toBeGreaterThan(0)
  })

  it('writes the non-archivist post-stream surface to MONGO and reads it back (P3)', async () => {
    const worlds = new MongoWorldRepository(h.ctx)
    const places = new MongoPlaceRepository(h.ctx)
    const characters = new MongoCharacterRepository(h.ctx)
    const turns = new MongoTurnRepository(h.ctx)
    const reveries = new MongoReverieRepository(h.ctx)
    const occupancy = new MongoOccupancyRepository(h.ctx)

    const { worldId } = await createWorld(
      {
        name: 'Fowey 1899',
        premise: 'a harbour town between the old world and the new',
        initialState: {
          time: 'morning',
          location: 'Fowey waterfront — Cornwall',
          identity: 'a harbourmaster',
        },
      },
      { worlds, extractSettingRegion: async () => null },
    )

    const seededPlaces = await places.forWorld(worldId)
    const placeId = seededPlaces[0]!.id

    // Seed an NPC the appearance-bump pass can act on. createWorld only seeds the
    // player character, so promotion has nothing to count without this.
    const { id: npcId } = await characters.add({
      world_id: worldId,
      name: 'Old Trevithick',
      description: 'a weathered net-mender',
      is_player: 0,
      current_place_id: placeId,
      role: null,
      active_goal: null,
      daily_loop: null,
    })

    // ── TurnRepository.insert (P3 turn write) ──────────────────────────────
    const playerTurn = await turns.insert(worldId, 'user', 'Hail the net-mender.', null)
    const narratorTurn = await turns.insert(
      worldId,
      'assistant',
      'Old Trevithick looks up from his nets.',
      null,
    )
    expect(typeof narratorTurn.id).toBe('number')
    const readTurns = await turns.allForWorld(worldId)
    expect(readTurns.map((t) => t.id)).toContain(narratorTurn.id)
    expect(readTurns.find((t) => t.id === narratorTurn.id)?.role).toBe('assistant')

    // ── ReverieRepository.add + stampFlared (P3 reverie writes) ────────────
    await reveries.add(
      worldId,
      npcId,
      [{ text: 'the storm of ninety-one took my brother', match_tags: ['storm'], intensity: 3 }],
      playerTurn.id,
    )
    const npcReveries = await reveries.forCharacter(npcId)
    expect(npcReveries).toHaveLength(1)
    await reveries.stampFlared([npcReveries[0]!.id], narratorTurn.id)
    expect((await reveries.forCharacter(npcId))[0]!.last_flared_turn_id).toBe(narratorTurn.id)

    // ── OccupancyRepository.insertSnapshot (P3 occupancy write) ────────────
    await occupancy.insertSnapshot({
      worldId,
      placeId,
      sceneId: null,
      sourceTurnId: narratorTurn.id,
      worldTime: 'morning',
      occupancyJson: JSON.stringify({ count: 2, roles: ['net-mender'] }),
    })
    const snapshot = await occupancy.latestSnapshot(worldId, placeId)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.source_turn_id).toBe(narratorTurn.id)

    // ── CharacterRepository.recordAppearancesAndAutoPromote (P3 bump) ──────
    const present = (await characters.forWorld(worldId)).filter((c) => c.is_player === 0)
    expect(present.some((c) => c.id === npcId)).toBe(true)
    const promotion = await characters.recordAppearancesAndAutoPromote(
      worldId,
      present,
      narratorTurn.id,
    )
    expect(promotion.counted).toBeGreaterThan(0)
    // The bump landed in Mongo: the NPC's appearance_count incremented and
    // last_seen_turn_id now points at the narrator turn.
    const bumped = (await characters.forWorld(worldId)).find((c) => c.id === npcId)
    expect(bumped?.appearance_count).toBe(1)
    expect(bumped?.last_seen_turn_id).toBe(narratorTurn.id)
  })

  it('round-trips the archivist WRITE surface on MONGO (P4a port additions)', async () => {
    const worlds = new MongoWorldRepository(h.ctx)
    const places = new MongoPlaceRepository(h.ctx)
    const characters = new MongoCharacterRepository(h.ctx)
    const scenes = new MongoSceneRepository(h.ctx)
    const dossiers = new MongoDossierRepository(h.ctx)
    const dossierWriter = new MongoDossierWriter(h.ctx)

    const { worldId } = await createWorld(
      {
        name: 'Charlestown 1903',
        premise: 'a tall-ship port on the edge of change',
        initialState: {
          time: 'noon',
          location: 'Charlestown harbour — Cornwall',
          identity: 'a shipwright',
        },
      },
      { worlds, extractSettingRegion: async () => null },
    )

    // ── PlaceRepository: insert → update → merge → delete ──────────────────
    const { id: placeAId } = await places.insert({
      world_id: worldId,
      name: 'The Rope Walk',
      description: 'a long shed of tarred hemp',
      kind: 'workshop',
    })
    const { id: placeBId } = await places.insert({
      world_id: worldId,
      name: 'Rope Walk (duplicate)',
      description: 'the same shed, seen again',
      kind: 'workshop',
    })
    expect(await places.nameById(placeAId)).toBe('The Rope Walk')

    await places.update({ id: placeAId, description: 'rethatched and busy', kind: null })
    const afterUpdate = await places.byId(placeAId)
    expect(afterUpdate?.description).toBe('rethatched and busy')
    expect(afterUpdate?.kind).toBe('workshop') // null = COALESCE'd, unchanged

    await places.merge({ id: placeAId, description: 'merged description', kind: 'landmark' })
    const afterMerge = await places.byId(placeAId)
    expect(afterMerge?.description).toBe('merged description')
    expect(afterMerge?.kind).toBe('landmark')

    await places.delete(placeBId)
    expect(await places.byId(placeBId)).toBeNull()

    // ── CharacterRepository: insert → update → merge → rename → delete ─────
    const { id: charId } = await characters.insert({
      world_id: worldId,
      name: 'Mariah Pengelly',
      description: 'a sailmaker with sharp eyes',
      is_player: 0,
      current_place_id: placeAId,
      memorable_facts: null,
      status: 'active',
      active_goal: null,
      current_attitude: null,
      observations: null,
    })
    expect((await characters.findByExactLowerName(worldId, 'mariah pengelly'))?.id).toBe(charId)

    await characters.update(charId, {
      description: 'a sailmaker, now foreman',
      current_place_id: null,
      is_player: null,
      memorable_facts: '[t:1] runs the loft',
      status: null,
    })
    const updatedChar = (await characters.forWorld(worldId)).find((c) => c.id === charId)
    expect(updatedChar?.description).toBe('a sailmaker, now foreman')
    expect(updatedChar?.memorable_facts).toBe('[t:1] runs the loft')

    const { id: dupCharId } = await characters.insert({
      world_id: worldId,
      name: 'Mariah (other)',
      description: 'a second sighting',
      is_player: 0,
      current_place_id: placeAId,
      memorable_facts: null,
      status: 'active',
      active_goal: null,
      current_attitude: null,
      observations: null,
    })
    await characters.merge(charId, {
      name: 'Mariah Pengelly',
      description: 'the canonical sailmaker',
      current_place_id: placeAId,
      memorable_facts: '[t:1] runs the loft',
      status: 'active',
      active_goal: 'finish the mainsail',
      current_attitude: 'focused',
      observations: '[t:1] seen at the loft',
      agency_level: 'npc',
      personal_goals: null,
      current_focus: null,
      recent_activity: null,
      private_beliefs: null,
      relationship_to_player: null,
      long_term_agenda: null,
      tool_access: null,
      appearance_count: 2,
      last_seen_turn_id: null,
      last_agent_tick_turn_id: null,
      player_notes: null,
      aliases: 'Mariah',
    })
    const mergedChar = (await characters.forWorld(worldId)).find((c) => c.id === charId)
    expect(mergedChar?.description).toBe('the canonical sailmaker')
    expect(mergedChar?.appearance_count).toBe(2)

    await characters.rename('Mariah P. Pengelly', charId)
    expect((await characters.forWorld(worldId)).find((c) => c.id === charId)?.name).toBe(
      'Mariah P. Pengelly',
    )

    await characters.delete(dupCharId)
    expect((await characters.forWorld(worldId)).some((c) => c.id === dupCharId)).toBe(false)

    // ── SceneRepository: insert (open) → close ────────────────────────────
    const sceneNumber = (await scenes.maxSceneNumber(worldId)) + 1
    const { id: sceneId } = await scenes.insert({
      world_id: worldId,
      place_id: placeAId,
      title: 'In the rope walk',
      scene_number: sceneNumber,
      opened_at_turn: 1,
    })
    await worlds.setCurrentScene(sceneId, worldId)
    expect(await scenes.currentSceneId(worldId)).toBe(sceneId)
    expect(await scenes.currentScenePlaceId(worldId)).toBe(placeAId)

    await scenes.close({ summary: 'the loft falls quiet', closedAtTurn: 2, id: sceneId })
    const closedScene = (await scenes.forWorld(worldId)).find((s) => s.id === sceneId)
    expect(closedScene?.status).toBe('completed')
    expect(closedScene?.summary).toBe('the loft falls quiet')

    // ── DossierWriter: thread + clue + objective + resource ───────────────
    const { id: threadId } = await dossierWriter.insertThread({
      world_id: worldId,
      title: 'The missing manifest',
      kind: 'mystery',
      status: 'active',
      summary: 'a cargo ledger has vanished',
      stakes: null,
      rewards: null,
      consequences: null,
      hidden: null,
      relevance_tags_json: '[]',
      source_turn_id: 1,
    })
    expect((await dossierWriter.threadByTitle(worldId, 'the missing manifest'))?.id).toBe(threadId)
    await dossierWriter.updateThread({
      id: threadId,
      kind: 'mystery',
      status: 'dormant',
      summary: null, // COALESCE: unchanged
      stakes: 'the harbourmaster is implicated',
      rewards: null,
      consequences: null,
      hidden: null,
      relevance_tags_json: '["manifest"]',
      resolved_turn_id: null,
    })

    const { id: clueId } = await dossierWriter.insertClue({
      world_id: worldId,
      thread_id: threadId,
      title: 'Torn ledger corner',
      detail: 'a scrap with half a date',
      implication: null,
      status: 'open',
      source_turn_id: 1,
    })
    expect((await dossierWriter.clueByTitle(worldId, 'torn ledger corner'))?.id).toBe(clueId)
    await dossierWriter.updateClue({
      id: clueId,
      thread_id: null,
      detail: null,
      implication: 'the date predates the voyage',
      status: 'interpreted',
    })

    const { id: objId } = await dossierWriter.insertObjective({
      world_id: worldId,
      thread_id: threadId,
      title: 'Recover the manifest',
      status: 'active',
      detail: 'search the harbourmaster office',
      blocker: null,
      source_turn_id: 1,
    })
    expect((await dossierWriter.objectiveByTitle(worldId, 'recover the manifest'))?.id).toBe(objId)
    await dossierWriter.updateObjective({
      id: objId,
      thread_id: null,
      status: 'blocked',
      detail: null,
      blocker: 'office is locked',
      completed_turn_id: null,
    })

    const { id: resId } = await dossierWriter.insertResource({
      world_id: worldId,
      owner_character_id: charId,
      name: 'Brass key',
      kind: 'tool',
      status: 'held',
      detail: 'opens the office',
      source_turn_id: 1,
    })
    expect((await dossierWriter.resourceByName(worldId, 'brass key'))?.id).toBe(resId)
    await dossierWriter.updateResource({
      id: resId,
      owner_character_id: null,
      kind: null,
      status: 'lost',
      detail: null,
    })

    // The whole dossier reads back through the read port with the writes applied.
    const dossier = await dossiers.forWorld(worldId)
    const thread = dossier.threads.find((t) => t.id === threadId)
    expect(thread?.status).toBe('dormant')
    expect(thread?.stakes).toBe('the harbourmaster is implicated')
    expect(thread?.summary).toBe('a cargo ledger has vanished') // COALESCE preserved
    expect(dossier.clues.find((c) => c.id === clueId)?.status).toBe('interpreted')
    expect(dossier.clues.find((c) => c.id === clueId)?.implication).toBe(
      'the date predates the voyage',
    )
    expect(dossier.objectives.find((o) => o.id === objId)?.status).toBe('blocked')
    expect(dossier.objectives.find((o) => o.id === objId)?.blocker).toBe('office is locked')
    const resource = dossier.resources.find((r) => r.id === resId)
    expect(resource?.status).toBe('lost')
    expect(resource?.kind).toBe('tool') // COALESCE preserved
  })

  it('applies an ArchivistPatch through the use case against the MONGO ports (P4b)', async () => {
    const worlds = new MongoWorldRepository(h.ctx)
    const places = new MongoPlaceRepository(h.ctx)
    const characters = new MongoCharacterRepository(h.ctx)
    const scenes = new MongoSceneRepository(h.ctx)
    const dossiers = new MongoDossierRepository(h.ctx)
    const dossierWriter = new MongoDossierWriter(h.ctx)
    const reveries = new MongoReverieRepository(h.ctx)
    const timeline = new MongoTimelineWriter(h.ctx)
    const turns = new MongoTurnRepository(h.ctx)
    const unitOfWork = new MongoUnitOfWork(h.ctx)

    const { worldId } = await createWorld(
      {
        name: 'Looe 1905',
        premise: 'a twin harbour town facing the open Channel',
        initialState: {
          time: 'morning',
          location: 'East Looe quay — Cornwall',
          identity: 'a fish-buyer',
        },
      },
      { worlds, extractSettingRegion: async () => null },
    )

    // createWorld seeds place #1 + active scene #1 + the player character. A
    // narrator turn must exist for the timeline-event / source-turn bookkeeping.
    const narratorTurn = await turns.insert(
      worldId,
      'assistant',
      'The pilchard boats come in on the morning tide.',
      null,
    )
    const sceneId = await scenes.currentSceneId(worldId)
    expect(sceneId).not.toBeNull()

    // A representative patch: a new NPC, a story thread, a scene-context dial,
    // a world-clock advance, and a timeline beat tied to the thread.
    await applyArchivistPatch(
      {
        worldId,
        turnId: narratorTurn.id,
        patch: {
          current_time: 'late morning',
          scene_context: { scene_mood: 'tense', pace: 'slow', focus: 'environment' },
          characters: [
            {
              name: 'Salome Roskilly',
              description: 'a fish-buyer with a ledger and a sharp tongue',
              status: 'active',
              active_goal: 'corner the morning catch',
              memorable_facts_append: 'outbid the Plymouth men last season',
            },
          ],
          story_threads: [
            {
              title: 'The short-weighted catch',
              kind: 'mystery',
              status: 'active',
              summary: 'the morning landings keep coming up light on the scale',
            },
          ],
          timeline_events: [
            {
              title: 'The tide brought the boats in light',
              summary: 'the catch landed under weight for the third day running',
              thread_title: 'The short-weighted catch',
              importance: 3,
            },
          ],
        },
      },
      {
        places,
        characters,
        scenes,
        worlds,
        dossierWriter,
        timeline,
        reveries,
        unitOfWork,
      },
    )

    // ── The NPC was inserted into Mongo ───────────────────────────────────
    const npc = (await characters.forWorld(worldId)).find((c) => c.name === 'Salome Roskilly')
    expect(npc).toBeDefined()
    expect(npc?.is_player).toBe(0)
    expect(npc?.active_goal).toBe('corner the morning catch')
    expect(npc?.memorable_facts).toContain('outbid the Plymouth men last season')

    // ── The story thread + timeline event landed in Mongo ─────────────────
    const dossier = await dossiers.forWorld(worldId)
    const thread = dossier.threads.find((t) => t.title === 'The short-weighted catch')
    expect(thread).toBeDefined()
    expect(thread?.status).toBe('active')
    const event = dossier.timeline.find((e) => e.title === 'The tide brought the boats in light')
    expect(event).toBeDefined()
    expect(event?.thread_id).toBe(thread?.id)
    expect(event?.world_time).toBe('late morning')

    // ── The active scene's context was updated in Mongo ───────────────────
    const updatedScene = (await scenes.forWorld(worldId)).find((s) => s.id === sceneId)
    expect(updatedScene?.scene_mood).toBe('tense')
    expect(updatedScene?.pace).toBe('slow')
    expect(updatedScene?.focus).toBe('environment')

    // ── The world clock advanced in Mongo ─────────────────────────────────
    expect((await worlds.cursor(worldId)).world_time).toBe('late morning')
  })

  // Final exit criterion of the cutover — un-skipped in Phase 5 once the opening
  // turn + narrate-turn loop are wired through the container on Mongo.
  it.skip('plays a turn end-to-end on Mongo (un-skipped in Phase 5)', () => {
    // Placeholder: create → opening turn → player turn → archivist mutates the
    // Mongo dossier/characters/places → narrator context reads them back, all on
    // PERSISTENCE=mongo. Asserted here once Phase 5 routes narrate-turn through
    // the injected Mongo port bag.
  })
})

import type {
  DossierRepository,
  OccupancyRepository,
  PlaceRepository,
  SceneRepository,
  WorldRepository,
} from '@/domain/ports'
import {
  buildGroups,
  buildHooks,
  densityForCount,
  hashSeed,
  inferPlaceProfile,
  mulberry32,
  profileFromRow,
  resolveTemplates,
  trafficBlock,
  type PlaceOccupancy,
} from '@/domain/services/occupancy-sim'
import {
  getActiveSceneForWorld,
  getLatestOccupancySnapshotRow,
  getPlace,
  getPlaceProfileRow,
  getPopulationTemplatesForKind,
  getStoryDossierForWorld,
  getWorldCursor,
  insertOccupancySnapshot,
  insertPlaceProfile,
} from '@/lib/db'

// The pure occupancy simulation (PRNG, profile inference, template resolution,
// group/hook builders + all value types) moved to
// domain/services/occupancy-sim.ts (P4). Re-exported here for back-compat with
// existing `@/lib/place-population` importers. The DB-bound orchestrator
// `buildPlaceOccupancySnapshot` below stays until repositories land (P5).
export {
  buildGroups,
  buildHooks,
  classifyPlaceKind,
  densityForCount,
  hashSeed,
  inferPlaceProfile,
  mulberry32,
  profileFromRow,
  resolveTemplates,
  trafficBlock,
  type EncounterHook,
  type GroupSource,
  type HookStrength,
  type InferredProfile,
  type OccupancyDensity,
  type OccupancyGroup,
  type OccupancyTraffic,
  type OccupantVisibility,
  type PlaceOccupancy,
  type PopulationTemplate,
} from '@/domain/services/occupancy-sim'

// Legacy `@/lib/db`-bound orchestrator. Kept byte-identical so existing
// importers (narrate-turn.ts) keep compiling until the P5b Integrate stage
// repoints them onto `buildPlaceOccupancySnapshotVia`. The `Via` twin below is
// the port-driven path the container wires.
export function buildPlaceOccupancySnapshot(
  worldId: number,
  sourceTurnId: number | null,
): PlaceOccupancy | null {
  const scene = getActiveSceneForWorld(worldId)
  if (!scene || !scene.place_id) return null
  const place = getPlace(scene.place_id)
  if (!place) return null

  // Reuse: while in the same scene, keep the latest snapshot (don't re-roll).
  const latest = getLatestOccupancySnapshotRow(worldId, place.id)
  if (latest && latest.scene_id === scene.id) {
    try {
      return JSON.parse(latest.occupancy_json) as PlaceOccupancy
    } catch {
      // fall through and rebuild on corrupt JSON
    }
  }

  const cursor = getWorldCursor(worldId)
  const storedProfile = getPlaceProfileRow(worldId, place.id)
  const profile = storedProfile
    ? profileFromRow(storedProfile)
    : inferPlaceProfile({ name: place.name, kind: place.kind })
  if (!storedProfile) {
    insertPlaceProfile({
      worldId,
      placeId: place.id,
      profileKind: profile.profileKind,
      capacityMin: profile.capacityMin,
      capacityMax: profile.capacityMax,
      typicalRolesJson: JSON.stringify(profile.typicalRoles),
      matchTagsJson: JSON.stringify(profile.matchTags),
      trafficLevel: profile.trafficLevel,
    })
  }
  const templateRows = getPopulationTemplatesForKind(worldId, profile.profileKind)
  const templates = resolveTemplates(templateRows, profile.profileKind)

  const seedKey = `w:${worldId}|p:${place.id}|s:${scene.id}`
  const rng = mulberry32(hashSeed(seedKey))

  const { groups, sources, total } = buildGroups(profile, templates, rng)
  const density = densityForCount(total, profile.capacityMax)
  const activeThreads = getStoryDossierForWorld(worldId).threads.filter((t) => t.status === 'active')
  const encounterHooks = buildHooks(profile, groups, sources, activeThreads, rng)

  const occupancy: PlaceOccupancy = {
    density,
    seed: seedKey,
    groups,
    traffic: trafficBlock(profile, density),
    encounter_hooks: encounterHooks,
  }

  insertOccupancySnapshot({
    worldId,
    placeId: place.id,
    sceneId: scene.id,
    sourceTurnId,
    worldTime: cursor.world_time,
    occupancyJson: JSON.stringify(occupancy),
  })

  return occupancy
}

// Read/write ports the occupancy builder needs. Same delegation discipline as
// world-state.ts's NarratorWorldStateDeps: the SQLite adapters delegate to the
// identical `@/lib/db` readers/writers, so the SQLite path stays byte-green
// (P5b cutover); the Mongo adapters read/write the collections.
export type PlaceOccupancyDeps = {
  worlds: Pick<WorldRepository, 'cursor'>
  scenes: Pick<SceneRepository, 'activeForWorld'>
  places: Pick<PlaceRepository, 'byId'>
  dossiers: Pick<DossierRepository, 'forWorld'>
  occupancy: Pick<
    OccupancyRepository,
    | 'latestSnapshot'
    | 'placeProfile'
    | 'insertPlaceProfile'
    | 'populationTemplatesForKind'
    | 'insertSnapshot'
  >
}

// Deterministic occupancy builder. Reuses the latest snapshot while the player
// stays in the same scene; otherwise infers/loads a profile, resolves templates
// (stored rows override built-in defaults), builds a seeded room + hooks,
// persists, and returns. Returns null when there is no resolvable active place.
// Port-driven: identical logic to the legacy `@/lib/db` orchestrator — only the
// row SOURCE changes (injected ports), so the SQLite path stays byte-identical.
export async function buildPlaceOccupancySnapshotVia(
  deps: PlaceOccupancyDeps,
  worldId: number,
  sourceTurnId: number | null,
): Promise<PlaceOccupancy | null> {
  const scene = await deps.scenes.activeForWorld(worldId)
  if (!scene || !scene.place_id) return null
  const place = await deps.places.byId(scene.place_id)
  if (!place) return null

  // Reuse: while in the same scene, keep the latest snapshot (don't re-roll).
  const latest = await deps.occupancy.latestSnapshot(worldId, place.id)
  if (latest && latest.scene_id === scene.id) {
    try {
      return JSON.parse(latest.occupancy_json) as PlaceOccupancy
    } catch {
      // fall through and rebuild on corrupt JSON
    }
  }

  const cursor = await deps.worlds.cursor(worldId)
  const storedProfile = await deps.occupancy.placeProfile(worldId, place.id)
  const profile = storedProfile
    ? profileFromRow(storedProfile)
    : inferPlaceProfile({ name: place.name, kind: place.kind })
  if (!storedProfile) {
    await deps.occupancy.insertPlaceProfile({
      worldId,
      placeId: place.id,
      profileKind: profile.profileKind,
      capacityMin: profile.capacityMin,
      capacityMax: profile.capacityMax,
      typicalRolesJson: JSON.stringify(profile.typicalRoles),
      matchTagsJson: JSON.stringify(profile.matchTags),
      trafficLevel: profile.trafficLevel,
    })
  }
  const templateRows = await deps.occupancy.populationTemplatesForKind(worldId, profile.profileKind)
  const templates = resolveTemplates(templateRows, profile.profileKind)

  const seedKey = `w:${worldId}|p:${place.id}|s:${scene.id}`
  const rng = mulberry32(hashSeed(seedKey))

  const { groups, sources, total } = buildGroups(profile, templates, rng)
  const density = densityForCount(total, profile.capacityMax)
  const dossier = await deps.dossiers.forWorld(worldId)
  const activeThreads = dossier.threads.filter((t) => t.status === 'active')
  const encounterHooks = buildHooks(profile, groups, sources, activeThreads, rng)

  const occupancy: PlaceOccupancy = {
    density,
    seed: seedKey,
    groups,
    traffic: trafficBlock(profile, density),
    encounter_hooks: encounterHooks,
  }

  await deps.occupancy.insertSnapshot({
    worldId,
    placeId: place.id,
    sceneId: scene.id,
    sourceTurnId,
    worldTime: cursor.world_time,
    occupancyJson: JSON.stringify(occupancy),
  })

  return occupancy
}

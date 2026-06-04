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

// Deterministic occupancy builder. Reuses the latest snapshot while the player
// stays in the same scene; otherwise infers/loads a profile, resolves templates
// (DB rows override built-in defaults), builds a seeded room + hooks, persists,
// and returns. Returns null when there is no resolvable active place.
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

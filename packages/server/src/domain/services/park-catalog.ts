// Player-facing park catalog (v0.15). Persistence stays worlds / world_id.
// Catalog parks are authored entries; sandbox generation lives behind Lab.
// Host files and an authored THRESHOLD roster are later milestones.

export type ParkCatalogEntry = {
  id: string
  name: string
  promise: string
  era: string
  hasFacility: boolean
  templateId: string
  premise: string
  narrativeLabels: string[]
}

export const PARK_CATALOG: readonly ParkCatalogEntry[] = [
  {
    id: 'threshold',
    name: 'Project THRESHOLD',
    promise:
      'A sealed bunker still on watch. Its people keep their own days. You can enter a historical narrative — and walk back out.',
    era: 'Late Cold War',
    hasFacility: true,
    templateId: 'bunker',
    premise:
      'Project THRESHOLD is a sealed government installation still on watch. A small resident staff keep their own days in operations, the mess, and the archive vault. Historical narratives run from an isolation chamber you can walk back out of. A new posting has just arrived, clearance freshly stamped.',
    narrativeLabels: ['Ancient Rome'],
  },
]

export function getPark(id: string): ParkCatalogEntry | undefined {
  return PARK_CATALOG.find((park) => park.id === id)
}

// WorldArchetypeProvider (starship P0) — supplies authored deck-plan templates for
// bounded worlds: a fixed set of rooms, a connectivity graph between them, and
// crew-role slots the seeder dresses with LLM-generated characters. The template
// is a pure domain value object (no I/O); the adapter reads it from a constant /
// directory and the SeedBoundedWorld use case turns it into places +
// place_connections + characters.

// A room in the authored plan. `key` is a stable within-template identifier the
// edges + crew slots reference (it is NOT a place id — those are assigned when
// the seeder writes the `places` rows). `deck` / `layoutHint` flow to the
// matching Place columns for future map layering.
export type LocationNode = {
  key: string
  name: string
  description: string
  deck: string | null
  layoutHint: string | null
}

// An authored connection between two rooms, by `key`. `kind`: corridor/hatch/
// door/ladder/airlock. `bidirectional` defaults conceptually to true; the
// adapter expands a bidirectional edge into the graph on both sides.
export type LocationConnection = {
  from: string
  to: string
  kind: string | null
  bidirectional: boolean
}

// A crew-role slot the LLM dressing step fills. `homeRoomKey` is where this crew
// member's daily_loop should anchor (must reference a real LocationNode.key).
export type EnsembleSlot = {
  role: string
  homeRoomKey: string
  description: string
}

// The authored template value object returned by getTemplate().
export type WorldArchetype = {
  id: string
  name: string
  rooms: LocationNode[]
  edges: LocationConnection[]
  crew: EnsembleSlot[]
}

export interface WorldArchetypeProvider {
  getTemplate(templateId: string): Promise<WorldArchetype | null>
  // The id of the template a "create a bounded world" entry point should seed
  // when the caller has no specific ship in mind. Lets a driving adapter launch
  // the default starship without importing the infrastructure template constant.
  defaultTemplateId(): string
}

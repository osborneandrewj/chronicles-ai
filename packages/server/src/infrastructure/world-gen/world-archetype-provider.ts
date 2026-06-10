import 'server-only'

import type { WorldArchetype, WorldArchetypeProvider } from '@/domain/ports/world-archetype-provider'
import { WORLD_ARCHETYPES, listWorldArchetypes } from '@/infrastructure/world-gen/archetypes'

// WorldArchetypeProvider adapter (Phase B, B2). Serves the data-driven archetype
// registry (a scout vessel, a research facility, a monastery, a bunker, …) the
// SeedBoundedWorld use case dresses into bounded worlds. Adding an archetype is a
// registry entry — nothing here privileges the ship. The concealed-onboarding
// path picks a hub via the pure pickHubArchetype service; defaultTemplateId is
// kept as a stable fallback for callers with no archetype in mind.

const DEFAULT_TEMPLATE_ID = 'scout-vessel'

export class AuthoredWorldArchetypeProvider implements WorldArchetypeProvider {
  async getTemplate(templateId: string): Promise<WorldArchetype | null> {
    return WORLD_ARCHETYPES.get(templateId) ?? null
  }

  async all(): Promise<WorldArchetype[]> {
    return listWorldArchetypes()
  }

  defaultTemplateId(): string {
    return DEFAULT_TEMPLATE_ID
  }
}

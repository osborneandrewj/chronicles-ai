import 'server-only'

import type { DeckPlanProvider, DeckPlanTemplate } from '@/domain/ports/deck-plan-provider'
import { SCOUT_TEMPLATE, SCOUT_TEMPLATE_ID } from '@/infrastructure/world-gen/scout-template'

// DeckPlanProvider adapter (starship P1). Serves the authored deck-plan
// templates the SeedBoundedWorld use case dresses into bounded worlds. For P1
// there is exactly one template — the scout vessel — looked up by id; unknown
// ids return null so the use case can surface a "no such ship" error. Adding a
// second ship is a one-line registry entry (P5).

const TEMPLATES: Record<string, DeckPlanTemplate> = {
  [SCOUT_TEMPLATE_ID]: SCOUT_TEMPLATE,
}

export class AuthoredDeckPlanProvider implements DeckPlanProvider {
  async getTemplate(templateId: string): Promise<DeckPlanTemplate | null> {
    return TEMPLATES[templateId] ?? null
  }
}

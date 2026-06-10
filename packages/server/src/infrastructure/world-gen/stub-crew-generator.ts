import 'server-only'

import type {
  EnsembleGenerator,
  EnsembleGeneratorInput,
  GeneratedEnsemble,
  GeneratedCompanion,
  GeneratedRelationship,
} from '@/domain/ports/ensemble-generator'
import { sample } from '@/domain/services/name-pool'
import type { WorldTimeBand } from '@/domain/services/world-clock'

// StubEnsembleGenerator (starship P1) — a deterministic, LLM-free EnsembleGenerator for
// tests and the offline seed script. It derives one crew member per template
// crew slot (always within the 3–5 bound for an authored template), anchors each
// daily loop to that crew member's real home room plus the first room as a shared
// gathering space, and emits a simple ally chain between consecutive crew roles.
// No API key, no spend, fully reproducible — same template in, same crew out.
//
// Names are drawn from the NamePool via a seeded sample so offline/test crews are
// diverse. The seed is derived from the template id (simple string hash) so the
// same template always yields the same names — determinism is preserved.

const BANDS: WorldTimeBand[] = ['morning', 'midday', 'evening', 'night']

/** Simple djb2-style hash of a string → 32-bit unsigned integer. */
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0
  }
  return h
}

/** Derive up to `count` names from the NamePool using a template-keyed seed. */
function namesForTemplate(templateId: string, count: number): string[] {
  const seed = hashString(templateId)
  const pairs = sample(['sci-fi', 'space', 'generic'], count, { seed })
  // Use "<Given> <Surname>" format; fall back to "Crew N" if the pool is exhausted.
  return pairs.map((p) => `${p.given} ${p.surname}`)
}

export class StubEnsembleGenerator implements EnsembleGenerator {
  async generate(input: EnsembleGeneratorInput): Promise<GeneratedEnsemble> {
    const { template } = input
    const sharedRoomKey = template.rooms[0]?.key ?? ''

    const pooledNames = namesForTemplate(template.id, template.crew.length)

    const crew: GeneratedCompanion[] = template.crew.map((slot, index) => {
      const homeRoomKey = slot.homeRoomKey
      // Morning + evening at home room; midday + night in the shared room so the
      // stubbed ship still co-locates crew somewhere.
      const dailyLoop = {} as GeneratedCompanion['dailyLoop']
      for (const band of BANDS) {
        const atHome = band === 'morning' || band === 'evening'
        dailyLoop[band] = {
          activity: atHome ? `${slot.role} duties` : 'rest and meals',
          place: atHome ? homeRoomKey : sharedRoomKey,
        }
      }
      return {
        role: slot.role,
        name: pooledNames[index] ?? `Crew ${index + 1}`,
        persona: `The ${slot.role}. ${slot.description}`,
        goal: `Carry out ${slot.role} duties through the voyage.`,
        homeRoomKey,
        dailyLoop,
      }
    })

    const relationships: GeneratedRelationship[] = []
    for (let i = 0; i < crew.length - 1; i += 1) {
      relationships.push({
        fromRole: crew[i].role,
        toRole: crew[i + 1].role,
        kind: 'ally',
        valence: 0.4,
      })
    }

    return {
      shipName: template.name,
      premise: input.premise,
      roomDressing: template.rooms.map((r) => ({ key: r.key, description: r.description })),
      crew,
      relationships,
    }
  }
}

import 'server-only'

import type {
  CrewGenerator,
  CrewGeneratorInput,
  GeneratedCrew,
  GeneratedCrewMember,
  GeneratedRelationship,
} from '@/domain/ports/crew-generator'
import type { WorldTimeBand } from '@/domain/services/world-clock'

// StubCrewGenerator (starship P1) — a deterministic, LLM-free CrewGenerator for
// tests and the offline seed script. It derives one crew member per template
// crew slot (always within the 3–5 bound for an authored template), anchors each
// daily loop to that crew member's real home room plus the first room as a shared
// gathering space, and emits a simple ally chain between consecutive crew roles.
// No API key, no spend, fully reproducible — same template in, same crew out.

const FIXED_NAMES = ['Vance', 'Okonkwo', 'Renn', 'Sable', 'Idris']
const BANDS: WorldTimeBand[] = ['morning', 'midday', 'evening', 'night']

export class StubCrewGenerator implements CrewGenerator {
  async generate(input: CrewGeneratorInput): Promise<GeneratedCrew> {
    const { template } = input
    const sharedRoomKey = template.rooms[0]?.key ?? ''

    const crew: GeneratedCrewMember[] = template.crew.map((slot, index) => {
      const homeRoomKey = slot.homeRoomKey
      // Morning + evening at home room; midday + night in the shared room so the
      // stubbed ship still co-locates crew somewhere.
      const dailyLoop = {} as GeneratedCrewMember['dailyLoop']
      for (const band of BANDS) {
        const atHome = band === 'morning' || band === 'evening'
        dailyLoop[band] = {
          activity: atHome ? `${slot.role} duties` : 'rest and meals',
          place: atHome ? homeRoomKey : sharedRoomKey,
        }
      }
      return {
        role: slot.role,
        name: FIXED_NAMES[index] ?? `Crew ${index + 1}`,
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

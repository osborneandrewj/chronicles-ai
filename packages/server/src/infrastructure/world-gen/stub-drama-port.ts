import 'server-only'

import type {
  DramaBeat,
  DramaBeatInput,
  DramaPort,
  DramaValenceDelta,
} from '@/domain/ports/drama-port'

// StubDramaPort (starship P3) — a deterministic, LLM-free DramaPort for tests and
// the offline sim script. Given a co-located group it derives one compact beat:
// a title from the place + participant names, a terse factual summary, the group's
// ids, and one small positive valence delta between the first two participants (so
// a beat reliably nudges a relationship the gate selected). No API key, no spend,
// fully reproducible — same input in, same beat out.

const STUB_DELTA = 0.2

export class StubDramaPort implements DramaPort {
  async generateBeat(input: DramaBeatInput): Promise<DramaBeat> {
    const participantIds = input.participants.map((p) => p.character_id)
    const names = input.participants.map((p) => p.name)

    const valenceDeltas: DramaValenceDelta[] = []
    if (input.participants.length >= 2) {
      valenceDeltas.push({
        from_character_id: input.participants[0].character_id,
        to_character_id: input.participants[1].character_id,
        delta: STUB_DELTA,
      })
    }

    return {
      title: `Crew gather in ${input.place_name}`,
      summary: `${names.join(' and ')} crossed paths in ${input.place_name} and exchanged a few words.`,
      participant_ids: participantIds,
      valenceDeltas,
    }
  }
}

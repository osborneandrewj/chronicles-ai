import 'server-only'

import type { MetaStoryBible } from '@/domain/entities'
import type { MetaStoryGenerator, MetaStoryGeneratorInput } from '@/domain/ports'

// Keyed off known arc-engine ids so the name never echoes the archetype label.
const STUB_INSTITUTION_NAMES: Record<string, string> = {
  'erased-operative': 'The Silhouette Program',
  'memory-hunt': 'Project Meridian',
  'countdown-vessel': 'The Cradle Initiative',
  'mirror-faction': 'Operation Palladian',
  'ghost-cartographer': 'The Threshold Bureau',
}

function stubInstitutionName(arcEngineId: string): string {
  return STUB_INSTITUTION_NAMES[arcEngineId] ?? 'The Vantage Program'
}

// Deterministic MetaStoryGenerator (Phase C, C8) — builds a coherent bible from
// the chosen arc engine without any LLM spend. Backs tests/offline runs; the
// Grok adapter produces the richer, punched-up version in prod. Same inputs →
// same bible.
export class StubMetaStoryGenerator implements MetaStoryGenerator {
  generate(input: MetaStoryGeneratorInput): Promise<MetaStoryBible> {
    const { arcEngine, hubName } = input
    const bible: MetaStoryBible = {
      arcEngineId: arcEngine.id,
      question: `Who is the newcomer to ${hubName}, really — and why were they brought here?`,
      institutionName: stubInstitutionName(arcEngine.id),
      institution: `${hubName} presents itself as a friendly posting, but it runs the simulations for a purpose it does not disclose.`,
      hiddenTruth: arcEngine.premise,
      antagonist: 'A senior member of the institution who will burn the newcomer to keep the program buried.',
      allies: 'One of the friendly crew quietly doubts the program and will help when it counts.',
      acts: [
        { title: 'A Friendly Posting', summary: 'The newcomer is welcomed; everything seems ordinary.', lucidityThreshold: 0 },
        { title: 'First Glitch', summary: 'Something in a simulation does not behave; a believed rule bends.', lucidityThreshold: 1 },
        { title: 'First Awakening', summary: 'The newcomer surfaces from a simulation and sees the room behind it.', lucidityThreshold: 2 },
        { title: 'The Program', summary: 'The true purpose of the simulations comes into view.', lucidityThreshold: 3 },
        { title: 'Bending Reality', summary: 'The player learns to act on the rules they once obeyed.', lucidityThreshold: 4 },
        { title: 'The Choice', summary: 'Master it, free it, expose it, or escape it.', lucidityThreshold: 5 },
      ],
      bleedMotifs: arcEngine.motifs,
      endgameFork: ['master the system', 'free it', 'expose it', 'escape it'],
    }
    return Promise.resolve(bible)
  }
}

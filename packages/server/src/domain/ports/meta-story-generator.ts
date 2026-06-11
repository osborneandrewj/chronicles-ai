import type { MetaStoryBible } from '@/domain/entities'
import type { ArcEngine } from '@/domain/services/arc-engines'

// MetaStoryGenerator port (Phase C, C8) — the seam that produces a hub's
// durable Meta-Story Bible at creation. The adapter owns the LLM call(s) (a
// strong techno-thriller architect pass, ideally punched up by a judge +
// coherence pass) + validation; a deterministic stub backs tests and offline
// runs. Async by mandate.

export type MetaStoryGeneratorInput = {
  hubName: string
  hubPremise: string
  arcEngine: ArcEngine
  // The kinds of historical settings the player may visit (genre labels), so
  // the conspiracy and its bleed motifs can cross any era.
  genreLabels: string[]
  // Deterministic seed for the stub / any seeded selection.
  seed: number
}

export interface MetaStoryGenerator {
  generate(input: MetaStoryGeneratorInput): Promise<MetaStoryBible>
}

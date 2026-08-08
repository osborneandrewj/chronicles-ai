import type { MetaFrameKind } from '@/domain/entities'

// Pure meta-frame policy (genre-coupling audit, Phase 1). The simulation
// meta-frame (concealed hub, Meta-Story Bible, lucidity, bleed, REALITY cue,
// awakening) is strictly OPT-IN: an adventure uses it only when its preset
// explicitly declares `metaFrameKind: 'simulation'`. Everything else — and the
// absence of a declaration — is a plain grounded standalone story.

export const DEFAULT_META_FRAME_KIND: MetaFrameKind = 'grounded'

// Resolve a possibly-absent kind to its effective value (absent ⇒ grounded).
export function resolveMetaFrameKind(
  kind: MetaFrameKind | null | undefined,
): MetaFrameKind {
  return kind ?? DEFAULT_META_FRAME_KIND
}

// Does this meta-frame run the concealed-simulation machinery? Only 'simulation'
// does; 'grounded' / 'supernatural' / 'noir' all play as plain standalone worlds
// for now (their own multi-layer story shapes are future work).
export function usesSimulationFrame(
  kind: MetaFrameKind | null | undefined,
): boolean {
  return resolveMetaFrameKind(kind) === 'simulation'
}

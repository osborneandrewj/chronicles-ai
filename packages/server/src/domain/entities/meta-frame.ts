// MetaFrameKind — which narrative meta-frame an adventure uses. Pure type
// (genre-coupling audit, Phase 1).
//
// 'grounded' is a plain standalone story with no simulation framing — the
// DEFAULT for every genre. Only 'simulation' opts into the concealed-hub /
// Meta-Story Bible / lucidity / bleed / REALITY-cue / awakening machinery. The
// 'supernatural' and 'noir' kinds are reserved for future genre-conditional
// multi-layer story shapes (a magical "veil" reveal, a noir case-cracking arc)
// and currently behave as 'grounded' until their own bibles/arcs exist.

export type MetaFrameKind = 'grounded' | 'simulation' | 'supernatural' | 'noir'

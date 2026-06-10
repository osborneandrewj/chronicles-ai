// Pure gate authorizing an LLM beat for a co-located group of NPCs in the
// forward sim. The ONLY thing that authorizes LLM spend: a beat fires only when
// the cooldown has elapsed since the last beat AND some relationship among the
// group carries enough |valence| (tension or strong bond) to be worth a call.
// Deterministic, no I/O.

import type { CharacterRelationship } from '@/domain/entities'

export type BeatGateArgs = {
  characterIds: number[]
  relationships: CharacterRelationship[]
  currentTick: number
  lastBeatTick: number | null
  cooldownTicks: number
  tensionThreshold: number
}

export function shouldEmitBeat(args: BeatGateArgs): boolean {
  return cooldownElapsed(args) && hasGroupTension(args)
}

function cooldownElapsed(args: BeatGateArgs): boolean {
  if (args.lastBeatTick === null) return true
  return args.currentTick - args.lastBeatTick >= args.cooldownTicks
}

function hasGroupTension(args: BeatGateArgs): boolean {
  const members = new Set(args.characterIds)
  return args.relationships.some(
    (rel) =>
      members.has(rel.from_character_id) &&
      members.has(rel.to_character_id) &&
      Math.abs(rel.valence) >= args.tensionThreshold,
  )
}

// High-stakes gate (A8) — determines whether a group's peak relationship tension
// is severe enough to treat the current tick as "high-stakes". Used by the living
// tick to relax the beat cooldown so off-scene NPCs are pushed into action rather
// than waiting out a normal inter-beat pause.
//
// "High-stakes" is a STRONGER signal than the normal tension threshold: we want it
// to fire only when the situation is already hot, not on every mild disagreement.
// The caller supplies its own threshold; the living tick default is 0.7.

export type HighStakesArgs = {
  characterIds: number[]
  relationships: CharacterRelationship[]
  highStakesThreshold: number
}

// Returns the maximum |valence| among relationships fully contained in the group.
export function groupMaxTension(args: HighStakesArgs): number {
  const members = new Set(args.characterIds)
  let max = 0
  for (const rel of args.relationships) {
    if (members.has(rel.from_character_id) && members.has(rel.to_character_id)) {
      const abs = Math.abs(rel.valence)
      if (abs > max) max = abs
    }
  }
  return max
}

// Returns true when the group's peak tension clears the high-stakes threshold.
export function isHighStakesBeat(args: HighStakesArgs): boolean {
  return groupMaxTension(args) >= args.highStakesThreshold
}

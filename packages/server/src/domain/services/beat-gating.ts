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

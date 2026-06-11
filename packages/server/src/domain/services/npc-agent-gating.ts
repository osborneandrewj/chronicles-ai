// Pure gate deciding whether to spend an LLM call running the NPC agent this
// turn. Extracted from the narrator adapter (the decision must not live in
// infrastructure). Deterministic, no I/O — mirrors beat-gating.ts.
//
// The gate is only a cheap "is there anyone for the agent to plan for?" guard.
// Per-NPC eligibility and cadence are enforced downstream (the agentNpcsForTick
// query + shouldSkipRoutineTick), so an empty candidate set short-circuits the
// tick to a no-op even when this gate opens.

export type NpcAgentGateArgs = {
  stance: string
  inputMode: string
  presentCharacters: Array<{
    is_player: number
    status: 'active' | 'inactive' | 'dead'
  }>
}

export function shouldTickNpcAgent(args: NpcAgentGateArgs): boolean {
  const { stance, inputMode, presentCharacters } = args
  // Out-of-character / meta / pure-thought turns never run the agent.
  if (inputMode !== 'in-character' || stance === 'meta' || stance === 'think') return false
  // A scene-driving move always ticks.
  if (stance === 'do' || stance === 'say') return true
  // Passive / observe in-character turn: tick whenever any present, living,
  // non-player NPC exists — these are exactly the quiet turns a present NPC
  // should be able to carry. (Previously this required an already-promoted
  // local/nearby NPC, which left newly-met co-located NPCs silent.)
  return presentCharacters.some((c) => c.is_player !== 1 && c.status !== 'dead')
}

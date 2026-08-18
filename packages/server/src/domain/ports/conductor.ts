import type { ResolvedOutcome } from '@/domain/entities/resolved-outcome'

export type ConductorInput = {
  playerText: string
  stance: string
  inputMode: string
  sceneDigest: string
}

export type ConductorUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
}

export type ConductorResult = {
  resolution: ResolvedOutcome
  model: string
  usage?: ConductorUsage
}

export interface ConductorPort {
  /** Fail-open: return null on error. Never throws to the turn pipeline. */
  resolve(input: ConductorInput): Promise<ConductorResult | null>
}

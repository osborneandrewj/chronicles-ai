import { loadPrompt } from '@/lib/prompt-files'

// Narrator system prompt. The premise is per-world (lives on the `worlds` row)
// and is injected at request time. NARRATOR_BASE itself is world-agnostic so
// the ephemeral prompt cache still hits across worlds — only the trailing
// premise + state block varies. Loaded from `prompts/narrator-system.md` so
// the rules stay git-diffable as markdown.
export const NARRATOR_BASE = loadPrompt('narrator-system')

export function formatPremiseBlock(premise: string): string {
  return ['## PREMISE', premise].join('\n')
}

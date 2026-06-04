import 'server-only'

// Single source of truth for LLM model IDs (spec §1.3, §3.3, CLAUDE.md). These
// literals were previously duplicated across seven agent modules
// (claude-haiku-4-5-20251001) and two narrator call sites (grok-4.3). Model IDs
// live in infrastructure only — never as literals in domain or application code.

// xAI Grok — the narrator/seeder. Char-billed TTS is priced separately (pricing.ts).
export const NARRATOR_MODEL = 'grok-4.3'

// Anthropic Haiku — the structured-extraction agents (archivist, classifier,
// intent-reconciler, npc-agent, region-extractor, world-generator).
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

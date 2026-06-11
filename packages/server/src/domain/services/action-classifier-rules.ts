// Pure rule-based action classifier (P4 extraction from lib/classifier.ts). The
// LLM fallback (`classifyAction`) stays in lib/classifier.ts and calls
// `classifyWithRules` first — rules win, the model only runs on a null result
// (cost/latency). No I/O, no SDK here.

export const STANCES = ['do', 'say', 'think', 'observe', 'meta'] as const
export const INPUT_MODES = ['in-character', 'ooc', 'ambiguous'] as const

export type Stance = (typeof STANCES)[number]
export type InputMode = (typeof INPUT_MODES)[number]

export type Classification = {
  stance: Stance
  input_mode: InputMode
}

export const FALLBACK: Classification = { stance: 'do', input_mode: 'in-character' }

export function classifyWithRules(text: string, sceneDigest?: string): Classification | null {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  if (!trimmed) return FALLBACK

  if (isExplicitMeta(lower)) return { stance: 'meta', input_mode: 'ooc' }
  if (looksLikeDialogue(trimmed)) return { stance: 'say', input_mode: 'in-character' }
  if (looksLikeThought(lower)) return { stance: 'think', input_mode: 'in-character' }
  if (looksLikeObservation(lower)) return { stance: 'observe', input_mode: 'in-character' }
  if (looksLikeDirectAction(lower)) return { stance: 'do', input_mode: 'in-character' }

  if (trimmed.endsWith('?')) {
    return {
      stance: hasPresentNpc(sceneDigest) ? 'say' : 'observe',
      input_mode: 'in-character',
    }
  }

  // One-word / short imperatives are usually player actions in this app.
  if (/^[a-z]+[.!]?$/.test(lower) || /^\w+(?:\s+\w+){0,2}[.!]?$/.test(lower)) {
    return { stance: 'do', input_mode: 'in-character' }
  }

  return null
}

function isExplicitMeta(lower: string): boolean {
  return (
    /\b(ooc|out of character|meta)\b/.test(lower) ||
    /\b(what model|which model|system prompt|token|usage|cost|debug|ui|interface|app)\b/.test(
      lower,
    ) ||
    /\b(how do i|can i)\b.*\b(save|load|restart|undo|redo|pause|resume)\b/.test(lower) ||
    /\b(summarise|summarize|recap|what happened so far|story so far)\b/.test(lower)
  )
}

function looksLikeDialogue(trimmed: string): boolean {
  const lower = trimmed.toLowerCase()
  return (
    /^[“"']/.test(trimmed) ||
    /\b(i\s+)?(say|ask|tell|reply|answer|whisper|shout|call out|mutter)\b/.test(lower) ||
    /\b(say|ask|tell|reply|answer|whisper|shout|call out|mutter)\s+/.test(lower)
  )
}

function looksLikeThought(lower: string): boolean {
  return /\b(i\s+)?(think|remember|wonder|realize|realise|feel|consider|decide)\b/.test(lower)
}

function looksLikeObservation(lower: string): boolean {
  return /\b(i\s+)?(look|listen|watch|examine|inspect|scan|study|read|check|search|google)\b/.test(
    lower,
  )
}

function looksLikeDirectAction(lower: string): boolean {
  return /\b(i\s+)?(go|walk|run|drive|open|close|take|grab|put|pull|push|turn|sit|stand|enter|leave|text|email|write|post|call|dial|touch|pick|drop|knock|move|head|return)\b/.test(
    lower,
  )
}

function hasPresentNpc(sceneDigest?: string): boolean {
  return !!sceneDigest && /present npcs:\s*(?!\(none)/i.test(sceneDigest)
}

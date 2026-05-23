import { getLatestStateJson } from '@/lib/db'
import { INITIAL_STATE, parseState } from '@/lib/state'

type Handler = () => string

const HELP_TEXT = [
  '**Available meta-commands** (not part of the story, not saved to history):',
  '',
  '- `/inspect` — show the current authoritative state.',
  '- `/help` — this message.',
].join('\n')

const handlers: Record<string, Handler> = {
  '/help': () => HELP_TEXT,
  '/inspect': () => {
    const json = getLatestStateJson()
    const state = json ? parseState(json) : INITIAL_STATE
    const source = json ? 'latest extracted snapshot' : 'initial state (no turns extracted yet)'
    return [
      `**Authoritative state** _(${source})_`,
      '',
      '```json',
      JSON.stringify(state, null, 2),
      '```',
    ].join('\n')
  },
}

export function isMetaCommand(text: string): boolean {
  return text.trimStart().startsWith('/')
}

export function runMetaCommand(text: string): string {
  const token = text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const handler = handlers[token]
  if (!handler) {
    return `Unknown command \`${token}\`. Type \`/help\` for the list.`
  }
  return handler()
}

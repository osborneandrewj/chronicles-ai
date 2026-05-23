import { getLatestMetadata, getLatestStateJson, getUsageTotals } from '@/lib/db'
import { INITIAL_STATE, parseState } from '@/lib/state'

type Handler = () => string

const HELP_TEXT = [
  '**Available meta-commands** (not part of the story, not saved to history):',
  '',
  '- `/inspect` — show the current authoritative state.',
  '- `/usage` — show token usage totals and the most recent turn.',
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
  '/usage': () => {
    const totals = getUsageTotals()
    if (totals.turns === 0) {
      return 'No turns with recorded token usage yet.'
    }
    const narratorTotal = totals.narratorInput + totals.narratorOutput
    const extractorTotal = totals.extractorInput + totals.extractorOutput
    const grand = narratorTotal + extractorTotal
    const latest = getLatestMetadata()
    const lines = [
      `**Token usage** _(${totals.turns} turn${totals.turns === 1 ? '' : 's'} with metadata)_`,
      '',
      `- Narrator: ${narratorTotal.toLocaleString()} tokens ` +
        `(in ${totals.narratorInput.toLocaleString()} / out ${totals.narratorOutput.toLocaleString()})`,
      `- Extractor: ${extractorTotal.toLocaleString()} tokens ` +
        `(in ${totals.extractorInput.toLocaleString()} / out ${totals.extractorOutput.toLocaleString()})`,
      `- **Total: ${grand.toLocaleString()} tokens**`,
    ]
    if (latest) {
      lines.push(
        '',
        `**Latest turn (#${latest.id})**`,
        '',
        '```json',
        JSON.stringify(latest.metadata, null, 2),
        '```',
      )
    }
    return lines.join('\n')
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

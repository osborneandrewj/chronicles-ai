import { getLatestMetadata, getLatestStateJson, getUsageTotals } from '@/lib/db'
import { SLASH_COMMANDS } from '@/lib/slash-commands'
import { parseState } from '@/lib/state'
import { getWorld, getWorldInitialState } from '@/lib/worlds'

type Handler = (worldId: number) => string

const HELP_TEXT = [
  '**Available meta-commands** (not part of the story, not saved to history):',
  '',
  ...SLASH_COMMANDS.map((c) => `- \`${c.name}\` — ${c.description}`),
].join('\n')

const handlers: Record<string, Handler> = {
  '/help': () => HELP_TEXT,
  '/pause': () =>
    'Paused. The scene holds where it is — take your time. Type when you are ready to continue.',
  '/inspect': (worldId) => {
    const world = getWorld(worldId)
    if (!world) return `World ${worldId} not found.`
    const fallback = getWorldInitialState(world)
    const json = getLatestStateJson(worldId)
    const state = parseState(json, fallback)
    const source = json ? 'latest extracted snapshot' : 'initial state (no turns extracted yet)'
    return [
      `**Authoritative state** _(${world.name} · ${source})_`,
      '',
      '```json',
      JSON.stringify(state, null, 2),
      '```',
    ].join('\n')
  },
  '/usage': (worldId) => {
    const totals = getUsageTotals(worldId)
    if (totals.turns === 0) {
      return 'No turns with recorded token usage yet.'
    }
    const narratorTotal = totals.narratorInput + totals.narratorOutput
    const extractorTotal = totals.extractorInput + totals.extractorOutput
    const grand = narratorTotal + extractorTotal
    const latest = getLatestMetadata(worldId)
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

export function runMetaCommand(text: string, worldId: number): string {
  const token = text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const handler = handlers[token]
  if (!handler) {
    return `Unknown command \`${token}\`. Type \`/help\` for the list.`
  }
  return handler(worldId)
}

import { getContainer } from '@/composition/container'
import { getLatestMetadata, getUsageTotals } from '@/lib/db'
import { SLASH_COMMANDS } from '@/lib/slash-commands'
import { getFullWorldState } from '@/lib/world-state'

type Handler = (worldId: number) => string | Promise<string>

const HELP_TEXT = [
  '**Available meta-commands** (not part of the story, not saved to history):',
  '',
  ...SLASH_COMMANDS.map((c) => `- \`${c.name}\` — ${c.description}`),
].join('\n')

const handlers: Record<string, Handler> = {
  '/help': () => HELP_TEXT,
  '/pause': () =>
    'Paused. The scene holds where it is — take your time. Type when you are ready to continue.',
  '/inspect': async (worldId) => {
    // Port-driven full-state assembly (A0) — no SQLite-direct twin, so Mongo
    // prod reflects the same store the rest of the pipeline uses.
    const c = getContainer()
    const world = await c.worlds.getWorld(worldId)
    if (!world) return `World ${worldId} not found.`
    const state = await getFullWorldState(
      {
        worlds: c.worlds,
        turns: c.turns,
        characters: c.characters,
        places: c.places,
        scenes: c.scenes,
        dossiers: c.dossiers,
        reveries: c.reveries,
      },
      worldId,
    )
    return [
      `**Authoritative state** _(${world.name})_`,
      '',
      '```json',
      JSON.stringify(state, null, 2),
      '```',
    ].join('\n')
  },
  '/usage': (worldId) => {
    // Still SQLite-bound totals (pre-existing; usage port strangle is separate).
    const totals = getUsageTotals(worldId)
    if (totals.turns === 0) {
      return 'No turns with recorded token usage yet.'
    }
    const narratorTotal = totals.narratorInput + totals.narratorOutput
    const archivistTotal = totals.archivistInput + totals.archivistOutput
    const grand = narratorTotal + archivistTotal
    const latest = getLatestMetadata(worldId)
    const lines = [
      `**Token usage** _(${totals.turns} turn${totals.turns === 1 ? '' : 's'} with metadata)_`,
      '',
      `- Narrator: ${narratorTotal.toLocaleString()} tokens ` +
        `(in ${totals.narratorInput.toLocaleString()} / out ${totals.narratorOutput.toLocaleString()})`,
      `- Archivist: ${archivistTotal.toLocaleString()} tokens ` +
        `(in ${totals.archivistInput.toLocaleString()} / out ${totals.archivistOutput.toLocaleString()})`,
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

export async function runMetaCommand(text: string, worldId: number): Promise<string> {
  const token = text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const handler = handlers[token]
  if (!handler) {
    return `Unknown command \`${token}\`. Type \`/help\` for the list.`
  }
  return handler(worldId)
}

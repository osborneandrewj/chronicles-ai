export type SlashCommand = {
  name: string
  description: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/help', description: 'List available commands.' },
  { name: '/inspect', description: 'Show the current authoritative state.' },
  { name: '/usage', description: 'Token usage totals and the latest turn metadata.' },
  { name: '/pause', description: 'Step out of the scene without advancing it.' },
]

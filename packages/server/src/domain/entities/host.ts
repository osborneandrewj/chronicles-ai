// Authored host file (v0.16). Persistence still uses characters / world_id.
// Catalog parks seed from these; sandbox dressing does not. HBO marks stay
// out of player-facing copy — `host` is an internal code word.

export type HostKind = 'principal' | 'walk-on' | 'off-stage'

export type HostLoopBand = {
  activity: string
  place?: string
}

export type HostDailyLoop = {
  morning: HostLoopBand
  midday: HostLoopBand
  evening: HostLoopBand
  night: HostLoopBand
}

export type HostWebEdge = {
  toName: string
  kind: string
  valence: number
  note?: string
}

export type HostCornerstone = {
  text: string
  matchTags: string[]
  intensity?: number
}

export type HostFile = {
  name: string
  appearance: string
  publicRole: string
  homeRoomKey: string
  dailyLoop: HostDailyLoop
  coreDrive: string
  cornerstone: HostCornerstone
  refusals: string[]
  speechRegister: string
  web: HostWebEdge[]
  kind: HostKind
}

export type HostOpeningThread = {
  title: string
  kind: 'quest' | 'mystery' | 'threat' | 'relationship'
  summary: string
  stakes: string
  relevanceTags: string[]
}

export type HostRoster = {
  parkId: string
  hosts: HostFile[]
  openingThreads: HostOpeningThread[]
}

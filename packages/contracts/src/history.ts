import type { TurnCostDTO } from './cost'

// "Load older" pagination payload (GET /api/turns). The client never re-declares
// these inline (Chat.tsx used to own OlderTurn/OlderResponse).

export type OlderTurnDTO = {
  id: number
  world_id: number
  role: 'user' | 'assistant'
  content: string
  scene_id: number | null
  created_at: string
}

export type OlderResponseDTO = {
  turns: OlderTurnDTO[]
  usage: TurnCostDTO[]
  hasMore: boolean
}

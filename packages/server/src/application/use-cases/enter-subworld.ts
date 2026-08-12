import type { InitialState, MetaStoryBible, PlayerModel } from '@/domain/entities'
import type {
  SessionRepository,
  SimRunRepository,
  WorldRepository,
} from '@/domain/ports'
import { createWorld } from '@/application/use-cases/create-world'
import {
  buildInfluencePacket,
  compactInfluencePacket,
} from '@/domain/services/build-influence-packet'

// EnterSubworld (Phase C, C3) — seed a loose simulation linked to its hub and
// point the session at it. The simulation is an OPEN world (no authored map; the
// archivist grows places as the player explores) seeded from the chosen genre's
// hidden premise. Real-world geocoding is gated OFF: a historical simulation is
// a fictional interior, so we inject a no-op region extractor rather than let
// "Ancient Rome" resolve to modern coordinates. Also seeds a compact
// InfluencePacket (hub control channel) when hub intel is available.

export type EnterSubworldInput = {
  hubWorldId: number
  sessionId: number
  // Player-facing world name (a codename under the concealed path).
  name: string
  // The genre preset's hidden premise — seeds the narrator, never surfaced.
  premise: string
  initialState: InitialState
}

export type EnterSubworldResult = {
  subworldId: number
}

export type EnterSubworldDeps = {
  worlds: WorldRepository
  sessions: SessionRepository
  /** Optional — when present, attach InfluencePacket from hub intel. */
  simRuns?: SimRunRepository
}

export async function enterSubworld(
  { hubWorldId, sessionId, name, premise, initialState }: EnterSubworldInput,
  deps: EnterSubworldDeps,
): Promise<EnterSubworldResult> {
  const { sessions, worlds, simRuns } = deps

  // Single protagonist identity (PR B): always prefer an explicit form name,
  // else the session's player_identity. Never invent a random given name when a
  // session identity exists — the seed default ("You") only applies when both
  // are absent.
  const session = await sessions.byId(sessionId)
  const sessionIdentity = session?.player_identity?.trim() || ''
  const formName = initialState.playerName?.trim() || ''
  const playerName = formName || sessionIdentity || undefined
  const seededInitialState: InitialState = {
    ...initialState,
    playerName,
  }

  // Loose/open simulation; geocoding disabled (fictional interior).
  const { worldId } = await createWorld(
    { name, premise, initialState: seededInitialState },
    { worlds, extractSettingRegion: async () => null },
  )

  await worlds.setLayer(worldId, 'subworld', hubWorldId)
  await sessions.setSubworld(sessionId, worldId)
  await sessions.flip(sessionId, 'in_subworld')

  // Hub → sim control channel (optional; fail-open).
  try {
    const hub = await worlds.getWorld(hubWorldId)
    let bible: MetaStoryBible | null = null
    if (hub?.meta_story_json) {
      try {
        bible = JSON.parse(hub.meta_story_json) as MetaStoryBible
      } catch {
        bible = null
      }
    }
    let playerModel: PlayerModel | null = null
    if (hub?.player_model_json) {
      try {
        playerModel = JSON.parse(hub.player_model_json) as PlayerModel
      } catch {
        playerModel = null
      }
    }
    const recentReports = simRuns ? await simRuns.forHub(hubWorldId) : []
    // Only attach pressure when there is prior intel or a bible antagonist.
    if (recentReports.length > 0 || bible?.antagonist || playerModel) {
      const packet = compactInfluencePacket(
        buildInfluencePacket({
          hubWorldId,
          targetSubworldId: worldId,
          bible,
          playerModel,
          recentReports,
          seed: worldId,
        }),
      )
      await worlds.setInfluencePacket(worldId, JSON.stringify(packet))
    }
  } catch {
    // Influence is best-effort; enter must still succeed.
  }

  return { subworldId: worldId }
}

import 'server-only'

import type {
  CharacterRepository,
  Clock,
  CorrectionRepository,
  DossierRepository,
  Logger,
  NpcIntentRepository,
  OccupancyRepository,
  PlaceRepository,
  ReverieRepository,
  SceneRepository,
  SpeechSynthesizer,
  TtsCacheRepository,
  TurnRepository,
  UnitOfWork,
  UsageRepository,
  WorldRepository,
} from '@/domain/ports'
import { SystemClock } from '@/infrastructure/clock/system-clock'
import { ConsoleLogger } from '@/infrastructure/logging/console-logger'
import { SqliteCharacterRepository } from '@/infrastructure/persistence/sqlite/character-repository.sqlite'
import { SqliteCorrectionRepository } from '@/infrastructure/persistence/sqlite/correction-repository.sqlite'
import { SqliteDossierRepository } from '@/infrastructure/persistence/sqlite/dossier-repository.sqlite'
import { SqliteNpcIntentRepository } from '@/infrastructure/persistence/sqlite/npc-intent-repository.sqlite'
import { SqliteOccupancyRepository } from '@/infrastructure/persistence/sqlite/occupancy-repository.sqlite'
import { SqlitePlaceRepository } from '@/infrastructure/persistence/sqlite/place-repository.sqlite'
import { SqliteReverieRepository } from '@/infrastructure/persistence/sqlite/reverie-repository.sqlite'
import { SqliteSceneRepository } from '@/infrastructure/persistence/sqlite/scene-repository.sqlite'
import { SqliteTtsCacheRepository } from '@/infrastructure/persistence/sqlite/tts-cache-repository.sqlite'
import { SqliteTurnRepository } from '@/infrastructure/persistence/sqlite/turn-repository.sqlite'
import { SqliteUnitOfWork } from '@/infrastructure/persistence/sqlite/unit-of-work.sqlite'
import { SqliteUsageRepository } from '@/infrastructure/persistence/sqlite/usage-repository.sqlite'
import { SqliteWorldRepository } from '@/infrastructure/persistence/sqlite/world-repository.sqlite'
import { XaiSpeechSynthesizer } from '@/infrastructure/tts/xai-speech-synthesizer'

// Composition root (spec §3.7, §5.1-P1) — the ONLY module that constructs
// concrete infrastructure adapters. Everything else depends on the port types
// and reaches the implementations through this container. Swapping SQLite for
// Mongo in P2 is a change here and nowhere else.
//
// Repositories are stateless wrappers over the process-wide DB singleton, so a
// single shared instance per repo is correct and cheap.
export type Container = {
  clock: Clock
  logger: Logger
  unitOfWork: UnitOfWork
  worlds: WorldRepository
  turns: TurnRepository
  characters: CharacterRepository
  places: PlaceRepository
  scenes: SceneRepository
  dossiers: DossierRepository
  reveries: ReverieRepository
  npcIntents: NpcIntentRepository
  occupancy: OccupancyRepository
  ttsCache: TtsCacheRepository
  corrections: CorrectionRepository
  usage: UsageRepository
  speech: SpeechSynthesizer
}

let cached: Container | undefined

function build(): Container {
  return {
    clock: new SystemClock(),
    logger: new ConsoleLogger(),
    unitOfWork: new SqliteUnitOfWork(),
    worlds: new SqliteWorldRepository(),
    turns: new SqliteTurnRepository(),
    characters: new SqliteCharacterRepository(),
    places: new SqlitePlaceRepository(),
    scenes: new SqliteSceneRepository(),
    dossiers: new SqliteDossierRepository(),
    reveries: new SqliteReverieRepository(),
    npcIntents: new SqliteNpcIntentRepository(),
    occupancy: new SqliteOccupancyRepository(),
    ttsCache: new SqliteTtsCacheRepository(),
    corrections: new SqliteCorrectionRepository(),
    usage: new SqliteUsageRepository(),
    speech: new XaiSpeechSynthesizer(),
  }
}

export function getContainer(): Container {
  return (cached ??= build())
}

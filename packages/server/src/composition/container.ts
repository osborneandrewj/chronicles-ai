import 'server-only'

import type {
  BackgroundTasks,
  CharacterRepository,
  Clock,
  CorrectionRepository,
  DeckPlanProvider,
  DossierRepository,
  Logger,
  MemoryRepository,
  NpcIntentRepository,
  OccupancyRepository,
  PlaceConnectionRepository,
  PlaceRepository,
  RelationshipRepository,
  ReverieRepository,
  SceneRepository,
  SpeechSynthesizer,
  TtsCacheRepository,
  TurnRepository,
  UnitOfWork,
  UsageRepository,
  WorldRepository,
} from '@/domain/ports'
import type { CrewGenerator } from '@/domain/ports/crew-generator'
import { ProcessBackgroundTasks } from '@/infrastructure/background/process-background-tasks'
import { SystemClock } from '@/infrastructure/clock/system-clock'
import { ConsoleLogger } from '@/infrastructure/logging/console-logger'
import { SqliteCharacterRepository } from '@/infrastructure/persistence/sqlite/character-repository.sqlite'
import { SqliteCorrectionRepository } from '@/infrastructure/persistence/sqlite/correction-repository.sqlite'
import { SqliteDossierRepository } from '@/infrastructure/persistence/sqlite/dossier-repository.sqlite'
import { SqliteNpcIntentRepository } from '@/infrastructure/persistence/sqlite/npc-intent-repository.sqlite'
import { SqliteOccupancyRepository } from '@/infrastructure/persistence/sqlite/occupancy-repository.sqlite'
import { SqlitePlaceConnectionRepository } from '@/infrastructure/persistence/sqlite/place-connection-repository.sqlite'
import { SqlitePlaceRepository } from '@/infrastructure/persistence/sqlite/place-repository.sqlite'
import { SqliteRelationshipRepository } from '@/infrastructure/persistence/sqlite/relationship-repository.sqlite'
import { SqliteReverieRepository } from '@/infrastructure/persistence/sqlite/reverie-repository.sqlite'
import { SqliteSceneRepository } from '@/infrastructure/persistence/sqlite/scene-repository.sqlite'
import { SqliteTtsCacheRepository } from '@/infrastructure/persistence/sqlite/tts-cache-repository.sqlite'
import { SqliteTurnRepository } from '@/infrastructure/persistence/sqlite/turn-repository.sqlite'
import { SqliteUnitOfWork } from '@/infrastructure/persistence/sqlite/unit-of-work.sqlite'
import { SqliteMemoryRepository } from '@/infrastructure/persistence/sqlite/memory-repository.sqlite'
import { SqliteUsageRepository } from '@/infrastructure/persistence/sqlite/usage-repository.sqlite'
import { SqliteWorldRepository } from '@/infrastructure/persistence/sqlite/world-repository.sqlite'
import { XaiSpeechSynthesizer } from '@/infrastructure/tts/xai-speech-synthesizer'
import { AuthoredDeckPlanProvider } from '@/infrastructure/world-gen/deck-plan-provider'
import { GrokCrewGenerator } from '@/infrastructure/world-gen/grok-crew-generator'

// Composition root (spec §3.7, §5.1-P1, §5.1-P2) — the ONLY module that
// constructs concrete infrastructure adapters. Everything else depends on the
// port types and reaches the implementations through this container.
//
// Persistence is selected by `PERSISTENCE=sqlite|mongo` (default `sqlite`).
// Nothing else in the codebase knows which store is live: both adapter sets
// satisfy the same ports (spec §5.1-P2). The SQLite path is synchronous (the
// engine is in-process); the Mongo path is async (connect + replica-set probe +
// index build) and must be bootstrapped once at boot via `initContainer()`.
//
// Repositories are stateless wrappers over a process-wide handle, so a single
// shared instance per repo is correct and cheap.
export type Container = {
  clock: Clock
  logger: Logger
  unitOfWork: UnitOfWork
  worlds: WorldRepository
  turns: TurnRepository
  characters: CharacterRepository
  places: PlaceRepository
  placeConnections: PlaceConnectionRepository
  relationships: RelationshipRepository
  scenes: SceneRepository
  dossiers: DossierRepository
  reveries: ReverieRepository
  npcIntents: NpcIntentRepository
  occupancy: OccupancyRepository
  ttsCache: TtsCacheRepository
  corrections: CorrectionRepository
  usage: UsageRepository
  memory: MemoryRepository
  speech: SpeechSynthesizer
  backgroundTasks: BackgroundTasks
  decks: DeckPlanProvider
  crewGenerator: CrewGenerator
}

// The container is a process-wide singleton, cached on `globalThis` rather than
// a module-level variable ON PURPOSE. Next compiles the instrumentation boot
// hook in a SEPARATE bundle from the route handlers, so a plain module-level
// `cached` would be DUPLICATED: initContainer() in the boot hook populates one
// copy while getContainer() in a route reads another (empty) copy and throws.
// globalThis is shared across both bundles in the single Node process, so the
// Mongo container built at boot is visible to every route. (It also survives
// dev HMR, avoiding a reconnect on every edit.)
const CONTAINER_CACHE_KEY = '__chroniclesContainer__'

function readCachedContainer(): Container | undefined {
  return (globalThis as Record<string, unknown>)[CONTAINER_CACHE_KEY] as
    | Container
    | undefined
}

function cacheContainer(container: Container): Container {
  ;(globalThis as Record<string, unknown>)[CONTAINER_CACHE_KEY] = container
  return container
}

function persistenceMode(): 'sqlite' | 'mongo' {
  return process.env.PERSISTENCE === 'mongo' ? 'mongo' : 'sqlite'
}

function buildSqlite(): Container {
  return {
    clock: new SystemClock(),
    logger: new ConsoleLogger(),
    unitOfWork: new SqliteUnitOfWork(),
    worlds: new SqliteWorldRepository(),
    turns: new SqliteTurnRepository(),
    characters: new SqliteCharacterRepository(),
    places: new SqlitePlaceRepository(),
    placeConnections: new SqlitePlaceConnectionRepository(),
    relationships: new SqliteRelationshipRepository(),
    scenes: new SqliteSceneRepository(),
    dossiers: new SqliteDossierRepository(),
    reveries: new SqliteReverieRepository(),
    npcIntents: new SqliteNpcIntentRepository(),
    occupancy: new SqliteOccupancyRepository(),
    ttsCache: new SqliteTtsCacheRepository(),
    corrections: new SqliteCorrectionRepository(),
    usage: new SqliteUsageRepository(),
    memory: new SqliteMemoryRepository(),
    speech: new XaiSpeechSynthesizer(),
    backgroundTasks: new ProcessBackgroundTasks(),
    decks: new AuthoredDeckPlanProvider(),
    crewGenerator: new GrokCrewGenerator(),
  }
}

/**
 * Synchronous accessor. On the default SQLite path this lazily builds the
 * container. When PERSISTENCE=mongo, the Mongo adapter set must already have
 * been constructed by `initContainer()` at boot — calling this before that is a
 * programmer error (the Mongo connection is async and cannot be opened lazily
 * inside a sync getter).
 */
export function getContainer(): Container {
  const cached = readCachedContainer()
  if (cached) return cached
  if (persistenceMode() === 'mongo') {
    throw new Error(
      'PERSISTENCE=mongo requires `await initContainer()` at boot before ' +
        'getContainer() — the Mongo connection is async (spec §5.1-P2).',
    )
  }
  return cacheContainer(buildSqlite())
}

/**
 * Async bootstrap. Idempotent. On SQLite this is a thin wrapper over the sync
 * builder; on Mongo it connects (replica-set + build-phase guarded), builds the
 * indexes, and wires the Mongo repository set behind the same ports. Call once
 * at process start when PERSISTENCE=mongo.
 */
export async function initContainer(): Promise<Container> {
  const cached = readCachedContainer()
  if (cached) return cached
  if (persistenceMode() === 'sqlite') {
    return cacheContainer(buildSqlite())
  }
  // Dynamic import so the default SQLite path never loads mongoose.
  const { buildMongoRepositories } = await import(
    '@/infrastructure/persistence/mongo/build-mongo-repositories'
  )
  const databaseUrl = process.env.DATABASE_URL ?? ''
  const repos = await buildMongoRepositories(databaseUrl)
  return cacheContainer({
    clock: new SystemClock(),
    logger: new ConsoleLogger(),
    speech: new XaiSpeechSynthesizer(),
    backgroundTasks: new ProcessBackgroundTasks(),
    decks: new AuthoredDeckPlanProvider(),
    crewGenerator: new GrokCrewGenerator(),
    ...repos,
  })
}

/** For tests: drop the cached container so the next call rebuilds it. */
export function __resetContainerForTests(): void {
  delete (globalThis as Record<string, unknown>)[CONTAINER_CACHE_KEY]
}

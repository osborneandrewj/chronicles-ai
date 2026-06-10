import 'server-only'

import type {
  CharacterRepository,
  CorrectionRepository,
  DossierRepository,
  DossierWriter,
  MemoryRepository,
  NpcIntentRepository,
  OccupancyRepository,
  PlaceConnectionRepository,
  PlaceRepository,
  RelationshipRepository,
  ReverieRepository,
  SceneRepository,
  SessionRepository,
  TimelineReader,
  TimelineWriter,
  TtsCacheRepository,
  TurnRepository,
  UnitOfWork,
  UsageRepository,
  WorldRepository,
} from '@/domain/ports'

import { connectMongo } from './connection'
import { MongoContext } from './mongo-context'
import { MongoUnitOfWork } from './mongo-unit-of-work'
import { MongoCharacterRepository } from './repositories/character-repository.mongo'
import { MongoCorrectionRepository } from './repositories/correction-repository.mongo'
import { MongoDossierRepository } from './repositories/dossier-repository.mongo'
import { MongoDossierWriter } from './repositories/dossier-writer.mongo'
import { MongoMemoryRepository } from './repositories/memory-repository.mongo'
import { MongoNpcIntentRepository } from './repositories/npc-intent-repository.mongo'
import { MongoOccupancyRepository } from './repositories/occupancy-repository.mongo'
import { MongoPlaceConnectionRepository } from './repositories/place-connection-repository.mongo'
import { MongoPlaceRepository } from './repositories/place-repository.mongo'
import { MongoRelationshipRepository } from './repositories/relationship-repository.mongo'
import { MongoReverieRepository } from './repositories/reverie-repository.mongo'
import { MongoSessionRepository } from './repositories/session-repository.mongo'
import { MongoSceneRepository } from './repositories/scene-repository.mongo'
import { MongoTimelineReader } from './repositories/timeline-reader.mongo'
import { MongoTimelineWriter } from './repositories/timeline-writer.mongo'
import { MongoTtsCacheRepository } from './repositories/tts-cache-repository.mongo'
import { MongoTurnRepository } from './repositories/turn-repository.mongo'
import { MongoUsageRepository } from './repositories/usage-repository.mongo'
import { MongoWorldRepository } from './repositories/world-repository.mongo'

// The repository set the composition root injects when PERSISTENCE=mongo. This
// is the only place outside the mongo adapter that knows about MongoContext —
// the container imports just the resulting port-typed bag (spec §4.7: the
// composition root is the only place repos meet use cases).
export type MongoRepositorySet = {
  unitOfWork: UnitOfWork
  worlds: WorldRepository
  turns: TurnRepository
  characters: CharacterRepository
  places: PlaceRepository
  placeConnections: PlaceConnectionRepository
  relationships: RelationshipRepository
  scenes: SceneRepository
  dossiers: DossierRepository
  dossierWriter: DossierWriter
  timeline: TimelineWriter
  timelineReader: TimelineReader
  reveries: ReverieRepository
  sessions: SessionRepository
  npcIntents: NpcIntentRepository
  occupancy: OccupancyRepository
  ttsCache: TtsCacheRepository
  corrections: CorrectionRepository
  usage: UsageRepository
  memory: MemoryRepository
}

/**
 * Connect to Mongo (replica-set + build-phase guarded) and construct the full
 * port-typed repository set bound to one shared MongoContext. Async because the
 * connection + replica-set probe are async; the composition root awaits this
 * once at boot when PERSISTENCE=mongo.
 */
export async function buildMongoRepositories(
  databaseUrl: string,
): Promise<MongoRepositorySet> {
  const connection = await connectMongo(databaseUrl)
  const ctx = new MongoContext(connection)
  // Ensure unique indexes exist (E11000 on duplicate nameKey/titleKey/seq).
  await ctx.syncIndexes()
  return {
    unitOfWork: new MongoUnitOfWork(ctx),
    worlds: new MongoWorldRepository(ctx),
    turns: new MongoTurnRepository(ctx),
    characters: new MongoCharacterRepository(ctx),
    places: new MongoPlaceRepository(ctx),
    placeConnections: new MongoPlaceConnectionRepository(ctx),
    relationships: new MongoRelationshipRepository(ctx),
    scenes: new MongoSceneRepository(ctx),
    dossiers: new MongoDossierRepository(ctx),
    dossierWriter: new MongoDossierWriter(ctx),
    timeline: new MongoTimelineWriter(ctx),
    timelineReader: new MongoTimelineReader(ctx),
    reveries: new MongoReverieRepository(ctx),
    sessions: new MongoSessionRepository(ctx),
    npcIntents: new MongoNpcIntentRepository(ctx),
    occupancy: new MongoOccupancyRepository(ctx),
    ttsCache: new MongoTtsCacheRepository(ctx),
    corrections: new MongoCorrectionRepository(ctx),
    usage: new MongoUsageRepository(ctx),
    memory: new MongoMemoryRepository(),
  }
}

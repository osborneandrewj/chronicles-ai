// Barrel for the repository / infrastructure ports (spec §3.4). Interfaces only;
// no implementation, no I/O — the domain depends on nothing outward.
export type { Clock } from './clock'
export type { Logger } from './logger'
export type { UnitOfWork } from './unit-of-work'
export type { WorldRepository } from './world-repository'
export type { TurnRepository } from './turn-repository'
export type { CharacterRepository } from './character-repository'
export type { PlaceRepository } from './place-repository'
export type { SceneRepository } from './scene-repository'
export type { DossierRepository } from './dossier-repository'
export type { ReverieRepository } from './reverie-repository'
export type {
  NpcIntentRepository,
  ReconcileBatchResult,
} from './npc-intent-repository'
export type { OccupancyRepository } from './occupancy-repository'
export type { TtsCacheRepository } from './tts-cache-repository'
export type { CorrectionRepository } from './correction-repository'
export type { UsageRepository } from './usage-repository'
export type { SpeechSynthesizer, SynthesizedSpeech } from './speech-synthesizer'
export type { NarrationStream } from './narrator'
export type { BackgroundTasks } from './background-tasks'

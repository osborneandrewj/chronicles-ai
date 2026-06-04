// Barrel for domain entities (row TYPE defs, spec §3.3). Pure types only.

export type { Character, CharacterAgencyLevel, Place, Scene } from './character'
export type { WorldCorrectionRow } from './correction'
export type {
  IntentDisposition,
  IntentVisibility,
  NpcIntentRow,
} from './npc-intent'
export type {
  OccupancySnapshotRow,
  PlaceProfileRow,
  PopulationTemplateRow,
} from './occupancy'
export type { FlareCandidate, ReverieInput, ReverieRow } from './reverie'
export type {
  StoryClue,
  StoryDossier,
  StoryObjective,
  StoryResource,
  StoryThread,
  TimelineEvent,
} from './story'
export type { CachedTtsAudio } from './tts-cache'
export type { AssistantTurnMetadata, Turn, TurnRole, TurnTimestamp } from './turn'
export type { UsageTotals } from './usage'
export type { InitialState, World, WorldSummary } from './world'

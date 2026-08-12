// Barrel for domain entities (row TYPE defs, spec §3.3). Pure types only.

export type {
  Character,
  CharacterAgencyLevel,
  CharacterRelationship,
  ClearanceLevel,
  DeckGraph,
  Place,
  PlaceConnection,
  Scene,
} from './character'
export type {
  InfluencePacket,
  PlayerModel,
  SimRunReport,
  SimRunReportUpsert,
  SimRunStatus,
} from './sim-ops'
// ClearanceLevel is exported from './character' only (sim-ops re-exports for convenience)
export type { WorldCorrectionRow } from './correction'
export type {
  InsertNpcIntent,
  IntentDisposition,
  IntentVisibility,
  NpcIntentRow,
  ReconcileIntentInput,
} from './npc-intent'
export type {
  OccupancySnapshotRow,
  PlaceProfileRow,
  PopulationTemplateRow,
} from './occupancy'
export type { MetaFrameKind } from './meta-frame'
export type { MetaStoryAct, MetaStoryBible } from './meta-story'
export type { FlareCandidate, ReverieInput, ReverieRow } from './reverie'
export type { SimulationSession, SimulationStatus } from './session'
export type {
  StoryClue,
  StoryDossier,
  StoryObjective,
  StoryResource,
  StoryThread,
  TimelineEvent,
  TimelineProvenance,
} from './story'
export type { CachedTtsAudio } from './tts-cache'
export type { AssistantTurnMetadata, Turn, TurnRole, TurnTimestamp } from './turn'
export type { UsageTotals } from './usage'
export type { InitialState, SpatialMode, World, WorldLayer, WorldSummary } from './world'

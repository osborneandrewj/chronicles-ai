import type { StoryDossier } from '@/domain/entities'

// DossierRepository (spec §3.4, "StoryDossierRepository") — dumb CRUD read of
// the per-world story dossier (threads / clues / objectives / resources /
// timeline). Async by mandate (spec §5.3).
export interface DossierRepository {
  forWorld(worldId: number): Promise<StoryDossier>
}

import 'server-only'

import { getStoryDossierForWorld, type StoryDossier } from '@/lib/db'
import type { DossierRepository } from '@/domain/ports/dossier-repository'

// SQLite adapter for DossierRepository (spec §5.1-P1). Dumb CRUD read of the
// per-world story dossier.
export class SqliteDossierRepository implements DossierRepository {
  forWorld(worldId: number): Promise<StoryDossier> {
    return Promise.resolve(getStoryDossierForWorld(worldId))
  }
}

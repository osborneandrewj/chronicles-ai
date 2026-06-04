// Moved to domain/services/character-dedup.ts (P4 pure-service relocation).
// Re-exported here for back-compat with existing `@/lib/character-dedup`
// importers.
export {
  findLikelyDuplicateCharacters,
  type DuplicatePair,
} from '@/domain/services/character-dedup'

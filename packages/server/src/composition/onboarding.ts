import 'server-only'

// Composition-level onboarding facade (Phase B, B6). The onion boundary forbids
// inbound adapters (app/) from importing infrastructure directly — they reach it
// through the composition root. This re-exports the concealed-onboarding seams
// (the SIM_HUB flag + the genre-preset registry's player-safe API) so the
// creation page/action can branch on the flag and list adventure labels without
// crossing the boundary.
export { isSimHubEnabled } from '@/infrastructure/config/feature-flags'
export { getGenrePreset, listGenrePresets } from '@/infrastructure/world-gen/genre-presets'

import 'server-only'

// Feature-flag seam (Phase B, B0). Server-only; read ONLY by inbound adapters
// (the creation action and the world-list/inspector query assembly). No domain
// or application code reads a flag — the layered code stays flag-agnostic and
// the adapter chooses which path to wire.
//
// SIM_HUB gates the new concealed-onboarding + simulation-hub path (the genre
// picker → codename → silently-seeded hub → simulation drop-in). When off, the
// legacy open-world path and the current bounded path keep working unchanged.
export function isSimHubEnabled(): boolean {
  return process.env.SIM_HUB === '1'
}

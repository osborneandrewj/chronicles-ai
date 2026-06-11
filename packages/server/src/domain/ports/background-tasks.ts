// BackgroundTasks port (spec §3.5, §5.1-P5, §3.4 driven ports). Tracks
// fire-and-forget work (the post-stream archivist patch) so a graceful shutdown
// can await it. Replaces the route-local `inFlightArchivists` Set +
// `process.once('SIGTERM')` drain: the use case `register`s the archivist
// promise, the infrastructure adapter owns the SIGTERM handler and `drain`s.
//
// Railway sends SIGTERM ~10s before SIGKILL on redeploy; a typical archivist
// call is <3s, so draining turns "fire-and-pray" into "best-effort with bounded
// loss" without changing happy-path latency.
export interface BackgroundTasks {
  /** Track a fire-and-forget promise so shutdown can await it. */
  register(task: Promise<unknown>): void
  /** Await all currently-registered tasks (best-effort, settles all). */
  drain(): Promise<void>
}

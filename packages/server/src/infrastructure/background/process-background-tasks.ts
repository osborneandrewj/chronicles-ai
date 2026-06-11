import 'server-only'

import type { BackgroundTasks } from '@/domain/ports'

// ProcessBackgroundTasks (spec §3.5, §5.1-P5) — the infrastructure adapter for
// the BackgroundTasks port. Owns the in-flight set and the `process.once(
// 'SIGTERM')` graceful-shutdown drain that previously lived inline in
// `chat/route.ts`. The use case `register`s the post-stream archivist promise;
// on SIGTERM this awaits all in-flight work before exiting, turning
// "fire-and-pray" into "best-effort with bounded loss".
export class ProcessBackgroundTasks implements BackgroundTasks {
  private readonly inFlight = new Set<Promise<unknown>>()
  private sigtermInstalled = false

  constructor() {
    this.ensureShutdownHandler()
  }

  register(task: Promise<unknown>): void {
    this.inFlight.add(task)
    void Promise.resolve(task).finally(() => this.inFlight.delete(task))
  }

  async drain(): Promise<void> {
    if (this.inFlight.size === 0) return
    await Promise.allSettled([...this.inFlight])
  }

  private ensureShutdownHandler(): void {
    if (this.sigtermInstalled) return
    this.sigtermInstalled = true
    process.once('SIGTERM', async () => {
      const n = this.inFlight.size
      if (n > 0) {
        console.log(`[background-tasks] SIGTERM: awaiting ${n} in-flight task(s)`)
        await this.drain()
      }
      process.exit(0)
    })
  }
}

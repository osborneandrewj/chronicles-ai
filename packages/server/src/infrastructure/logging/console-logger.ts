import 'server-only'

import type { Logger } from '@/domain/ports/logger'

// Console Logger adapter (spec §3.4). A thin pass-through to `console` so the
// sink is swappable without changing call sites. Preserves the existing
// best-effort `console.error`-and-continue diagnostics.
export class ConsoleLogger implements Logger {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.debug(message, meta)
    else console.debug(message)
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.info(message, meta)
    else console.info(message)
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.warn(message, meta)
    else console.warn(message)
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.error(message, meta)
    else console.error(message)
  }
}

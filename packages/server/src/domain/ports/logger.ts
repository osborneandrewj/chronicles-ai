// Logger port (spec §3.4 LoggerPort). Adapters route structured diagnostics here
// instead of reaching for `console` directly, so the sink is swappable.
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

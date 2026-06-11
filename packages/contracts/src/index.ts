// @chronicles/contracts — framework-free DTOs + Zod schemas shared by the
// Next.js client (apps/web) and the onion server (packages/server).
// Depends on `zod` and nothing else: the client can never transitively pull
// mongoose / an LLM SDK / better-sqlite3 through this package.

export * from './chat'
export * from './cost'
export * from './corrections'
export * from './history'
export * from './world-state'
export { splitNewChunks, splitNewSentences } from './pure/sentence-splitter'
export type { SplitOptions, SplitResult } from './pure/sentence-splitter'

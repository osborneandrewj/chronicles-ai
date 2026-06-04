import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Lazy load + cache prompt template files from the server package's `prompts/`
// directory. Per CLAUDE.md convention, prompt templates live in `prompts/*.md`
// so they stay git-diffable. Read at first use and cached for the process
// lifetime — dev-server hot-reload only restarts the process when the .ts
// changes, so a .md edit needs a manual restart (same posture as inline string
// prompts). The directory is resolved relative to this module (not
// process.cwd()) so the process runs correctly from any working directory:
// from packages/server/src/lib/prompt-files.ts, `prompts/` is two levels up.
const cache = new Map<string, string>()

export function loadPrompt(name: string): string {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const file = path.resolve(moduleDir, '../../prompts', `${name}.md`)
  const contents = readFileSync(file, 'utf8').trim()
  cache.set(name, contents)
  return contents
}

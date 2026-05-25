import { readFileSync } from 'node:fs'
import path from 'node:path'

// Lazy load + cache prompt template files from /prompts at the repo root.
// Per CLAUDE.md convention, prompt templates live in `prompts/*.md` so they
// stay git-diffable. Read at first use and cached for the process lifetime —
// dev-server hot-reload only restarts the process when the .ts changes, so a
// .md edit needs a manual restart (same posture as inline string prompts).
const cache = new Map<string, string>()

export function loadPrompt(name: string): string {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const file = path.join(process.cwd(), 'prompts', `${name}.md`)
  const contents = readFileSync(file, 'utf8').trim()
  cache.set(name, contents)
  return contents
}

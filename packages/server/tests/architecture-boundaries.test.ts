import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Grep-style architecture guard (ONION_ARCH_REFACTOR.md §2.5, §3.7, P7 step 2).
 *
 * dependency-cruiser (`npm run depcruise`) enforces the import-graph boundaries;
 * this suite is the complementary literal/regex guard that catches the classic
 * regressions a graph rule can miss:
 *   - a model-ID string literal (`claude-` / `grok-`) outside infrastructure/llm/
 *   - `import 'mongoose'` outside the Mongo adapter
 *   - a merge / name-resolution deciding branch NEWLY added under infrastructure/
 *
 * Where an invariant already fully holds, the test simply passes. Where a
 * KNOWN deferred carve legitimately still violates, the offending files are
 * pinned in a commented allowlist so a NEW violation still fails the suite.
 */

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

interface SourceFile {
  /** Path relative to packages/server/src, POSIX-separated. */
  readonly rel: string
  readonly text: string
}

function listSourceFiles(dir: string): SourceFile[] {
  const out: SourceFile[] = []
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry)
    if (statSync(abs).isDirectory()) {
      out.push(...listSourceFiles(abs))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    const rel = path.relative(SRC_DIR, abs).split(path.sep).join('/')
    out.push({ rel, text: readFileSync(abs, 'utf8') })
  }
  return out
}

const SOURCES = listSourceFiles(SRC_DIR)

/** Strip line + block comments so a banned token inside a comment never trips. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('architecture boundaries — grep guard', () => {
  it('cruises a non-trivial source tree (guard is not vacuous)', () => {
    expect(SOURCES.length).toBeGreaterThan(50)
  })

  it('has no model-ID literal (claude-/grok-) outside infrastructure/llm/', () => {
    // The single home for model IDs + pricing is infrastructure/llm/ (P4). Any
    // `claude-`/`grok-` versioned-model literal elsewhere is a leaked model ID.
    const modelIdLiteral = /['"`](claude|grok)-[a-z0-9.-]*\d[a-z0-9.-]*['"`]/i
    const offenders = SOURCES.filter(
      (f) =>
        !f.rel.startsWith('infrastructure/llm/') &&
        modelIdLiteral.test(stripComments(f.text)),
    ).map((f) => f.rel)

    // Invariant holds today with ZERO exceptions — the registry is the sole home.
    expect(offenders).toEqual([])
  })

  it("has no import 'mongoose' outside infrastructure/persistence/mongo/", () => {
    const mongooseImport = /(?:from|require\()\s*['"]mongoose['"]/
    const offenders = SOURCES.filter(
      (f) =>
        !f.rel.startsWith('infrastructure/persistence/mongo/') &&
        mongooseImport.test(stripComments(f.text)),
    ).map((f) => f.rel)

    // Invariant holds today with ZERO exceptions — the ODM is confined.
    expect(offenders).toEqual([])
  })

  it('has no better-sqlite3 import outside the SQLite adapter (+ known deferred carve)', () => {
    // KNOWN DEFERRED CARVE (P1/P4 strangling incomplete): the SQL-owning lib
    // files the adapters still delegate into. A NEW better-sqlite3 importer
    // outside this pinned allowlist fails. Tracked in ONION_TODO.md P7.
    const ALLOWED_BETTER_SQLITE3 = new Set([
      'lib/db.ts',
      'lib/migrations.ts',
      'lib/archivist.ts',
    ])
    const sqliteImport = /(?:from|require\()\s*['"]better-sqlite3['"]/
    const offenders = SOURCES.filter(
      (f) =>
        !f.rel.startsWith('infrastructure/persistence/sqlite/') &&
        !ALLOWED_BETTER_SQLITE3.has(f.rel) &&
        sqliteImport.test(stripComments(f.text)),
    ).map((f) => f.rel)

    expect(offenders).toEqual([])
  })

  it('adds no NEW merge / name-resolution deciding branch under infrastructure/', () => {
    // Name resolution / character-merge / alias-merge / freshest-wins are PURE
    // DOMAIN deciding services (domain/services/name-resolution.ts). They must
    // not be (re)introduced inside an adapter — repositories are dumb CRUD.
    // The mongo mappers legitimately map rows; this looks for the *deciding*
    // vocabulary, not data mapping.
    const decidingBranch =
      /\b(mergeCharacters|mergePlaces|runAliasMerges|resolveCharacter|charactersMatch|placesMatch|freshestWins|chooseLonger)\b/
    const offenders = SOURCES.filter(
      (f) => f.rel.startsWith('infrastructure/') && decidingBranch.test(stripComments(f.text)),
    ).map((f) => f.rel)

    // Invariant holds today with ZERO exceptions — no merge logic under infra.
    expect(offenders).toEqual([])
  })

  it('keeps narrate-turn off the @/lib/db SQLite singleton (P5b cutover)', () => {
    // After the final strangle, the turn path obtains every persistence
    // read/write from injected ports (via getContainer()); it must NOT reach
    // back into the module-level better-sqlite3 singleton (`@/lib/db`). A
    // direct `@/lib/db` import here is the cross-contamination bug under
    // PERSISTENCE=mongo (a Mongo world id collides with a SQLite world id and
    // pulls a DIFFERENT store's rows). Guard both turn-path entrypoints.
    const libDbImport = /(?:from|import\()\s*['"]@\/lib\/db['"]/
    const turnPathFiles = SOURCES.filter((f) =>
      f.rel === 'infrastructure/narrator/narrate-turn.ts' || f.rel === 'lib/opening-turn.ts',
    )
    expect(turnPathFiles.length).toBe(2)
    const offenders = turnPathFiles
      .filter((f) => libDbImport.test(stripComments(f.text)))
      .map((f) => f.rel)

    expect(offenders).toEqual([])
  })

  it('keeps every infrastructure module + route handler under server-only', () => {
    // A stray value-import of an infra/route module into a 'use client' file
    // must fail the build loudly (§3.7). Enforced by an `import 'server-only'`
    // marker on every infra module and every API route handler. (Pure domain
    // and client components are intentionally NOT marked.)
    // `*test-support.ts` lives inside the mongo adapter dir solely to confine
    // the `mongoose` import; it is imported only by the Vitest harness (no RSC
    // boundary) and never ships to the client, so it is deliberately NOT marked
    // server-only.
    const needsServerOnly = SOURCES.filter(
      (f) =>
        (f.rel.startsWith('infrastructure/') || /(^|\/)route\.ts$/.test(f.rel)) &&
        !/test-support\.ts$/.test(f.rel),
    )
    const missing = needsServerOnly
      .filter((f) => !/import\s+['"]server-only['"]/.test(f.text))
      .map((f) => f.rel)

    expect(missing).toEqual([])
  })
})

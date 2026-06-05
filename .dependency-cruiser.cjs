/**
 * Onion-architecture boundary enforcement (ONION_ARCH_REFACTOR.md §2.5, §3.7,
 * P7). Net-new tooling: machine-enforces "dependencies point inward" so a stray
 * cross-layer import fails CI instead of silently shipping.
 *
 * Path globs are scoped to the ACTUAL current layout (P6 physical `apps/web`
 * move is DEFERRED — client components still live under
 * `packages/server/src/components` but are path-scoped here so the
 * client→contracts-only boundary is enforced TODAY).
 *
 * KNOWN DEFERRED CARVES encoded as narrowly-scoped allow-exceptions (NOT broad
 * rule relaxations) — each is tracked in ONION_TODO.md P7 itemsRemaining:
 *   1. SQL-owning lib modules (`lib/archivist.ts`, `lib/db.ts`,
 *      `lib/migrations.ts`) still hold `better-sqlite3` / raw `@/lib/db` that
 *      the SQLite adapters delegate into. P1/P4 strangling is incomplete.
 *   2. Client components still import a handful of pure, client-safe helpers
 *      from `@/lib` (formatUsd / badges / profile / slash-commands) that the
 *      deferred P6 physical move will relocate into `@chronicles/contracts`.
 *      Type-only imports (`import type`) are erased and do not leak a bundle, so
 *      component rules ignore `type-only` dependencies.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── Onion core: dependencies point inward ──────────────────────────────
    {
      name: 'domain-points-inward',
      comment:
        'domain/ is pure: it may not import application, infrastructure, composition, server-render, app, or components.',
      severity: 'error',
      from: { path: '^packages/server/src/domain' },
      to: {
        path: '^packages/server/src/(application|infrastructure|composition|server|app|components)',
      },
    },
    {
      name: 'domain-no-io-or-framework',
      comment:
        'domain/ may not import next, ai/@ai-sdk, mongoose, better-sqlite3, node:fs, or a wall-clock (Date is allowed; node clocks are not). I/O and frameworks live in adapters.',
      severity: 'error',
      from: { path: '^packages/server/src/domain' },
      to: {
        dependencyTypes: ['npm', 'core'],
        path: '^(next|ai|@ai-sdk/.*|mongoose|better-sqlite3|node:fs|fs|node:fs/promises)$',
      },
    },
    {
      name: 'app-imports-domain-only',
      comment:
        'application/ (use cases) orchestrate only: may import domain + sibling use-cases + node:crypto. Never infrastructure, composition, an SDK, SQL driver, or a framework.',
      severity: 'error',
      from: { path: '^packages/server/src/application' },
      to: {
        pathNot: [
          '^packages/server/src/domain',
          '^packages/server/src/application',
          '^node:crypto$',
        ],
        // Only flag in-repo cross-layer reaches + the banned runtime packages;
        // ignore the in-package type-only graph noise (e.g. zod is fine).
        path: [
          '^packages/server/src/(infrastructure|composition|server|app|components|lib)',
          '^(next|ai|@ai-sdk/.*|mongoose|better-sqlite3)$',
        ],
      },
    },
    {
      name: 'infrastructure-only-via-composition',
      comment:
        'Only composition/ (the DI wiring root) may import a concrete adapter (persistence/narrator/tts/background/clock/logging). Two carves: (a) infrastructure/llm is the centralized model-ID + pricing home that the LLM-calling lib agents import BY DESIGN (P4 — the grep guard then forbids model-IDs anywhere else); (b) chat/route.ts still injects the narrator adapter directly (P5-deferred — wiring it into the container is the AdvanceTurn follow-up). Both are tracked in ONION_TODO.md P7.',
      severity: 'error',
      from: {
        path: '^packages/server/src',
        pathNot: [
          '^packages/server/src/composition',
          '^packages/server/src/infrastructure',
          // (a) model-registry/pricing centralization home — imported by design.
          // (b) DEFERRED P5 carve: the chat route wires narrateTurn directly.
          '^packages/server/src/app/api/chat/route\\.ts$',
        ],
      },
      to: {
        path: '^packages/server/src/infrastructure',
        // infrastructure/llm (model IDs + pricing) is the sanctioned import
        // target — model-ID literals are forbidden everywhere else (grep guard);
        // domain/application reaching it is still blocked by a separate rule.
        pathNot: '^packages/server/src/infrastructure/llm',
      },
    },

    // ── mongoose confined to the Mongo adapter ─────────────────────────────
    {
      name: 'mongoose-only-in-mongo-adapter',
      comment:
        "import 'mongoose' is forbidden anywhere but infrastructure/persistence/mongo/ (the adapter that owns the ODM). Same rule that confined better-sqlite3 to the SQLite adapter.",
      severity: 'error',
      from: { pathNot: '^packages/server/src/infrastructure/persistence/mongo' },
      to: { dependencyTypes: ['npm'], path: '^mongoose$' },
    },

    // ── better-sqlite3 / raw db handle confined to the SQLite adapter ──────
    // KNOWN DEFERRED CARVE (allow-exception, not a rule relaxation): the
    // SQL-owning lib files the adapters still delegate into — archivist.ts,
    // db.ts, migrations.ts — are permitted until P1/P4 strangling completes.
    // Listed explicitly so any NEW better-sqlite3 importer trips the rule.
    {
      name: 'better-sqlite3-only-in-sqlite-adapter',
      comment:
        'better-sqlite3 belongs to the SQLite adapter. Deferred carve: lib/db.ts, lib/migrations.ts, lib/archivist.ts (the SQL-owning lib the adapters delegate into) are the only allowed legacy importers — see ONION_TODO.md P7.',
      severity: 'error',
      from: {
        pathNot: [
          '^packages/server/src/infrastructure/persistence/sqlite',
          '^packages/server/src/lib/db\\.ts$',
          '^packages/server/src/lib/migrations\\.ts$',
          '^packages/server/src/lib/archivist\\.ts$',
        ],
      },
      to: { dependencyTypes: ['npm'], path: '^better-sqlite3$' },
    },

    // ── model-ID literals: enforced structurally — only infra/llm and the ──
    // code paths it feeds may import the registry. (Literal-grep is the guard
    // test; here we forbid domain/application from reaching the registry.)
    {
      name: 'model-registry-not-in-domain-or-app',
      comment:
        'Model IDs + pricing live in infrastructure/llm/. domain/ and application/ must not import the model registry or pricing — they receive costs/results through ports.',
      severity: 'error',
      from: { path: '^packages/server/src/(domain|application)' },
      to: { path: '^packages/server/src/infrastructure/llm' },
    },

    // ── Client ('use client') tree: contracts + react/next/@ai-sdk/react only ─
    // P6 physical move DEFERRED, so the tree is path-scoped here. Type-only
    // imports are erased (no bundle leak) and excluded from these rules; the
    // remaining VALUE imports of pure @/lib helpers are a tracked P6 item.
    {
      name: 'client-no-server-layers',
      comment:
        "Client components may not import the onion (domain/application/infrastructure/composition) or server-render. They speak DTOs from @chronicles/contracts. (Value imports only — type-only is erased.)",
      severity: 'error',
      from: { path: '^packages/server/src/components' },
      to: {
        dependencyTypesNot: ['type-only'],
        path: '^packages/server/src/(domain|application|infrastructure|composition|server)',
      },
    },
    {
      name: 'client-no-native-or-server-sdk',
      comment:
        'Client components may not pull mongoose, better-sqlite3, ai, or a server-side @ai-sdk provider. Only @ai-sdk/react is allowed client-side.',
      severity: 'error',
      from: { path: '^packages/server/src/components' },
      to: {
        dependencyTypes: ['npm'],
        path: '^(mongoose|better-sqlite3|^ai$|@ai-sdk/anthropic|@ai-sdk/xai)',
      },
    },

    // ── contracts package stays framework-free ─────────────────────────────
    {
      name: 'contracts-pure',
      comment:
        '@chronicles/contracts depends on zod and nothing else, so the client can never transitively pull an SDK or a DB driver.',
      severity: 'error',
      from: { path: '^packages/contracts/src' },
      to: {
        dependencyTypes: ['npm'],
        pathNot: '^zod$',
      },
    },

    // ── generic hygiene ────────────────────────────────────────────────────
    {
      name: 'no-circular',
      comment:
        'Circular RUNTIME dependencies signal a leaked boundary — re-cut it. Type-only back-edges are excluded: the three known domain↔lib cycles (patch-sanitizer/name-resolution → archivist, state-block → world-state) are `import type` only (fully erased, no runtime cycle) — the deferred carve that relocates ArchivistPatch/CharacterRow/NarratorWorldState into domain/entities will remove even the type edge (tracked, ONION_TODO.md P7).',
      severity: 'error',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    // Resolve the @/* and @chronicles/* path aliases through the server
    // tsconfig so cross-layer imports are graphed, not seen as externals.
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    // Follow RUNTIME imports only — `import type` is erased by the compiler and
    // cannot leak a bundle or create a runtime cycle, so boundary enforcement
    // tracks value coupling. (This also drops the three known erased domain↔lib
    // type back-edges to archivist/world-state — the deferred carve that moves
    // those row/patch types into domain/entities removes even the type edge.)
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
    includeOnly: '^packages/(server|contracts)/src',
  },
}

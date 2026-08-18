---
name: api-design
description: Add or change HTTP routes and Server Actions as thin inbound adapters over use cases. Use when creating or modifying endpoints.
user-invocable: false
paths:
  - "packages/server/src/app/api/**"
  - "packages/server/src/app/**/actions.ts"
  - "packages/contracts/src/**"
---

# API adapters

Routes live at `packages/server/src/app/api/*/route.ts`. Shared Zod schemas live in `@chronicles/contracts`. There is no `/api/v1/` prefix, no `{ data, meta, error }` envelope, and no resource-CRUD layer.

Each handler: parse input → call **one** use case → pipe the result. Map domain errors (`WorldNotFound`, `BudgetExceeded`, …) to HTTP **only here**. No SQL, no SDK, no pipeline logic in a route.

- `POST /api/chat` returns an AI SDK UI message **stream**, not JSON.
- Other shipped routes are command/query adapters (`/api/tts`, `/api/turns`, `/api/usage`, `/api/world-state`, `/api/world-correction(s)`).
- New shared request/response shapes go in `@chronicles/contracts`, not copied into the route.
- Auth is the shared-password gate at the adapter edge (`lib/app-auth.ts`, middleware, login). Do not add a second gate in a use case.

If the change needs new deciding logic, that is a domain service plus a use case — not a fatter route. Read `docs/specs/api-design.md` only for the route→use-case map; the Server-Action CRUD section there is still aspirational.

---
paths:
  - "packages/server/src/app/api/**"
  - "packages/server/src/app/**/actions.ts"
  - "packages/server/src/app/**/route.ts"
---

# Route handlers

These files are inbound adapters. Parse input, call one use case from `application/use-cases/`, pipe the result. They own no pipeline logic and import no SQL, `db.ts`, or LLM SDK.

- Validate with Zod at the edge. Prefer a schema from `@chronicles/contracts` over a one-off copy.
- Map domain errors to HTTP only here (`WorldNotFound` → 404, `BudgetExceeded` → 429, etc.).
- `POST /api/chat` is a UI-message stream. Do not wrap it in a JSON envelope.
- There is no `/api/v1/` and no REST resource layer. Add a use case before adding a route.
- React Server Components read through a repository port on `getContainer()`. They never write SQL.
- Auth stays at this edge (`lib/app-auth.ts`, middleware, the login action). Do not re-check it inside a use case.
- Do not log secrets, session tokens, API keys, or raw player/LLM payloads.

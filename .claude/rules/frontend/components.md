---
paths:
  - "packages/server/src/components/**"
  - "packages/server/src/app/**/*.tsx"
---

# UI components

Server Components by default. `"use client"` only when the component needs state, effects, or browser APIs. Functional components only.

- Pages and Server Components read through a repository port on `getContainer()`. They never import `db.ts` or write SQL.
- Do not put deciding logic (visibility, name resolution, scene transitions) in a component — call a domain service or render what the use case already decided.
- There is no React Query / SWR layer. Don't add one for a single fetch.
- Match surrounding Tailwind and file conventions (`PascalCase.tsx` for components). Keep a component extractable; don't grow a second god file next to `Chat.tsx` / `WorldInspector.tsx`.
- UI / client-state work is not done until exercised in the browser, not just typechecked or screenshotted. Check other surfaces that read the same state.

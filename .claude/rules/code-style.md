---
paths:
  - "src/**"
  - "tests/**"
---

# Code Style Rules

## General
- 2-space indentation for JS/TS/JSON, 4-space for Python
- Single quotes for strings (JS/TS), double quotes for Python
- Trailing commas in multi-line arrays and objects
- No semicolons (JS/TS) unless the project uses them — be consistent with existing code

## Naming
- Variables and functions: `camelCase` (JS/TS), `snake_case` (Python)
- Classes and components: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- File names: `kebab-case.ts` for utilities, `PascalCase.tsx` for React components
- Boolean variables: prefix with `is`, `has`, `should`, `can`

## Functions
- Max ~30 lines per function — extract if longer
- Single responsibility — one function, one job
- Pure functions where possible — no side effects
- Explicit return types on exported functions (TypeScript)

## Imports
- Group: external deps, then internal modules, then relative imports
- Alphabetize within groups
- Use named imports, avoid `import *`
- Remove unused imports

## Error Handling
- Only catch errors you can meaningfully handle
- Never swallow errors silently (`catch (e) {}`)
- Use custom error classes for domain-specific errors
- Log errors with context (what was being attempted, relevant IDs)

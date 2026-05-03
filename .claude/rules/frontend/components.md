---
paths:
  - "src/frontend/**"
  - "src/components/**"
  - "**/*.tsx"
  - "**/*.jsx"
---

# Frontend Component Rules

## Component Design
- Functional components only — no class components
- One component per file, named same as the file
- Keep components under ~150 lines — extract sub-components if larger
- Separate presentation (UI) from logic (hooks)

## Props
- Destructure props in function signature
- Define prop types with TypeScript interfaces (not `type` unless union)
- Required props first, optional props after
- Use sensible defaults for optional props

## State Management
- Local state: `useState` / `useReducer` for component-scoped state
- Server state: use a data-fetching library (React Query, SWR, etc.)
- Global state: use sparingly — context or state manager for truly app-wide state
- Avoid prop drilling beyond 2 levels — use composition or context

## Performance
- Memoize expensive computations with `useMemo`
- Memoize callbacks passed to child components with `useCallback`
- Use `React.memo` only when profiling shows a real performance issue
- Lazy load routes and heavy components

## Accessibility
- Use semantic HTML elements (`button`, `nav`, `main`, not `div` for everything)
- All interactive elements must be keyboard accessible
- Images need `alt` text
- Form inputs need associated labels
- Maintain visible focus indicators

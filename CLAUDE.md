# Chronicles AI

## Project Overview
Full-stack application. Stack details TBD — update this section once chosen.

## Code Style
- Consistent indentation (2 spaces for JS/TS, 4 spaces for Python)
- Prefer named imports over default imports
- Use `const` / `let` over `var` (JS/TS); avoid mutable state where possible
- Functions: small, single-responsibility, descriptive names
- No unused variables, imports, or dead code

## Testing
- Run tests before committing: `npm test` or equivalent
- Test files live alongside source code (e.g., `*.test.ts`, `*.spec.ts`)
- Write tests for new features and bug fixes
- Prefer integration tests for API endpoints, unit tests for business logic

## Git Workflow
- Branch naming: `feature/<description>`, `fix/<description>`, `chore/<description>`
- Commit messages: imperative mood, lowercase, concise (e.g., "add user auth flow")
- Always run tests and linting before pushing
- Link related issues in PR descriptions with "Closes #N"

## Project Structure
```
src/
├── frontend/       # Client-side application
├── backend/        # Server-side application
├── lib/            # Shared utilities and helpers
├── types/          # Shared type definitions
└── config/         # Configuration files
tests/              # Test utilities and fixtures
docs/               # Documentation
db/                 # Database migrations and seeds
scripts/            # Build, deploy, and utility scripts
```

## Environment
- Local dev config: `.env.local` (never commit)
- Required env vars are documented in `.env.example`
- Load environment before importing config modules

## Common Gotchas
- Database must be running before tests execute
- Migrations must run in order — never edit a deployed migration
- Hot-reload may break on ORM model changes — restart dev server
- Never hardcode env-specific values; use config module

## Build & Deploy
- Build: `npm run build` (or equivalent)
- Dev server: `npm run dev`
- Lint: `npm run lint`
- Type check: `npm run type-check`
- Deploy commands documented in `.claude/skills/deploy/SKILL.md`

## Security
- Never commit secrets, API keys, or credentials
- Validate all user input at system boundaries
- Use parameterized queries — no string concatenation for SQL
- Sanitize output to prevent XSS
- Follow OWASP Top 10 guidelines

## AI Integration
- AI-related code lives in `src/lib/ai/` or `src/backend/ai/`
- API keys managed via environment variables, never hardcoded
- Implement rate limiting and cost tracking for LLM calls
- Use streaming responses where appropriate for UX

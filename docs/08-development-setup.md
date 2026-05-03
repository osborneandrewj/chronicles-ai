# Development Setup Guide

## Prerequisites

| Tool | Version | Installation |
|------|---------|-------------|
| Node.js | 20+ (LTS) | [nodejs.org](https://nodejs.org) or `brew install node` |
| npm | 10+ | Included with Node.js |
| Docker Desktop | Latest | [docker.com](https://www.docker.com/products/docker-desktop/) |
| Git | 2.40+ | `brew install git` |

### API Keys Required

| Service | Purpose | Get it at |
|---------|---------|-----------|
| Anthropic | Claude Sonnet/Haiku for all agents | [console.anthropic.com](https://console.anthropic.com) |
| Voyage AI | Text embeddings (Phase 2+) | [voyageai.com](https://www.voyageai.com) |

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url> chronicles-ai
cd chronicles-ai

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env.local
# Edit .env.local and add your API keys

# 4. Start the database
docker compose up -d

# 5. Run database migrations
npm run db:migrate

# 6. Start the development server
npm run dev

# 7. Open in browser
open http://localhost:3000
```

## Environment Variables

File: `.env.local` (never committed)

```bash
# Database
DATABASE_URL=postgres://chronicles:chronicles@localhost:5432/chronicles

# Anthropic (required)
ANTHROPIC_API_KEY=sk-ant-...

# Voyage AI (required for Phase 2+)
VOYAGE_API_KEY=pa-...

# Next.js
NEXTAUTH_SECRET=            # Phase 5+: generate with `openssl rand -base64 32`
NEXTAUTH_URL=http://localhost:3000

# Development
NODE_ENV=development
```

## Docker Compose

### Start Database

```bash
docker compose up -d          # Start in background
docker compose logs -f        # View logs
docker compose down           # Stop
docker compose down -v        # Stop and delete data
```

### Database Connection

```
Host: localhost
Port: 5432
Database: chronicles
User: chronicles
Password: chronicles
```

### Connect with psql

```bash
docker compose exec db psql -U chronicles -d chronicles
```

### Verify pgvector

```sql
SELECT * FROM pg_extension WHERE extname = 'vector';
-- Should return one row
```

## Database Commands

```bash
# Generate migration from schema changes
npm run db:generate

# Apply pending migrations
npm run db:migrate

# Open Drizzle Studio (visual DB browser)
npm run db:studio

# Reset database (drop all, re-migrate)
npm run db:reset
```

### npm Scripts Reference

These scripts will be defined in `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "type-check": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:reset": "drizzle-kit drop && drizzle-kit migrate",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

## Project Structure Reference

```
chronicles-ai/
├── src/
│   ├── app/                    # Next.js App Router pages
│   ├── components/             # React components
│   │   ├── ui/                 # shadcn/ui base components
│   │   ├── story/              # Story-specific components
│   │   └── world/              # World management components
│   ├── lib/
│   │   ├── ai/                 # Agent system
│   │   │   ├── narrator.ts     # Narrator agent
│   │   │   ├── world-seeder.ts # World seeder agent (Phase 2)
│   │   │   ├── wiki-compiler.ts # Wiki compiler agent (Phase 2)
│   │   │   ├── world-linter.ts # World linter agent (Phase 2)
│   │   │   ├── archivist.ts    # Archivist agent (Phase 3)
│   │   │   ├── conductor.ts    # Story conductor (Phase 4)
│   │   │   ├── actor.ts        # Character actor (Phase 4)
│   │   │   ├── prompts.ts      # Prompt template loader
│   │   │   ├── context-assembler.ts  # Context assembly
│   │   │   └── embeddings.ts   # Embedding pipeline (Phase 2)
│   │   ├── db/
│   │   │   ├── index.ts        # Drizzle client
│   │   │   ├── schema/         # Table definitions
│   │   │   └── queries/        # Query functions
│   │   ├── actions/            # Server Actions
│   │   └── utils/              # Utilities
│   └── types/                  # TypeScript type definitions
├── prompts/                    # LLM prompt templates (.md files)
├── docker/                     # Docker init scripts
├── docs/                       # This documentation
└── .claude/                    # Claude Code configuration
```

## Common Development Tasks

### Adding a shadcn/ui Component

```bash
npx shadcn@latest add <component-name>
# e.g., npx shadcn@latest add dialog
```

### Creating a New Database Table

1. Add schema definition in `src/lib/db/schema/<table>.ts`
2. Export from `src/lib/db/schema/index.ts`
3. Run `npm run db:generate` to create migration
4. Review the generated SQL in `src/lib/db/migrations/`
5. Run `npm run db:migrate` to apply

### Modifying a Prompt Template

1. Edit the `.md` file in `prompts/`
2. Test by playing through a few turns
3. Check the diff: `git diff prompts/`
4. Commit with a descriptive message about what changed and why

### Testing the Streaming Endpoint

```bash
# Quick test with curl
curl -X POST http://localhost:3000/api/story/stream \
  -H "Content-Type: application/json" \
  -d '{
    "worldId": "<uuid>",
    "sceneId": "<uuid>",
    "characterId": "<uuid>",
    "action": "I look around the room carefully."
  }'
```

### Checking Token Usage

```sql
-- Total tokens used per world
SELECT
  world_id,
  SUM((metadata->>'prompt_tokens')::int) as total_prompt,
  SUM((metadata->>'completion_tokens')::int) as total_completion,
  SUM((metadata->>'estimated_cost_usd')::float) as total_cost,
  COUNT(*) as turn_count
FROM turns
WHERE type = 'narrator_response'
GROUP BY world_id;
```

### Resetting a World (Development Only)

```sql
-- Delete all turns for a world (keeps world/scene/character)
DELETE FROM turns WHERE world_id = '<uuid>';

-- Reset scene turn count
UPDATE scenes SET status = 'active', ended_at = NULL WHERE world_id = '<uuid>';
```

## Troubleshooting

### Docker Issues

**Container won't start**:
```bash
docker compose down -v   # Remove volumes
docker compose up -d     # Fresh start
```

**Port 5432 already in use**:
```bash
# Check what's using the port
lsof -i :5432
# Either stop the other Postgres or change the port in docker-compose.yml
```

### Database Issues

**Migration fails**:
```bash
# Check current migration state
npm run db:studio
# If stuck, reset and re-migrate
npm run db:reset
```

**pgvector extension not found**:
```bash
# Verify the init script ran
docker compose exec db psql -U chronicles -d chronicles -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
# If missing, run manually:
docker compose exec db psql -U chronicles -d chronicles -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### API Key Issues

**Anthropic API errors**:
- Verify `ANTHROPIC_API_KEY` is set in `.env.local`
- Check the key is valid at [console.anthropic.com](https://console.anthropic.com)
- Ensure you have credits/billing set up

### Next.js Issues

**Hydration mismatch errors**:
- Ensure Client Components have `"use client"` directive
- Don't use `Date.now()` or `Math.random()` in Server Components
- Check that Server Components don't access browser APIs

**Hot reload not working**:
- Restart dev server: `Ctrl+C` then `npm run dev`
- If editing ORM models, always restart (schema changes require it)

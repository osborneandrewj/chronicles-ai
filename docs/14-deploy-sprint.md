# Deploy Sprint (Railway, two-tester)

**Target**: 2026-05-26
**Bar**: "Joe opens a URL from his laptop, enters a shared password, plays a turn end-to-end, and our Anthropic bill cannot run away overnight."
**Budget**: ~3 hours of focused work.

This is an ops sprint, not a feature milestone. No narrative work, no schema changes, no new agents. The point is to get the current v0.4 branch in front of one other human (Joe, co-founder) on a public URL with the smallest set of guardrails that make that safe. Per-user accounts and the post-MVP wiki/timeline work stay deferred — see `02-database-design.md` and `03-agent-system-design.md` for the long-term target.

## Scope

One middleware, one db.ts edit, one route gate, one new lib helper. Railway project + a mounted volume + four env vars.

```
src/middleware.ts                 NEW. HTTP Basic auth against APP_PASSWORD, constant-time compare.
src/lib/db.ts                     EDIT. open() honors DATABASE_PATH; fallback to cwd for dev.
src/lib/cost-cap.ts               NEW. todaysTokens() sums turns.metadata for the current UTC day; isOverDailyLimit().
src/app/api/chat/route.ts         EDIT. Early 429 when over DAILY_TOKEN_LIMIT, before any LLM call.
```

No schema migration. No new tables. The daily cap reads existing `turns.metadata` shapes already written by `/api/chat`.

### Railway setup

1. New project → "Deploy from GitHub repo" → `sprint/v0.4` (merge to `main` first; tag `v0.4.1` on the way out).
2. Add a **Volume**, mount at `/data`. Size 1 GB (overkill, but the floor).
3. Env vars:
   - `ANTHROPIC_API_KEY` — existing
   - `XAI_API_KEY` — existing (TTS path from v0.4)
   - `APP_PASSWORD` — new, generated, shared with Joe out-of-band
   - `DATABASE_PATH=/data/chronicles.sqlite`
   - `DAILY_TOKEN_LIMIT=200000` (~$1–2/day at Sonnet 4.6 rates, tunable)
   - `TTS_VOICE=eve`
4. Nixpacks auto-detects Next.js. `better-sqlite3` is native — confirm the build succeeds on first deploy; if not, add a minimal `Dockerfile` with `apt-get install build-essential python3` before `npm ci`.
5. Generate a Railway public domain. Send URL + password to Joe via 1Password / Signal / anything not the same channel that the URL went out on.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Host | **Railway, single instance + 1 GB volume** | Easiest path to a persisted SQLite file. UI-driven; nixpacks handles Next.js. Fly was the runner-up — equivalent functionally, more setup. |
| Auth | **HTTP Basic via Next.js middleware** | Two trusted testers. Browser caches credentials per-origin. No login page to design, no session table to add. ~30 lines. |
| Password storage | **Plaintext in `APP_PASSWORD` env var, constant-time compare against the Basic header** | The env var *is* the secret. Hashing buys nothing when there's one credential and one source. Generate ≥24 random chars. |
| Auth scope | **Whole app gated, including `/api/*`** | Simpler middleware matcher. No public surface to forget about. |
| Per-user accounts | **None** | Shared login → shared worlds. Splitting Andrew's and Joe's chronicles is a v0.5+ concern that comes with a `users` table and `user_id` on `worlds`. Not now. |
| DB location | **`DATABASE_PATH` env var, falls back to `cwd/chronicles.sqlite`** | Dev unchanged. Prod points at the mounted volume. One-line change at `src/lib/db.ts:20`. |
| Cost cap | **Daily token total across all turns, summed from `turns.metadata`, gated at the top of `/api/chat`** | We already record `narrator.usage` and `extractor.usage` on every turn (`db.ts:68`). Reuse it. No new schema, no Redis. Reset is implicit: "today" is UTC-day-of `created_at`. |
| Cap target | **`DAILY_TOKEN_LIMIT` (combined in+out tokens, all agents)** | One number to reason about. ~200K tokens/day ≈ $1–2/day worst case — well below the "did I leave a loop running?" threshold. Tune up later. |
| Cap response | **HTTP 429 with a JSON body, no streaming attempt** | Cheaper than letting the SDK start a stream and erroring mid-flight. Client just shows the error. |
| Backups | **Railway volume snapshots, manual before risky deploys** | Litestream / S3 replication is post-sprint. The data is "a few worlds we're playing for fun" — losing it is annoying, not catastrophic. |
| Custom domain | **Railway-generated `*.up.railway.app` URL** | Domain is a v0.5 concern. Joe doesn't need a memorable URL to test. |
| Monitoring | **Railway's built-in logs + a manual `/api/usage` check** | Sentry / OTel is overkill. We'll read logs by hand if something goes wrong. |
| Branch / tag | **Merge `sprint/v0.4` → `main`, tag `v0.4.1`, deploy from `main`** | Railway should auto-deploy `main` on push. Sprint feature branches don't deploy. |

## Explicit cuts

Deferred, not deleted:

- Per-user accounts, password reset, "log out" UX
- Magic-link / OAuth / NextAuth
- Per-user world scoping, sharing model beyond "one shared password"
- Rate limiting per route or per IP (cost cap is the only limit)
- CSP, X-Frame-Options, full security header pass
- Sentry / OTel / structured error reporting
- Litestream or automated DB backups
- Custom domain, branded subdomain
- Staging environment (we deploy straight to prod, two users, the bar is low)
- Per-route auth carve-outs (entire app, including the homepage, is gated)
- A "kill switch" env var to stop accepting writes without redeploying

## Accepted tradeoffs

- **HTTP Basic auth UX is ugly.** Browser-native prompt. No log-out button — to "log out" you clear site data or use a private window. Fine for two testers, not fine for users.
- **Shared cap, not per-user.** If Andrew burns the day's tokens by 10am, Joe is locked out until UTC midnight. With two cooperative users this is a notification problem, not a fairness problem.
- **The cap counts only tokens that made it into `turns.metadata`.** A turn that errors before the `onFinish` write isn't counted. Real bill can exceed the cap by up to one turn's worth of tokens. Acceptable for the blast radius we care about.
- **Password rotation = redeploy.** Changing `APP_PASSWORD` requires updating the env var in Railway, which triggers a new deploy. Browsers cached on the old password will re-prompt. That's the rotation flow.
- **SQLite + volume locks us to one Railway instance.** No horizontal scaling. At two users this is fine forever. Switching to Turso or Postgres is the next-sprint exit ramp if we ever need it.
- **No backups beyond Railway's volume snapshots.** If the volume corrupts and the snapshot is stale, we lose recent turns. The narrative is recoverable from prose if it matters.
- **Cost-cap reset is wall-clock-UTC.** Not a rolling 24h window. Cheap to compute, slightly surprising at 23:00 UTC.
- **`/api/tts` is uncapped.** xAI TTS is ~$4.20/M chars and bounded by narrator output rate; a runaway loop costs cents. Worth knowing, not worth coding around.

## Exit criteria

- Andrew and Joe each load the Railway URL from separate machines, enter `APP_PASSWORD`, and successfully play one turn.
- A redeploy (push a no-op commit to `main`) does not lose existing turns — the SQLite file on `/data` survives.
- `/api/chat` returns 429 with a JSON error when `DAILY_TOKEN_LIMIT` is exceeded. Manually setting the limit to a low number (e.g. 1000) reproduces this; resetting it restores normal play.
- `git grep` for `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `APP_PASSWORD` finds them only in `.env.example` and the new middleware/route — never with a real value.
- `chronicles.sqlite*` and `chronicles.db` are absent from the deployed Railway filesystem under the app root (the only DB file lives at `/data/chronicles.sqlite`).
- `npm run lint` and `npm run type-check` pass on `main` at the deployed commit.
- Tag `v0.4.1` exists and points at the deployed commit.

When all seven hold, the sprint is done. The next milestone (v0.5 candidate) is the deferred `characters` table from `13-v0.4-milestone.md`, now with one piece of real two-user feedback to inform it.

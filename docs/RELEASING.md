# Releasing Chronicles AI

The authoritative release playbook. The short binding form lives in `CLAUDE.md` ("Release version bump & deploy"); this is the worked-out version the team follows.

The version is load-bearing: the header at `src/app/page.tsx:17` reads `pkg.version` from `package.json`, and that one number is the user's only at-a-glance trust signal for "what's running". Don't let it lie.

## Versioning convention (0.x scheme)

The version line was **restarted at v0.1.0 on 2026-06-05** (from the old 0.6.21 numbering). It is a plain 0.x scheme:

- **New feature → bump MINOR.** `0.1.0 → 0.2.0 → … → 0.9.0 → 0.10.0 → 0.11.0`. MINOR is a plain integer that keeps incrementing — `0.9.0` goes to **`0.10.0`**, NOT to `1.0.0`. There is no automatic roll-over.
- **Bug fix → bump PATCH.** `0.1.0 → 0.1.1 → 0.1.2`.
- **v1.0.0 is reserved.** It marks a deliberate "first stable / public release" decision made explicitly by Andrew. It is never reached by auto-increment.

### Worked examples

| Change | From | To |
|---|---|---|
| Add a feature | 0.1.0 | 0.2.0 |
| Fix a bug | 0.2.0 | 0.2.1 |
| Another fix | 0.2.1 | 0.2.2 |
| Tenth feature past 0.9 | 0.9.0 | **0.10.0** (not 1.0.0) |
| Feature after that | 0.10.0 | 0.11.0 |
| First stable / public release | (any 0.x) | **1.0.0** — Andrew's explicit call only |

## Branch / deploy model

- **`main`** — integration / default branch. All `feat/*` and `fix/*` branches PR into `main`. **`main` is NOT auto-deployed.**
- **`production`** — the dedicated deploy branch Railway (or any host) watches. It contains only released code. Railway deploys on push to `production`.

> One-time manual step: Andrew repoints Railway's watched branch from `main` to `production` himself. Do not run railway commands to do this.

### Release flow

1. Cut work on a `feat/<slug>` (feature) or `fix/<slug>` (bug fix) branch off `main`.
2. **Bump the version on that branch, before merge** (MINOR for a feature, PATCH for a fix). Never bump post-merge on `main` — that opens a window where prod could run new code under the old version string. See "Version-bump mechanics" below.
3. Open a PR into `main`; merge when green.
4. When ready to ship, **promote**: merge or fast-forward `main → production`, then push `production`.
5. Railway builds + deploys `production`. Verify (see "Verification").

### Hotfix flow

1. Branch from `production` (not `main`).
2. Fix, then **bump PATCH** on the hotfix branch.
3. Merge to **BOTH** `main` and `production` so the two branches don't diverge.
4. Push `production` to deploy; verify.

## Version-bump mechanics

Prefer `npm version`:

- `npm version minor` — feature.
- `npm version patch` — bug fix.

But **always verify the lockfile** updated in BOTH spots — `npm version` may not touch `package-lock.json` reliably:

- top-level `"version"`, and
- the entry under `"packages": { "": { ... } }`.

Both `package.json` and `package-lock.json` go in a **single commit**. Don't rely on a later `npm install` to repair the lockfile.

## Release notes ("What's New")

The header version chip is clickable and opens a player-facing "What's New" dialog
(v0.3.0+). Its content is a hand-authored, static module:
`packages/server/src/components/release-notes/data.ts`.

**Every bump prepends a `RELEASES` entry** (`{ version, date, highlights }`,
newest-first) with plain-language, player-facing highlights — no `depcruise`,
"use case", or other dev jargon. This mirrors the "bump the version" discipline:
the header→notes link goes stale the moment a version ships without an entry. Goes
in the same release branch, ideally the same commit as the version bump.

## Verification

- **Dev server.** Next.js does not HMR module-level JSON imports — the cached `pkg` object persists until the process restarts. After bumping, kill `npm run dev`, start it again, and visually confirm the header on `/` shows the new version.
- **Railway.** A push to `production` triggers a redeploy (required for the new version to take effect). After it deploys, confirm the header in prod shows the new version.
- If the header ever shows a different version than `package.json` on disk, the dev server (or deploy) is stale — restart / redeploy.

## Milestone docs

Each version has a milestone doc under `docs/plans/milestones/`. The template (`docs/plans/_template-milestone.md`) carries the version-bump and promotion exit criteria — keep that pattern: "version bumped on the release branch per `docs/RELEASING.md`; promoted to `production` to deploy".

> **Caveat — pre-restart milestone docs.** `docs/plans/milestones/` already contains `v0.1.0`–`v0.6.x` docs from the **pre-restart** numbering. They stay as historical record (other docs and project memory reference them) — **do NOT move or rename them.** New, post-restart milestone docs must disambiguate by carrying a **date prefix** in the filename, e.g. `2026-06-05-v0.2.0-<slug>.md`, so a new `v0.2.0` never clobbers the old `v0.2.0.md`.

See also: `CLAUDE.md` → "Release version bump & deploy".

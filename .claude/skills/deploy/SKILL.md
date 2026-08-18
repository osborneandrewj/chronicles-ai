---
name: deploy
description: Release and deploy Chronicles AI. Follow docs/RELEASING.md. Use only when the user asks to bump a version, promote to production, or deploy.
disable-model-invocation: true
---

# Deploy

Authoritative playbook: `docs/RELEASING.md`. There is no `npm run deploy`, no `staging` branch, and no health-check script. Do not invent them.

`main` is integration and is **not** auto-deployed. Railway deploys on push to `production`.

## Confirm first

Still confirm before `git push`, `railway redeploy` / `down` / `delete`, or anything that posts to GitHub. Do not bump a version or open a PR unless this invocation asked for it.

## Version bump (on the feature branch, before merge)

- Feature → MINOR (plain integer; `0.9.0` → `0.10.0`, never auto-roll to `1.0.0`). Fix → PATCH. `v1.0.0` is Andrew's explicit call only.
- Bump root + `@chronicles/server` + `@chronicles/contracts` + `package-lock.json` (top-level `"version"` and `"packages": { "": … }`) in one commit.
- Prepend a player-facing entry to `packages/server/src/components/release-notes/data.ts`.
- Restart `npm run dev` and confirm the header on `/` matches `packages/server/package.json`. Next does not HMR `package.json` imports.

Do not write a version number into `AGENTS.md`.

## Promote to production

1. Working tree clean; `npm test` and `npm run type-check` green on the commit you are promoting.
2. Merge or fast-forward `main` → `production`, then push `production`. That is the deploy.
3. Confirm the prod header shows the new version.

Hotfix: branch from `production`, bump PATCH, merge to **both** `main` and `production`.

Andrew repoints Railway's watched branch himself. Do not run railway commands for that.

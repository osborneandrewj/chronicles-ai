---
name: deploy
description: Deploy the application to a target environment. Runs pre-flight checks, builds, and deploys.
disable-model-invocation: true
arguments: [environment]
---

Deploy to **$ARGUMENTS** environment.

## Current State
!`git status --short`

## Pre-flight Checks

1. Verify working tree is clean — no uncommitted changes
2. Run linting: `npm run lint`
3. Run type checking: `npm run type-check`
4. Run test suite: `npm test`
5. Verify on correct branch:
   - `staging` — any branch
   - `production` — `main` branch only

## Build

1. Run `npm run build`
2. Verify build output exists and has no errors

## Deploy

1. Run `npm run deploy:$ARGUMENTS`
2. Monitor deployment output for errors
3. Run smoke tests if available: `npm run test:smoke -- --env=$ARGUMENTS`

## Post-Deploy Verification

1. Confirm health check endpoint returns 200
2. Verify key functionality is operational
3. Report deployment status

## Rollback

If deployment fails:
1. Run `npm run deploy:rollback -- --env=$ARGUMENTS`
2. Verify rollback succeeded
3. Report failure details for debugging

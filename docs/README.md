# Chronicles AI — Docs

This directory is the canonical record of how Chronicles AI is built and how it has evolved. Two kinds of doc live here:

1. **Design docs** (`01`–`09`) describe the long-term target architecture. They are written ahead of the code and updated when decisions change.
2. **Milestone docs** (`10` onwards) describe individual versions: what shipped, why, and what was cut. Every release gets one. Patch releases get a short one; majors get a full one. New milestone docs should follow [`_template-milestone.md`](_template-milestone.md).

When working on a feature, read the relevant design doc first and the most recent milestone doc to understand the current state of the world.

## Design docs

| # | Doc | What it covers |
|---|---|---|
| 01 | [system-architecture](01-system-architecture.md) | Top-level structure, project layout, runtime topology |
| 02 | [database-design](02-database-design.md) | Full schema (the target — current state lives in `src/lib/migrations.ts`) |
| 03 | [agent-system-design](03-agent-system-design.md) | Narrator / archivist / compiler / linter agent roster |
| 04 | [memory-architecture](04-memory-architecture.md) | Memory chunks, retrieval, embeddings (Phase 2+) |
| 05 | [api-design](05-api-design.md) | Streaming and CRUD route shapes, AI SDK conventions |
| 06 | [frontend-architecture](06-frontend-architecture.md) | App Router layout, Server vs. Client component boundary |
| 07 | [implementation-roadmap](07-implementation-roadmap.md) | Phased plan; what's in flight |
| 08 | [development-setup](08-development-setup.md) | Local dev, env vars, Docker, migrations |
| 09 | [example-chat-narrative](09-example-chat-narrative.md) | Reference narrative used as a fixture/regression target |

## Milestone docs

Listed in shipping order. Tags on `main` correspond to the row's version unless noted.

| # | Version | Doc | Date | Headline |
|---|---|---|---|---|
| 10 | MVP sprint | [mvp-sprint](10-mvp-sprint.md) | 2026-04 | Streaming chat + persisted turns, one table |
| 11 | v0.2.0 | [v0.2-milestone](11-v0.2-milestone.md) | 2026-05 | Per-turn quality: classifier, retry, cost ribbon |
| 12 | v0.3.0 | [v0.3-milestone](12-v0.3-milestone.md) | 2026-05 | `worlds` table; multi-world UI |
| 13 | v0.4.0 | [v0.4-milestone](13-v0.4-milestone.md) | 2026-05 | xAI TTS narration sentence-by-sentence |
| 14 | v0.4.1 | [deploy-sprint](14-deploy-sprint.md) | 2026-05 | Railway deploy + Basic-auth gate (later replaced by Cloudflare Access) |
| 15 | v0.5.0 | [v0.5.0-milestone](15-v0.5.0-milestone.md) | 2026-05-25 | Cloudflare Access + working-autonomy notes. Typed-state work planned but unshipped — see doc |
| 16 | v0.5.1 | [v0.5.1-audio-chunking](16-v0.5.1-audio-chunking.md) | 2026-05-25 | Paragraph-chunked TTS |
| 17 | v0.5.1 debug | [narrator-audio-autoplay-debug](17-narrator-audio-autoplay-debug.md) | 2026-05-25 | iOS autoplay postmortem (Web Audio API fix) |
| 18 | v0.4.2 | [v0.4.2-patch](18-v0.4.2-patch.md) | 2026-05-23 | Railway build-phase fixes (DB skip, prerender) — backfilled doc |
| 19 | v0.5.2 | [v0.5.2-patch](19-v0.5.2-patch.md) | 2026-05-25 | Docs canon: README + milestone template + v0.5.0/v0.4.2 backfills + memory + parked branch rescue |
| 20 | v0.6.0 | [v0.6.0-milestone](20-v0.6.0-milestone.md) | 2026-05-25 | Typed world-state (characters/places/scenes) + archivist patch pipeline + inspector. Rebased from the parked save/v0.5-typed-state with three audit-driven mitigations |
| 21 | v0.6.1 | [v0.6.1-milestone](21-v0.6.1-milestone.md) | TBD (planning) | Narrator prose tuning + NPC active goals + v0.6.0 audit bug fixes (cost-cap drift, TTS world-binding, chat JSON parsing, detached archivist, history pagination) |
| 22 | v0.6.2 | [v0.6.2-milestone](22-v0.6.2-milestone.md) | TBD (planning) | Mobile + desktop UI pass and replay-cost-footer bug from the v0.6.0 smoke test |

## Conventions

- **Filename is `NN-<slug>.md`.** `NN` is sequential in the order the doc was written, not in version order. Don't renumber existing files.
- **One doc per shipped version.** Even tiny patches get a short doc. The cost of skipping (see v0.5.0 / v0.4.2 backfills) is reconstructing the release later from `git log` and tag annotations.
- **Backfilled docs are flagged.** If a doc was written after the fact, say so at the top. Be honest about what's reconstructed from git vs. remembered.
- **Use the template.** New milestone docs start by copying [`_template-milestone.md`](_template-milestone.md). The Decisions table and Exit criteria are the load-bearing sections.
- **Design docs describe the target.** When a design doc and the code disagree, the code is reality and the design doc needs an update — not the other way around.

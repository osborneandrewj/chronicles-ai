# Chronicles AI — Docs

This directory is the canonical record of how Chronicles AI is built and how it has evolved. Docs are split by **what kind of thing they are**, not by date:

```
docs/
  specs/        Evergreen design — how the system is meant to work. Written ahead of code, updated when decisions change.
  plans/        Point-in-time plans — the roadmap and one milestone doc per release (what shipped, why, what was cut).
  reference/    Guides, fixtures, and postmortems — setup, the example narrative, debug write-ups, design evaluations.
```

When working on a feature: read the relevant **spec** first, then the most recent **milestone** in `plans/milestones/` to understand the current state of the world. When a spec and the code disagree, the code is reality and the spec needs updating — not the other way around.

## `specs/` — design

| Doc | What it covers |
|---|---|
| [system-architecture](specs/system-architecture.md) | Top-level structure, project layout, runtime topology |
| [database-design](specs/database-design.md) | Full schema (the target — current state lives in `src/lib/migrations.ts`) |
| [agent-system-design](specs/agent-system-design.md) | Narrator / archivist / compiler / linter agent roster |
| [memory-architecture](specs/memory-architecture.md) | Memory chunks, retrieval, embeddings (Phase 2+) |
| [api-design](specs/api-design.md) | Streaming and CRUD route shapes, AI SDK conventions |
| [frontend-architecture](specs/frontend-architecture.md) | App Router layout, Server vs. Client component boundary |
| [npc-narrator-runtime](specs/npc-narrator-runtime.md) | Current SQLite schema and the runtime contract between NPCs, the NPC agent, narrator, and archivist (current-state reference) |

## `plans/` — roadmap & milestones

- [roadmap](plans/roadmap.md) — phased plan; what's in flight.
- [_template-milestone](plans/_template-milestone.md) — copy this to start a new milestone doc. The Decisions table and Exit criteria are the load-bearing sections.

Milestones live in [`plans/milestones/`](plans/milestones/), one per release, named by version so they sort by semver. Tags on `main` correspond to the version unless noted.

| Version | Doc | Date | Headline |
|---|---|---|---|
| MVP sprint | [mvp-sprint](plans/milestones/mvp-sprint.md) | 2026-04 | Streaming chat + persisted turns, one table |
| v0.2.0 | [v0.2.0](plans/milestones/v0.2.0.md) | 2026-05 | Per-turn quality: classifier, retry, cost ribbon |
| v0.3.0 | [v0.3.0](plans/milestones/v0.3.0.md) | 2026-05 | `worlds` table; multi-world UI |
| v0.4.0 | [v0.4.0](plans/milestones/v0.4.0.md) | 2026-05 | xAI TTS narration sentence-by-sentence |
| v0.4.1 | [v0.4.1-deploy-sprint](plans/milestones/v0.4.1-deploy-sprint.md) | 2026-05 | Railway deploy + Basic-auth gate (later replaced by Cloudflare Access) |
| v0.4.2 | [v0.4.2](plans/milestones/v0.4.2.md) | 2026-05-23 | Railway build-phase fixes (DB skip, prerender) — backfilled doc |
| v0.5.0 | [v0.5.0](plans/milestones/v0.5.0.md) | 2026-05-25 | Cloudflare Access + working-autonomy notes. Typed-state work planned but unshipped — see doc |
| v0.5.1 | [v0.5.1-audio-chunking](plans/milestones/v0.5.1-audio-chunking.md) | 2026-05-25 | Paragraph-chunked TTS |
| v0.5.2 | [v0.5.2](plans/milestones/v0.5.2.md) | 2026-05-25 | Docs canon: README + milestone template + v0.5.0/v0.4.2 backfills + memory + parked branch rescue |
| v0.6.0 | [v0.6.0](plans/milestones/v0.6.0.md) | 2026-05-25 | Typed world-state (characters/places/scenes) + archivist patch pipeline + inspector |
| v0.6.1 | [v0.6.1](plans/milestones/v0.6.1.md) | TBD (planning) | Narrator prose tuning + NPC active goals + v0.6.0 audit bug fixes |
| v0.6.2 | [v0.6.2](plans/milestones/v0.6.2.md) | TBD (planning) | Narrative style pass — voice/tone, dialogue formatting, scene-shape, POV/tense/address |
| v0.6.3 | [v0.6.3](plans/milestones/v0.6.3.md) | TBD (planning) | iOS / desktop Safari audio fix — focused patch on `useNarratorAudio.ts` |
| v0.6.4 | [v0.6.4](plans/milestones/v0.6.4.md) | TBD (planning) | Story-dossier memory — threads, clues, objectives, resources, hidden pressure |
| v0.6.5 | [v0.6.5](plans/milestones/v0.6.5.md) | TBD (planning) | Mobile + desktop UI pass + replay-cost-footer bug |
| v0.6.6 | [v0.6.6](plans/milestones/v0.6.6.md) | TBD (planning) | Archivist character canonicalization — short vs full name no longer duplicates rows |
| v0.6.9 | [v0.6.9](plans/milestones/v0.6.9.md) | TBD (planning) | NPC/Narrator v2 intent audit — persist agent-tier planned actions, reconcile against narrator prose |
| v0.6.10 | [v0.6.10](plans/milestones/v0.6.10.md) | 2026-05-28 | Self-healing scene-transition invariant — infer player+cursor move from relocated NPC cluster; fixes the Call-In snap-back |

## `reference/`

| Doc | What it covers |
|---|---|
| [development-setup](reference/development-setup.md) | Local dev, env vars, Docker, migrations |
| [example-chat-narrative](reference/example-chat-narrative.md) | Reference narrative used as a fixture/regression target |
| [narrator-audio-autoplay-debug](reference/narrator-audio-autoplay-debug.md) | iOS autoplay postmortem (Web Audio API fix), v0.5.1 |
| [npc-narrator-design-evaluation-v2](reference/npc-narrator-design-evaluation-v2.md) | Design evaluation behind the NPC/narrator runtime |
| [westworld-style-shared-world-design](reference/westworld-style-shared-world-design.md) | Exploration notes for shared parks: world seeding, geography, maps, multiplayer scenes, hidden human/NPC control, and player adaptation |

## Conventions

- **Three folders, by kind.** A doc that describes how the system works lives in `specs/`. A doc tied to a specific release lives in `plans/milestones/`. A guide, fixture, or postmortem lives in `reference/`.
- **Milestones are named by version** (`vX.Y.Z.md`, with an optional `-slug` for sprints/patches), so they sort by semver. `mvp-sprint.md` predates versioning and sorts first.
- **One doc per shipped version.** Even tiny patches get a short doc. The cost of skipping (see the v0.5.0 / v0.4.2 backfills) is reconstructing the release later from `git log` and tag annotations.
- **Backfilled docs are flagged.** If a doc was written after the fact, say so at the top. Be honest about what's reconstructed from git vs. remembered.
- **Use the template.** New milestone docs start by copying [`plans/_template-milestone.md`](plans/_template-milestone.md).
- **Specs describe the target.** When a spec and the code disagree, the code is reality and the spec needs an update — not the other way around.

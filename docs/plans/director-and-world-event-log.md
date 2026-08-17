# Director + World Event Log

**Status:** in progress (slice 5)
**Trigger:** narrator is the implicit plot brain; other agents reconstruct after the fact.
**Related:** [`living-world-roadmap.md`](./living-world-roadmap.md) (director depth), [`story-agency-latency-improvements.md`](./story-agency-latency-improvements.md) (A1 ranker shipped), [`plot-lifecycle-continuity.md`](./plot-lifecycle-continuity.md).

## Diagnosis

Control is inverted. The narrator invents plot motion, complications, dialogue, and often whether a thread advances. The archivist, reconciler, and living tick reconstruct afterward. The shipped `decideDirector` is a **ranker** (one foreground, phase, soft guidance). It does not produce a binding beat, assign NPC roles, or persist.

Target order:

```
player action → classify → director BeatBrief → NPC agent fills slots
  → narrator renders → world_events commit → archivist residual only
```

## Names (do not merge)

| Job | Owner |
|---|---|
| Showrunner (which thread, beat kind, close vs open, who is on stage) | **Director** |
| Referee (did the asserted outcome happen?) | Classifier now; Conductor later — separate |
| Character psychology (what this person does in their slot) | NPC agent |
| Prose | Narrator |
| Residual facts | Archivist |
| Coordination truth | `world_events` log, not a pub/sub bus |

Do not reuse `timeline_events` (player-facing milestones). Do not put an LLM director on the critical path. Do not dump the event log into the narrator's 20-row prose window.

## Slices

1. **BeatBrief contract** (shipped locally) — `beatKind`, `mustStage`, `mustNot`, `cast[]`. Pure/deterministic. Narrator treats MUST STAGE like planned moves. Stamp on turn metadata.
2. **`world_events` + port** (shipped locally) — first writers: director, reconciler.
3. **Director drives plan-cast** (shipped locally) — NPC agent fills assigned slots only.
4. **Commit plot lifecycle from events** (shipped locally) — close from brief + confirmation, not Haiku hope.
5. **Gated `DirectorDecisionPort`** (this slice) — post-stream, writes pending beat for *next* turn.
6. **Conductor** (later) — `lastResolvedOutcome`. Not part of director.

## Slice 1 done means

A streamed turn whose narrator metadata includes a BeatBrief and whose `## DIRECTOR` block has binding MUST STAGE / MUST NOT / CAST lines. No new pre-stream LLM. No version bump until a later ship train.

## Slice 2 done means

`world_events` exists on both stores. Director writes `BEAT_DIRECTED` and the reconciler writes `NPC_STAGED` / `NPC_MODIFIED` / `NPC_IGNORED`. Inspector Story tab lists the last 20. Narrator prompt unchanged. No version bump.

## Slice 3 done means

Director runs before the NPC agent. `selectPlanEligibleCast` keeps initiate/react/arrive (plus open-order) and drops background. Agent context includes `director_slot`. No new pre-stream LLM. No version bump.

## Slice 4 done means

When the BeatBrief asks to close and prose (or a staged close beat) confirms, suggested active threads/objectives are committed through `applyArchivistPatch` (hygiene included). `THREAD_CLOSED` / `OBJECTIVE_COMPLETED` land on `world_events`. Close-bias Haiku is skipped if this pass already closed. No version bump.

## Slice 5 done means

`worlds.director_state_json` exists. A gated Haiku `DirectorDecisionPort` runs post-stream (background) on stall / climax / empty dossier / cast collision, with a 3-turn cooldown. Next turn's `decideDirector` consumes the pending beat unless the player engages a different thread. No pre-stream LLM. No version bump.

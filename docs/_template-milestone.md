# vX.Y[.Z] Milestone

**Target**: YYYY-MM-DD
**Bar**: "One sentence in the voice of a player or developer: what should be true at the end of this milestone that isn't true now."
**Budget**: ~N hours of focused work.

One paragraph that situates this version in the lineage — what shipped just before, what this adds, what stays deferred. Be honest about scope. If this is a patch, say so; if a major opens new schema, say so.

## Why

The motivating problems, listed as a small numbered list. One sentence each. The reader should be able to skip the rest of the doc and still understand why this work exists.

1. **Problem one.** Concrete description, in product or user terms.
2. **Problem two.** Why the current code can't solve it without this change.
3. **Problem three.** Optional.

## Scope

One paragraph stating the structural shape: how many tables / routes / new files. Then the file list.

```
schema:
  new_table(cols…)
  existing_table  + new_column

routes:
  METHOD /path                → purpose

env:
  NEW_VAR                     purpose, server-only?
```

### Files

```
src/path/file.ts              NEW / EDIT / DELETE. One-line description of what changes.
…
```

If schema changes, embed the SQL of the migration here as a code block. Reviewers should be able to see the new columns and indexes without leaving the doc.

## Decisions

A table of every non-obvious choice you made, with rationale. Reviewers should be able to push back on any row without reading the code.

| Decision | Choice | Rationale |
|---|---|---|
| What had to be decided | What was picked | Why this and not the alternatives |
| … | … | … |

## Architecture sketch

Optional ASCII diagram, only if the data flow is non-obvious. Skip for patches.

```
component A ──▶ component B
                    │
                    ▼
                component C
```

## Explicit cuts

Everything intentionally not in this version, with one line each saying when it'll come. Keeps the reader from assuming features were forgotten.

- Feature X — deferred to vN.M
- Feature Y — out of scope; tracked separately

## Accepted tradeoffs

The costs of the choices above, stated honestly. Should match the Decisions table — if a row says "we picked X to keep this simple", a tradeoffs bullet should say what gets worse as a result.

- **Tradeoff name.** Concrete description of what's now worse and by how much. Why it's tolerable.
- **Tradeoff name.** …

## Exit criteria

A numbered list of testable conditions. When all of them are true, the milestone ships and gets tagged. Avoid vague items like "looks good" — every item should have a clear pass/fail.

1. `npm run lint` and `npm run type-check` pass.
2. `npm test` passes (including any new tests this version adds).
3. Specific behavioural check in `npm run dev` — describe the exact action and the expected observation.
4. Deploy → production smoke test — Andrew + Joe each verify something concrete.
5. Tag `vX.Y[.Z]` on `main`.

When all N hold, vX.Y[.Z] ships. The next milestone is sketched in [a one-liner pointing at the next doc].

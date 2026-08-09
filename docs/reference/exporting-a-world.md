# Exporting a world from production

How to pull a single world — its full play history, cast, places, and story dossier — out of the production database and onto a local machine, for inspection, repro, or archival.

Audience: anyone (human or agent) asked to "download the remote world X" or "grab a prod world for debugging."

## The one rule: never handle the connection string

Production credentials live in Railway. They are **not** in any file you should read.

- **Do not** read, `cat`, or `grep` `.env.local` — it is local-only and points at local Mongo anyway, not production. Repo permissions deny reading it, and that denial is intentional.
- **Do not** fetch the production `DATABASE_URL` via `railway variables`, the Railway MCP `list_variables` tool, or the dashboard, and then paste it into a command. That puts a live production credential into shell history, process listings, and the conversation transcript.
- **Do** use `railway run`, which injects the service's environment into a local process. The script reads `process.env.DATABASE_URL`; the secret never becomes visible text.

```bash
railway run --service chronicles-ai node packages/server/scripts/export-world-mongo.mjs \
  --name "World Name Here" \
  --out "backups/world-name-prod-$(date +%Y%m%d-%H%M%S).json"
```

That single command is the whole procedure. Everything below is context for when it doesn't behave.

## Prerequisites

- The Railway CLI, linked to the project. `railway status` should report project `sweet-courage`, environment `production`, service `chronicles-ai`. If it doesn't, ask Andrew to link it — do not `railway link` blind.
- Nothing else. The Mongo shell tools (`mongodump`, `mongosh`, `mongoexport`) are **not** installed locally and are not needed; the script uses the `mongodb` driver already in `node_modules`.

## What the export contains

`packages/server/scripts/export-world-mongo.mjs` is the Mongo sibling of `copy-world.mjs`'s `export` mode. It:

- resolves the world by `--name` (exact match) or `--id`, erroring with the full world list if the name misses and demanding `--id` if the name is ambiguous;
- **discovers collections at runtime** rather than hardcoding them — every collection holding at least one doc with a matching `worldId`, plus the `worlds` doc. This stays correct as the schema drifts, so do not "helpfully" replace it with a fixed list;
- skips `tts_audio_cache` (a regenerable TTS cache, not story state) and `counters` (global, not world-scoped);
- writes **EJSON** (`EJSON.stringify(..., { relaxed: false })`) so `Date` and `ObjectId` values round-trip losslessly. Parse it back with `EJSON.parse` from the `bson` package, **not** `JSON.parse`, or every date silently becomes a `{ $date: ... }` object.

It opens no write path and never mutates the source. Running it against production is a read-only action and needs no confirmation.

## Verify before declaring done

An export that wrote a file is not necessarily an export that captured the world. Check:

```bash
node -e "
const {EJSON}=require('bson');const fs=require('fs');
const p=EJSON.parse(fs.readFileSync('backups/<file>.json','utf8'));
const t=p.collections.turns;
console.log('world:',p.sourceWorldName,'#'+p.sourceWorldId,'db:',p.exportedFromDb);
console.log('turns:',t.length,'seq',Math.min(...t.map(x=>x.seq)),'->',Math.max(...t.map(x=>x.seq)));
console.log('roles:',JSON.stringify(t.reduce((a,x)=>(a[x.role]=(a[x.role]||0)+1,a),{})));
"
```

Sanity checks worth making, and what a failure means:

- **Turn count vs. seq range.** Gaps are normal — a rewound or deleted turn removes a `user`/`assistant` pair — but report them rather than glossing over them. A *large* gap means something else.
- **`user` and `assistant` counts within one of each other.** A big skew suggests a partial export.
- **`turns` is non-empty.** An empty or tiny world is usually the wrong world, or the wrong database.

## Known gotchas

- **The production database is named `test`.** The prod `DATABASE_URL` carries no database name in its path, so the driver falls back to Mongo's default. The app does the same (`connection.ts` passes the URL straight to `mongoose.createConnection` with no `dbName`), so app and script agree — but if you ever see `exportedFromDb` come back as something other than `test`, stop and ask before trusting the file.
- **`backups/` is gitignored.** Exports stay local by design. Never commit one — worlds contain full play transcripts. For the same reason, do not put documentation in `backups/`; it won't reach anyone else.
- **The script is export-only.** There is no Mongo import counterpart yet. This produces a snapshot for reading, not a restore path. Loading one back into a local Mongo means writing that importer — `copy-world.mjs`'s `import` mode is the model to follow (two-pass insert, id remapping, FK re-check).
- **`--name` is exact and case-sensitive.** A miss prints every world in the database; read that list rather than guessing at variations.

## The legacy SQLite path

`packages/server/scripts/copy-world.mjs` does the same job for SQLite, in both directions (`export` / `import`), including id remapping so a world can land in a database that already has unrelated worlds.

It is **not** the tool for production. Production runs `PERSISTENCE=mongo`; the SQLite prod database at `/data/chronicles.sqlite` is a historical artifact. Reach for `copy-world.mjs` only when both sides of the copy are genuinely SQLite — an old backup under `backups/`, or a local database from before the Mongo cutover.

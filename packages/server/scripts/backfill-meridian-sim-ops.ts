// IDEMPOTENT data repair for local Meridian Directive ↔ Sequence Vigil.
//
// After a false-positive death exit (NPC dialogue "you die with him"), the session
// returned to the hub via returnToHub but never wrote a SimRunReport, player model,
// or antagonist link. Staff "know" Vigil only via player debrief improv.
//
// This script, through real ports:
//   1. Upserts a compact SimRunReport (hub  Meridian ← sub Sequence Vigil)
//   2. Refreshes hub player_model_json from that report
//   3. Ensures the meta-story antagonist is a real character (Lira Voss)
//   4. Stamps operator clearance on core vault staff so index/logs can inject
//
// Run (local Mongo — the live Meridian store):
//   PERSISTENCE=mongo \
//   DATABASE_URL='mongodb://localhost:27017/chronicles?replicaSet=rs0' \
//   npx tsx --conditions=react-server packages/server/scripts/backfill-meridian-sim-ops.ts
//
// Safe to re-run: report upsert is unique on (hub, subworld); antagonist ensure
// is idempotent; clearance stamps are set-only.

import { ensureHubAntagonist } from '@/application/use-cases/ensure-hub-antagonist'
import { initContainer } from '@/composition/container'
import type { PlayerModel, SimRunReportUpsert } from '@/domain/entities'
import { refreshPlayerModelFromReport } from '@/domain/services/player-model'
import { compactSimRunReport } from '@/domain/services/sim-run-report'

const HUB_NAME = 'The Meridian Directive'
const SUB_NAME = 'Sequence Vigil'

/** Source turn that carried subworld_exit metadata (Sequence Vigil seq 891). */
const EXIT_SOURCE_TURN_ID = 891

function parsePlayerModel(raw: string | null): PlayerModel | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as PlayerModel
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  console.log(`[backfill] PERSISTENCE=${process.env.PERSISTENCE ?? '(default sqlite)'}`)
  const container = await initContainer()
  const { worlds, characters, places, simRuns, turns, dossiers } = container

  const summaries = await worlds.listWorlds()
  const hubSummary = summaries.find((w) => w.name === HUB_NAME)
  const subSummary = summaries.find((w) => w.name === SUB_NAME)
  if (!hubSummary || !subSummary) {
    console.error(
      `[backfill] Need both "${HUB_NAME}" and "${SUB_NAME}". Seen: ` +
        summaries.map((w) => `${w.id}:${w.name}`).join(', '),
    )
    process.exit(1)
  }

  const hubId = hubSummary.id
  const subId = subSummary.id
  console.log(`[backfill] hub=${hubId} (${HUB_NAME}) sub=${subId} (${SUB_NAME})`)

  const hub = await worlds.getWorld(hubId)
  const sub = await worlds.getWorld(subId)
  if (!hub || hub.world_layer !== 'hub') {
    console.error(`[backfill] hub world missing or not world_layer=hub`)
    process.exit(1)
  }
  if (!sub || sub.world_layer !== 'subworld') {
    console.error(`[backfill] sub world missing or not world_layer=subworld`)
    process.exit(1)
  }

  // --- 1. SimRunReport (richer than pure death_exit — exit was a false positive) ---
  const existingReport = await simRuns.bySubworld(hubId, subId)
  if (existingReport) {
    console.log(
      `[backfill] Report already exists id=${existingReport.id} status=${existingReport.status} — will refresh player model only if needed`,
    )
  }

  const recent = await turns.recentTurns(subId, 12)
  const placeRows = await places.forWorld(subId)
  const placeNames = placeRows.map((p) => p.name).filter(Boolean)
  const dossier = await dossiers.forWorld(subId)
  const resolvedThreads = dossier.threads
    .filter((t) => t.status === 'resolved' || t.status === 'failed')
    .map((t) => `${t.title} (${t.status})`)
  const activeThreads = dossier.threads
    .filter((t) => t.status === 'active')
    .map((t) => t.title)
  const npcs = (await characters.forWorld(subId))
    .filter((c) => c.is_player !== 1)
    .map((c) => c.name)
    .slice(0, 6)

  // Historical metadata said death_exit, but prose was NPC threat-speech; classify
  // as aborted early surface so hub staff do not treat Andrew as in-sim dead.
  const reportInput: SimRunReportUpsert = compactSimRunReport({
    hub_world_id: hubId,
    subworld_id: subId,
    codename: SUB_NAME,
    genre_tags: ['egypt', 'thebes', 'historical'],
    status: 'aborted',
    headline: 'Sequence Vigil closed early; subject returned to hub (exit detector).',
    summary: [
      'Egypt / Thebes immersion (Sequence Vigil) terminated mid-session when the subject',
      'was pulled back to the facility. Closing fiction involved Merit-who-tends, oath-binding',
      'pressure, and a push toward the western tombs — not an archivist-confirmed subject death.',
      resolvedThreads.length
        ? `Resolved in-sim: ${resolvedThreads.join('; ')}.`
        : '',
      activeThreads.length
        ? `Still open at exit: ${activeThreads.slice(0, 3).join('; ')}.`
        : '',
      placeNames.length
        ? `Locales: ${placeNames.slice(0, 5).join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    outcomes: [
      'Subject returned to Meridian hub (session in_hub, has_awoken)',
      resolvedThreads[0] ?? 'No resolved threads recorded at exit',
      'Early exit — not a clean protocol completion',
    ],
    anomalies: [
      'Exit trigger was narrative death-pattern match (later classified false positive on NPC dialogue)',
      'Subject reported cross-sim continuity (Merit) after return',
    ],
    persons_of_interest: npcs.filter((n) => /merit|setnakht|lady|priest/i.test(n)).slice(0, 4),
    min_clearance: 'operator',
    source_turn_id: EXIT_SOURCE_TURN_ID,
  })

  const report = await simRuns.upsertByRun(reportInput)
  console.log(
    `[backfill] SimRunReport id=${report.id} status=${report.status} clearance=${report.min_clearance}`,
  )
  console.log(`[backfill]   headline: ${report.headline}`)

  // --- 2. Player model ---
  const priorModel = parsePlayerModel(hub.player_model_json)
  const updatedAt = new Date().toISOString()
  const nextModel = refreshPlayerModelFromReport({
    prior: priorModel,
    hubWorldId: hubId,
    report,
    // Treat as awakening/surface for model stance (player is alive on hub).
    exitKind: 'awakening',
    updatedAt,
  })
  // Annotate the false-positive so antagonist intel is honest.
  nextModel.antagonist_beliefs = [
    ...nextModel.antagonist_beliefs,
    'Subject survived Sequence Vigil despite early pull; may remember Merit across cycles',
  ].slice(0, 3)
  nextModel.open_goals = [
    ...nextModel.open_goals,
    'Cross-check Merit authorization gaps across Athens and Egypt cycles',
  ].slice(0, 3)
  await worlds.setPlayerModel(hubId, JSON.stringify(nextModel))
  console.log(`[backfill] PlayerModel written (stance=${nextModel.stance_toward_program})`)

  // --- 3. Antagonist (Lira Voss from meta-story) ---
  const antagonistId = await ensureHubAntagonist(hubId, { worlds, characters, places })
  if (antagonistId == null) {
    console.warn('[backfill] ensureHubAntagonist returned null — bible may lack antagonist prose')
  } else {
    const cast = await characters.forWorld(hubId)
    const ant = cast.find((c) => c.id === antagonistId)
    console.log(
      `[backfill] Antagonist id=${antagonistId} name=${ant?.name ?? '?'} clearance=${ant?.clearance_level ?? '?'}`,
    )
  }

  // --- 4. Operator clearance for vault-facing staff (so sim index is usable) ---
  const cast = await characters.forWorld(hubId)
  const operatorNames = new Set(['k. reyes', 'dana noel', 'jamie pryce', 'ellis shaw'])
  for (const c of cast) {
    if (c.is_player === 1) continue
    if (c.id === antagonistId) continue // already antagonist
    if (!operatorNames.has(c.name.toLowerCase())) continue
    if (c.clearance_level === 'operator' || c.clearance_level === 'classified') {
      console.log(`[backfill] clearance skip ${c.name} (already ${c.clearance_level})`)
      continue
    }
    await characters.setClearanceLevel(c.id, 'operator')
    console.log(`[backfill] clearance operator → ${c.name}`)
  }

  // --- Verify ---
  const verifyReport = await simRuns.bySubworld(hubId, subId)
  const verifyHub = await worlds.getWorld(hubId)
  console.log('[backfill] VERIFY')
  console.log(`  report: ${verifyReport ? `id=${verifyReport.id}` : 'MISSING'}`)
  console.log(`  antagonistCharacterId: ${verifyHub?.antagonist_character_id ?? 'null'}`)
  console.log(`  playerModel: ${verifyHub?.player_model_json ? 'set' : 'null'}`)
  console.log('[backfill] done')
  // Mongoose keeps the event loop open; force exit after successful write.
  process.exit(0)
}

main().catch((err) => {
  console.error('[backfill] failed', err)
  process.exit(1)
})

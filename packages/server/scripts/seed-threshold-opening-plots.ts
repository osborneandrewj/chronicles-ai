// Idempotent local repair for "Project THRESHOLD": take The Clawing Arm off
// the season floor, revive the Latin/Rome mystery, close isolation-protocol
// clones, and seed Booker-shaped opening threads (program antagonist,
// sessions, Jordan) if missing.
//
//   PERSISTENCE=mongo \
//   DATABASE_URL='mongodb://localhost:27017/chronicles?replicaSet=rs0' \
//   npx tsx --conditions=react-server packages/server/scripts/seed-threshold-opening-plots.ts
//
// Back up story_threads / story_objectives first.

import { initContainer } from '@/composition/container'
import { serializeDirectorState } from '@/domain/services/director-state'

const WORLD_NAME = 'Project THRESHOLD'

async function main(): Promise<void> {
  console.log(`[seed] PERSISTENCE=${process.env.PERSISTENCE ?? '(default sqlite)'}`)
  const container = await initContainer()
  const { worlds, dossiers, dossierWriter, characters } = container

  const summaries = await worlds.listWorlds()
  const target = summaries.find((w) => w.name.toLowerCase() === WORLD_NAME.toLowerCase())
  if (!target) {
    console.error(
      `[seed] No world named "${WORLD_NAME}". Seen: ` +
        summaries.map((w) => `${w.id}:${w.name}`).join(', '),
    )
    process.exit(1)
  }
  const worldId = target.id
  console.log(`[seed] Resolved "${target.name}" → world id ${worldId}`)

  await resolveClawingArm(worldId, dossierWriter)
  await reviveRomeMystery(worldId, dossierWriter)
  await ensureThread(worldId, dossierWriter, {
    title: 'What the Sessions Are For',
    kind: 'mystery',
    summary:
      'The isolation runs and deep sessions send Andrew into other lives; Rome has already spoken through him, and something from those crossings does not stay put.',
    stakes:
      'If he treats this as only a medical tremor, he will not know which memories — or which orders — are his.',
    consequences: 'Another session without answers risks a deeper takeover, not just another spasm.',
    hidden:
      'The program is using the sessions; the claw and the Latin are symptoms of the same crossing.',
    tags: ['session', 'chamber', 'bleed', 'rome'],
  })
  await ensureThread(worldId, dossierWriter, {
    title: 'The Face Lena Hides',
    kind: 'threat',
    summary:
      'Commander Lena Korr is the program face who has already sacrificed prior forks of Andrew to keep the cycles running.',
    stakes: 'If he stays useful and ignorant, he is expendable the moment he is not.',
    consequences: 'The program closes ranks; a newcomer who asks the wrong question disappears into the next cycle.',
    hidden: 'Lena will burn a crew member to stay buried. The friendly bunker is the lid.',
    tags: ['authority', 'records', 'private', 'program'],
  })
  await ensureThread(worldId, dossierWriter, {
    title: 'Who Jordan Is Protecting',
    kind: 'relationship',
    summary:
      'Jordan Lacy stays close, warm, and curious — and she is choosing what to tell Ellis and Lee about the vision and the Latin.',
    stakes: 'A public misunderstanding, or a report upstairs, could strand Andrew with no ally left.',
    consequences: 'If she is protecting the program, her care is a leash.',
    hidden: 'Her interest is not only medical. She has seen this pattern before.',
    tags: ['crew', 'medical', 'corridor', 'jordan'],
  })

  await ensureClue(worldId, dossierWriter, 'The Unexplained Tremor', {
    title: 'Latin under the claw',
    detail:
      'After the corridor collapse Andrew spoke in perfect Latin, low and booming: none will stand before the Empire of Rome. Earlier he told Jordan he led armies under imperial Aquilas — here, now, not in history.',
    implication:
      'The spasm and the voice may be the same event: a crossing, not a random neurological loop.',
  })
  await ensureObjective(worldId, dossierWriter, 'The Unexplained Tremor', {
    title: 'Learn why Rome speaks through him',
    detail:
      'The Latin, the Aquilas vision, and the sessions are one mystery. Ask who has heard this before, what the chamber is for, and what Lena already knows.',
  })
  await closeProtocolLoops(worldId, dossierWriter)
  await ensureObjective(worldId, dossierWriter, 'What the Sessions Are For', {
    title: 'Leave the chamber and demand a real answer',
    detail:
      'The isolation cycles and baselines are busywork. Get out, sit down to dinner, and press what the sessions actually do — Rome, Lena, the chamber — not another timer.',
  })
  await reopenRomeObjective(worldId, dossierWriter)
  await setReleasePending(worldId, worlds, dossierWriter, characters)

  const dossier = await dossiers.forWorld(worldId)
  const active = dossier.threads.filter((t) => t.status === 'active')
  console.log('[seed] Active threads:')
  for (const t of active) {
    console.log(`  - [${t.kind}] ${t.title}`)
  }
  console.log(
    `[seed] Read-back: ${dossier.threads.length} thread(s), ${active.length} active.`,
  )
  console.log('[seed] Done.')
  process.exit(0)
}

async function resolveClawingArm(
  worldId: number,
  writer: Awaited<ReturnType<typeof initContainer>>['dossierWriter'],
): Promise<void> {
  const row = await writer.threadByTitle(worldId, 'The Clawing Arm')
  if (!row) {
    console.log('[seed] The Clawing Arm not found — skip.')
    return
  }
  if (row.status === 'resolved' || row.status === 'failed') {
    console.log(`[seed] The Clawing Arm already ${row.status} — skip.`)
    return
  }
  await writer.updateThread({
    id: row.id,
    kind: row.kind,
    status: 'resolved',
    summary:
      'The claw, numbness, and asymmetric pressure spikes were logged through imaging; they are a finding inside the Latin/session mystery, not a separate season.',
    stakes: row.stakes,
    rewards: row.rewards,
    consequences: row.consequences,
    hidden: row.hidden,
    relevance_tags_json: row.relevance_tags_json,
    resolved_turn_id: null,
  })
  const imaging = await writer.objectiveByTitle(
    worldId,
    'Determine cause and trigger of the collapse through imaging',
  )
  if (imaging) {
    await writer.updateObjective({
      id: imaging.id,
      thread_id: row.id,
      status: 'completed',
      detail:
        'Imaging was ordered after the second relaxant failed. The spasm is recorded; the cause sits with the Latin/session mystery.',
      blocker: null,
      completed_turn_id: null,
    })
  }
  console.log(`[seed] Resolved The Clawing Arm (id ${row.id}).`)
}

async function reviveRomeMystery(
  worldId: number,
  writer: Awaited<ReturnType<typeof initContainer>>['dossierWriter'],
): Promise<void> {
  const row = await writer.threadByTitle(worldId, 'The Unexplained Tremor')
  if (!row) {
    console.log('[seed] The Unexplained Tremor not found — will not invent a duplicate.')
    return
  }
  await writer.updateThread({
    id: row.id,
    kind: 'mystery',
    status: 'active',
    summary:
      'Andrew collapsed, lost the arm to a claw, and spoke in perfect Latin as if commanding Rome — banners, Aquilas, armies marching here and now, not in history.',
    stakes:
      'If this is treated as only a tremor, the next crossing may take more than a limb — and the program will log it as a successful session.',
    rewards: row.rewards,
    consequences:
      'Another deep run without answers risks a longer possession and a quieter cover-up.',
    hidden:
      'The vision and the voice are the plot. The claw is how the body keeps the score.',
    relevance_tags_json: JSON.stringify([
      'rome',
      'latin',
      'session',
      'vision',
      'chamber',
    ]),
    resolved_turn_id: null,
  })
  console.log(`[seed] Revived The Unexplained Tremor as active mystery (id ${row.id}).`)
}

const PROTOCOL_LOOP_TITLES = [
  'Locked in Isolation — Monitoring Cycle Begins',
  'The Isolation Protocol',
  'The Isolation Session',
  'The Double-Verification Protocol',
  'The Fragment Recovery Protocol',
  'Facility Isolation Protocol',
  'Bunker Lockdown After External Contact',
]

async function closeProtocolLoops(
  worldId: number,
  writer: Awaited<ReturnType<typeof initContainer>>['dossierWriter'],
): Promise<void> {
  for (const title of PROTOCOL_LOOP_TITLES) {
    const row = await writer.threadByTitle(worldId, title)
    if (!row) {
      console.log(`[seed] Protocol thread "${title}" not found — skip.`)
      continue
    }
    if (row.status === 'resolved' || row.status === 'failed') {
      console.log(`[seed] "${title}" already ${row.status} — skip.`)
      continue
    }
    await writer.updateThread({
      id: row.id,
      kind: row.kind,
      status: 'resolved',
      summary:
        'Isolation, timers, and monitoring passes ran themselves out. They were procedure, not the plot; the sessions, Rome, and Lena remain.',
      stakes: row.stakes,
      rewards: row.rewards,
      consequences: row.consequences,
      hidden: row.hidden,
      relevance_tags_json: row.relevance_tags_json,
      resolved_turn_id: null,
    })
    console.log(`[seed] Resolved protocol loop "${title}" (id ${row.id}).`)
  }
}

async function reopenRomeObjective(
  worldId: number,
  writer: Awaited<ReturnType<typeof initContainer>>['dossierWriter'],
): Promise<void> {
  const row = await writer.objectiveByTitle(worldId, 'Learn why Rome speaks through him')
  if (!row) return
  const thread = await writer.threadByTitle(worldId, 'The Unexplained Tremor')
  await writer.updateObjective({
    id: row.id,
    thread_id: thread?.id ?? null,
    status: 'active',
    detail:
      'The Latin, the Aquilas vision, and the sessions are still unanswered. The baselines did not explain them. Ask who has heard this before, what the chamber is for, and what Lena already knows.',
    blocker: null,
    completed_turn_id: null,
  })
  console.log(`[seed] Re-opened objective "Learn why Rome speaks through him" (id ${row.id}).`)
}

async function setReleasePending(
  worldId: number,
  worlds: Awaited<ReturnType<typeof initContainer>>['worlds'],
  writer: Awaited<ReturnType<typeof initContainer>>['dossierWriter'],
  characters: Awaited<ReturnType<typeof initContainer>>['characters'],
): Promise<void> {
  const sessions = await writer.threadByTitle(worldId, 'What the Sessions Are For')
  const castRows = await characters.forWorld(worldId)
  const ellis = castRows.find((c) => c.name.toLowerCase() === 'ellis shaw')
  const jordan = castRows.find((c) => c.name.toLowerCase() === 'jordan lacy')
  const cast = [
    ellis
      ? { characterId: ellis.id, name: ellis.name, role: 'initiate' as const }
      : null,
    jordan
      ? { characterId: jordan.id, name: jordan.name, role: 'react' as const }
      : null,
  ].filter((c): c is NonNullable<typeof c> => c != null)
  await worlds.setDirectorState(
    worldId,
    serializeDirectorState({
      pending: {
        beatKind: 'yield',
        foregroundThreadId: sessions?.id ?? null,
        mustStage: [
          'Ellis ends the isolation cycle and unseals the chamber.',
          'Jordan walks Andrew toward the mess for dinner.',
        ],
        mustNot: [
          'Do not start another monitoring interval, timer, or deep session.',
          'Do not restage vitals, traces, or protocol recitation.',
        ],
        cast,
        guidanceLines: [
          'The tests are done. Honor the request for dinner. Pressure is the sessions, Rome, and Lena — not another baseline.',
        ],
        reason: 'empty_dossier',
        sourceTurnId: 1354,
      },
      lastBrainTurnId: 1354,
      lastBrainReason: 'empty_dossier',
      lastBeatKind: 'local',
      lastForegroundThreadId: null,
      stallStreak: 0,
      agencyLocked: false,
    }),
  )
  console.log('[seed] Pending beat: unseal the chamber and go to dinner.')
}

async function ensureThread(
  worldId: number,
  writer: Awaited<ReturnType<typeof initContainer>>['dossierWriter'],
  spec: {
    title: string
    kind: string
    summary: string
    stakes: string
    consequences: string
    hidden: string
    tags: string[]
  },
): Promise<void> {
  const existing = await writer.threadByTitle(worldId, spec.title)
  if (existing) {
    if (existing.status !== 'active') {
      await writer.updateThread({
        id: existing.id,
        kind: spec.kind,
        status: 'active',
        summary: spec.summary,
        stakes: spec.stakes,
        rewards: existing.rewards,
        consequences: spec.consequences,
        hidden: spec.hidden,
        relevance_tags_json: JSON.stringify(spec.tags),
        resolved_turn_id: null,
      })
      console.log(`[seed] Re-activated "${spec.title}" (id ${existing.id}).`)
      return
    }
    console.log(`[seed] Thread "${spec.title}" already active (id ${existing.id}) — skip.`)
    return
  }
  const { id } = await writer.insertThread({
    world_id: worldId,
    title: spec.title,
    kind: spec.kind,
    status: 'active',
    summary: spec.summary,
    stakes: spec.stakes,
    rewards: null,
    consequences: spec.consequences,
    hidden: spec.hidden,
    relevance_tags_json: JSON.stringify(spec.tags),
    source_turn_id: null,
  })
  console.log(`[seed] Inserted "${spec.title}" → id ${id}`)
}

async function ensureClue(
  worldId: number,
  writer: Awaited<ReturnType<typeof initContainer>>['dossierWriter'],
  threadTitle: string,
  spec: { title: string; detail: string; implication: string },
): Promise<void> {
  const existing = await writer.clueByTitle(worldId, spec.title)
  if (existing) {
    console.log(`[seed] Clue "${spec.title}" already exists — skip.`)
    return
  }
  const thread = await writer.threadByTitle(worldId, threadTitle)
  const { id } = await writer.insertClue({
    world_id: worldId,
    thread_id: thread?.id ?? null,
    title: spec.title,
    detail: spec.detail,
    implication: spec.implication,
    status: 'open',
    source_turn_id: null,
  })
  console.log(`[seed]   clue "${spec.title}" → id ${id}`)
}

async function ensureObjective(
  worldId: number,
  writer: Awaited<ReturnType<typeof initContainer>>['dossierWriter'],
  threadTitle: string,
  spec: { title: string; detail: string },
): Promise<void> {
  const existing = await writer.objectiveByTitle(worldId, spec.title)
  if (existing) {
    console.log(`[seed] Objective "${spec.title}" already exists — skip.`)
    return
  }
  const thread = await writer.threadByTitle(worldId, threadTitle)
  const { id } = await writer.insertObjective({
    world_id: worldId,
    thread_id: thread?.id ?? null,
    title: spec.title,
    status: 'active',
    detail: spec.detail,
    blocker: null,
    source_turn_id: null,
  })
  console.log(`[seed]   objective "${spec.title}" → id ${id}`)
}

main().catch((err) => {
  console.error('[seed] FAILED:', err)
  process.exit(1)
})

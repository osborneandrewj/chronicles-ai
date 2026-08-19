// Local repair for Project THRESHOLD: Jordan's relationship/memory, colocate
// Andrew with her in the mess, and pin the Hale folder + loose log sheet.
//
//   PERSISTENCE=mongo \
//   DATABASE_URL='mongodb://localhost:27017/chronicles?replicaSet=rs0' \
//   npx tsx --conditions=react-server packages/server/scripts/repair-threshold-jordan.ts

import { initContainer } from '@/composition/container'

const WORLD_NAME = 'Project THRESHOLD'

async function main(): Promise<void> {
  const container = await initContainer()
  const { worlds, characters, scenes, dossiers, dossierWriter, relationships } = container

  const summaries = await worlds.listWorlds()
  const target = summaries.find((w) => w.name.toLowerCase() === WORLD_NAME.toLowerCase())
  if (!target) {
    console.error(`[repair] No world named "${WORLD_NAME}"`)
    process.exit(1)
  }
  const worldId = target.id
  const cast = await characters.forWorld(worldId)
  const andrew = cast.find((c) => c.is_player === 1)
  const jordan = cast.find((c) => c.name.toLowerCase() === 'jordan lacy')
  const lee = cast.find((c) => c.name.toLowerCase() === 'lee ingram')
  const places = await container.places.forWorld(worldId)
  const mess = places.find((p) => p.name.toLowerCase() === 'mess hall')
  if (!andrew || !jordan || !mess) {
    console.error('[repair] Missing Andrew, Jordan, or Mess Hall')
    process.exit(1)
  }

  await characters.setPlace(andrew.id, mess.id)
  await characters.setPlace(jordan.id, mess.id)
  await characters.applyAgentNpcFields(jordan.id, {
    relationship_to_player:
      'lover and co-conspirator; shared the bunk and his Maker\'s Mark; bringing him the Hale file against Lena',
    private_beliefs:
      'The bunk night was real — his whiskey, not Marcus\'s. I remember sitting beside him. The Hale folder is the next piece. Lena ordered the seal. I am still on his side.',
    current_focus:
      'at a mess table with the Hale folder, waiting to turn the next page with Andrew',
    last_known_situation:
      'seated across from Andrew in the mess hall, the Hale medical folder on the table between them',
    recent_activity:
      'walked Andrew from the chamber to the mess, found the Hale folder, and sat down with him to read it',
    current_place_id: mess.id,
  })
  await characters.setActiveGoal(
    jordan.id,
    'show Andrew the next page of the Hale folder and keep Lena from taking it',
  )

  await relationships.upsert([
    {
      world_id: worldId,
      from_character_id: jordan.id,
      to_character_id: andrew.id,
      kind: 'lover',
      valence: 0.85,
      note: 'Shared the bunk and the whiskey; she is helping him against Lena.',
    },
  ])

  const active = await scenes.activeForWorld(worldId)
  if (active && active.place_id !== mess.id) {
    await scenes.autoClose(1400, active.id)
    const nextNum = (await scenes.maxSceneNumber(worldId)) + 1
    const opened = await scenes.insert({
      world_id: worldId,
      place_id: mess.id,
      title: 'At Mess Hall',
      scene_number: nextNum,
      opened_at_turn: 1400,
    })
    await worlds.setCurrentScene(opened.id, worldId)
    console.log(`[repair] Opened scene ${nextNum} at Mess Hall (id ${opened.id}).`)
  }

  const dossier = await dossiers.forWorld(worldId)
  if (!dossier.resources.some((r) => /hale/i.test(r.name))) {
    await dossierWriter.insertResource({
      world_id: worldId,
      owner_character_id: jordan.id,
      name: 'Marcus Hale medical folder',
      kind: 'file',
      status: 'held',
      detail:
        'Pre-arrival medical log on Marcus Hale: same arm tremor, same Latin phrasing, transferred to surface three weeks before Andrew arrived, episode unresolved.',
      held_by_character_id: jordan.id,
      location_place_id: null,
      salient: true,
      source_turn_id: 1400,
    })
    console.log('[repair] Inserted Marcus Hale medical folder (Jordan holding).')
  }
  if (lee && !dossier.resources.some((r) => /loose medical log/i.test(r.name))) {
    await dossierWriter.insertResource({
      world_id: worldId,
      owner_character_id: lee.id,
      name: 'Loose medical log sheet',
      kind: 'file',
      status: 'held',
      detail:
        'Sheet from the corridor floor, Lena\'s initials, Latin phrasing and tremor noted eight months before assignment. Andrew handed it to Lee.',
      held_by_character_id: lee.id,
      location_place_id: null,
      salient: true,
      source_turn_id: 1384,
    })
    console.log('[repair] Inserted loose medical log sheet (Lee holding).')
  }

  console.log('[repair] Jordan relationship, Andrew colocation, Hale folder done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[repair] FAILED:', err)
  process.exit(1)
})

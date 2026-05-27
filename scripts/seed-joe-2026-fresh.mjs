#!/usr/bin/env node
// One-shot seed for world 5 (Joe 2026 fresh start). Backfills premise-tied
// characters with the deeper v0.6.7 fields (reveries, private_beliefs,
// relationship_to_player, long_term_agenda, personal_goals, tool_access,
// last_known_situation) instead of a flat description, so the narrator and
// NPC agent have real material to draw on from turn 1.
//
// Idempotent on character name within the world: existing rows are updated;
// missing rows are inserted. Aliases are deduped against the canonical name.

import path from 'node:path'
import process from 'node:process'

import Database from 'better-sqlite3'

const TARGET_WORLD_ID = 5

const CHARACTERS = [
  // ---- Family --------------------------------------------------------------
  {
    name: 'Andy Osborne',
    description:
      "Joseph's younger brother (39); married to Jordana with four kids; lives within an hour of Spokane. Software/sysadmin background. Texts Joe on Thursdays, Fridays, Saturdays when Joe goes quiet.",
    personal_goals:
      "Keep the family knit while Joe figures himself out.\nHold his own marriage and four kids steady through the unsettled patch he's noticed in his brother.",
    private_beliefs:
      "Something happened to Joe that he isn't saying.\nPushing him will make it worse; ignoring it will make it permanent.",
    reveries:
      'The summer they shared a bunk bed in Spokane Valley before Alex moved out — Joe at nine still believing every story Andy told him.\nThe morning Joe shipped out for Marine boot in 2013, the way he hugged their mother and did not look back at the rest of them.',
    relationship_to_player:
      "Younger brother by six years. Steady, careful concern. His Thursday/Friday/Saturday texts are his idiom — he keeps reaching out without asking too much. Trust runs both ways.",
    long_term_agenda:
      "Be the brother who notices.\nNot the brother who confronts.",
    tool_access:
      'Personal phone, email, Slack at work, family contacts (parents, siblings, Joe\'s old Marine network through mutual friends), basic IT skills.',
    last_known_situation:
      "At home with Jordana and the kids, drafting a third check-in text he isn't sure to send.",
  },
  {
    name: 'Alex Osborne',
    description:
      "Joseph's oldest sibling (41); married with two kids; lives in the Spokane area; the family's quiet steadying force.",
    personal_goals:
      "Stay present for the kids.\nStay grounded for the parents.\nMake sure Joe lands when he's ready.",
    private_beliefs:
      "Joe always disappears into things, then comes back changed. This time the gap is longer.\nHe should call him directly instead of texting photos.",
    reveries:
      "Holding six-year-old Joe up to watch the fireworks on Cannon Hill the year their dad first taught them all to fish.\nThe morning Joe enlisted at the recruiting office on Division — Alex couldn't say what he wanted to say, so he handed him a coffee instead.",
    relationship_to_player:
      "Eldest brother. The one Joe rarely calls but always trusts to be there. Steady, non-confrontational, remembers everything.",
    long_term_agenda:
      "Be the older brother who doesn't push but doesn't drift.",
    tool_access:
      'Personal phone, email, social media (uses sparingly), a trade network in his field.',
    last_known_situation:
      "Probably at work or shuttling one of his kids; phone on him; expects nothing this morning.",
  },
  {
    name: 'Abigail Osborne',
    description:
      "Joseph's youngest sibling (31); the family's emotional reader; lives in Spokane area or nearby. Sends voice memos instead of texts.",
    personal_goals:
      "Get Joe to talk.\nBe the sibling he can tell the truth to without flinching.",
    private_beliefs:
      "Joe came back wrong. Not bad — wrong. He carries his shoulders differently.\nShe can wait, but not forever.",
    reveries:
      "The trip the four of them took to Long Beach when she was eight and Joe was ten — he taught her to dig past the wet sand to where the hermit crabs lived.\nThe voicemail Joe left her in 2014 from somewhere in California, three weeks into Marine training, sounding lighter than he had in months.",
    relationship_to_player:
      "Youngest sister. The one Joe will eventually crack open to. Reads people; affectionate, observant, patient.",
    long_term_agenda:
      "Build a life Joe is welcome to walk into without having to ask permission.",
    tool_access:
      'Personal phone (voice memos), social media, family contacts, a counselor\'s instincts.',
    last_known_situation:
      "Going about her morning, phone close at hand, waiting on a callback she sent ten days ago.",
  },
  {
    name: 'Anne Osborne',
    description:
      "Joseph's mother. Reaches out gently. Texts 'Love you, Joey' on the days she feels him slipping. Carries the household.",
    personal_goals:
      "Bring Joe home for Sunday dinner.\nMake sure he eats.\nAsk gently, never demand.",
    private_beliefs:
      'Whatever happened to her son in those weeks he was gone, she felt it.\nShe is patient about it the way only mothers can be.',
    reveries:
      'Joe at four pressing his face to the kitchen window in the rain on Rosebury Lane, watching for Jon\'s car to come up the drive.\nThe night he came home from his first deployment with his sea bag still on his shoulder, standing in the doorway and not yet putting it down.',
    relationship_to_player:
      "Mother. The simplest, most non-negotiable relationship in his life. Never withholds; never pushes hard enough to push him away.",
    long_term_agenda:
      "Keep him alive.\nKeep the family knit.\nSunday dinners are not optional.",
    tool_access:
      'Phone (text/call), kitchen, the household, every contact in the family\'s address book.',
    last_known_situation:
      "At the kitchen counter with her phone face-down beside the coffeepot, ready to flip it if it buzzes.",
  },
  {
    name: 'Jon Osborne',
    description:
      "Joseph's father. Quieter. Speaks in small directives. Works with his hands. Was a Marine before Joe was.",
    personal_goals:
      "Lead by being there.\nStay alive long enough to see all four of his kids settled.",
    private_beliefs:
      "Whatever Joe has seen, Jon recognizes the shape of it.\nHe won't say so out loud. He'll just be available.",
    reveries:
      "Teaching Joe to shoot a .22 in the back lot at his uncle's place outside Cheney when Joe was eleven.\nThe second deployment — the 2 AM call that wasn't bad news but felt like it.",
    relationship_to_player:
      "Father and the only other Marine in the family. Sees Joe more clearly than anyone. Won't push him to talk.",
    long_term_agenda:
      "Hand down what should be handed down.\nBe quiet about what can't be said.",
    tool_access:
      'Phone, garage, tools, an old Marine network from the late 80s/early 90s, a gun safe.',
    last_known_situation:
      'In the garage on a Saturday-morning project, half-listening for the back door.',
  },
  {
    name: 'Jordana Osborne',
    aliases: ['Jordana'],
    description:
      "Joseph's sister-in-law. Andy's wife. Mother of four. Warmth that includes everyone in the room.",
    personal_goals:
      "Keep the household running while Andy is fretting about Joe.\nMake sure Joe knows the door is open.",
    private_beliefs:
      "She doesn't fully know what Andy thinks happened to Joe, but she trusts him.\nShe'll hold the line at home so Andy can hold it for Joe.",
    reveries:
      'Holding her first baby in the hospital while Andy and Joe stood awkwardly at the door — Joe in dress blues, in town for forty-eight hours.',
    relationship_to_player:
      "Sister-in-law. The one who'll hand him coffee and let him sit at the kitchen island without making him explain.",
    long_term_agenda:
      "Keep her family of six intact and steady.",
    tool_access:
      'Phone, household, the parental group chat, soft instincts.',
    last_known_situation:
      'Wrangling the morning routine; Andy on his phone in the next room.',
  },
  // ---- Work ---------------------------------------------------------------
  {
    name: 'Linda Haft',
    description:
      "Joseph's USACE contract supervisor. Sent three check-in emails about Friday's deliverable. Has not heard from him in four days.",
    personal_goals:
      "Get Joseph's code review delivered before Tuesday's milestone.\nAvoid escalating to the contracting officer.",
    private_beliefs:
      "Joseph is reliable until he isn't. This silence is unusual.\nHe has earned the benefit of the doubt — once.",
    relationship_to_player:
      "Direct supervisor on the USACE software contract. Professional, measured, fair. Escalates reluctantly.",
    long_term_agenda:
      "Deliver the USACE work clean.\nPromote when there's an opening.\nProtect her team from contracting-officer churn.",
    tool_access:
      'Government email, Teams, ticketing system, contracting-officer Rolodex, calendar visible to leadership.',
    last_known_situation:
      "At her desk Saturday morning if it's a working weekend; otherwise her email is open on a tab in the kitchen.",
  },
  // ---- Mythic / Gallic Wars backstory -------------------------------------
  {
    name: 'Titus',
    description:
      "A soldier in Joseph's unit (the Black Cloaks) in Gaul. Known for swearing. One of the four men Minerva matched with Joseph as the best fighters in the Legions.",
    personal_goals: 'Already settled — he is in Gaul, two thousand years ago. Joseph carries his memory only.',
    private_beliefs:
      "The warlord's god is real.\nTheir god, less so.",
    reveries:
      "Joseph carries: standing knee-deep in a Gaulish river after the second crossing, the Black Cloaks bleeding and laughing at once.\nThe night Caesar gave them silver brooches and called them his right hand.",
    relationship_to_player:
      "Joseph's most-loyal Black Cloak. Would die for him and curse him into the grave at the same time. Now: only memory.",
  },
  {
    name: 'Caesar',
    description:
      "Roman general in the Gallic Wars; trusted Joseph deeply; will be assassinated in the Senate if Joseph does not return.",
    private_beliefs:
      "Joseph is Minerva's gift; he proves Rome is favored.\nThe conspiracy in the Senate is not new — Joseph's return will resolve it.",
    reveries:
      "Joseph carries: the tent on the Loire after Alesia where Caesar called him brother.",
    relationship_to_player:
      "Master and friend. The man Joseph went back two thousand years to serve and the man he was sent home to save.",
  },
  {
    name: 'Minerva',
    description:
      "Roman goddess who time-traveled Joseph to the Gallic Wars and back. Convinced him to leave Gaul to save Caesar from assassination. Bestowed strength, fighting skill, and the ability to speak every language ever spoken.",
    private_beliefs:
      "Joseph is hers.\nShe will pull him back when the time comes.",
    relationship_to_player:
      "Patron goddess. The voice Joseph hears at the edge of dreams. The reason he is no longer ordinary.",
    long_term_agenda:
      "Caesar must not be stabbed.\nJoseph will return when Rome demands.",
  },
  {
    name: 'Elara',
    description:
      "Joseph's wife from the Gallic Wars. Pressed a silver Gaulish bracelet into his hand as he rode away, telling him she would love him forever in Gaulish.",
    reveries:
      "Joseph carries: her hand on his wrist as he mounted to ride out; the sound of the Gaulish word for 'forever' which he can still pronounce but no English word matches.",
    relationship_to_player:
      "Wife in Gaul. Wife in his bones. Wife in a language he can speak but cannot find a single soul in 2026 who would understand.",
    long_term_agenda:
      "Cannot reach across time.\nLives only in his head now.",
  },
]

// Premise-tied places only. His house is already created by the clone script.
const PLACES = [
  {
    name: 'The garage at Rosebury Lane',
    description: "Joseph's garage workshop attached to the Rosebury Lane house — where Big Guns USA deodorant is mixed and shipped from since November 2024.",
    kind: 'workshop',
  },
]

function openDb() {
  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'chronicles.sqlite')
  console.log(`[seed] opening ${dbPath}`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function upsertPlace(db, worldId, p) {
  const existing = db
    .prepare('SELECT id FROM places WHERE world_id = ? AND lower(name) = lower(?)')
    .get(worldId, p.name)
  if (existing) {
    db.prepare(
      `UPDATE places SET description = COALESCE(?, description), kind = COALESCE(?, kind), updated_at = datetime('now') WHERE id = ?`,
    ).run(p.description ?? null, p.kind ?? null, existing.id)
    console.log(`  · place "${p.name}" (#${existing.id}) updated`)
    return existing.id
  }
  const row = db
    .prepare(`INSERT INTO places (world_id, name, description, kind) VALUES (?, ?, ?, ?) RETURNING id`)
    .get(worldId, p.name, p.description ?? null, p.kind ?? null)
  console.log(`  ✓ place "${p.name}" (#${row.id}) created`)
  return row.id
}

function upsertCharacter(db, worldId, c) {
  const aliasesText = c.aliases?.length ? c.aliases.join('\n') : null
  const existing = db
    .prepare('SELECT id FROM characters WHERE world_id = ? AND lower(name) = lower(?)')
    .get(worldId, c.name)

  if (existing) {
    db.prepare(
      `UPDATE characters SET
         description = COALESCE(?, description),
         personal_goals = COALESCE(?, personal_goals),
         private_beliefs = COALESCE(?, private_beliefs),
         reveries = COALESCE(?, reveries),
         relationship_to_player = COALESCE(?, relationship_to_player),
         long_term_agenda = COALESCE(?, long_term_agenda),
         tool_access = COALESCE(?, tool_access),
         last_known_situation = COALESCE(?, last_known_situation),
         aliases = COALESCE(?, aliases),
         agency_level = COALESCE(?, agency_level),
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      c.description ?? null,
      c.personal_goals ?? null,
      c.private_beliefs ?? null,
      c.reveries ?? null,
      c.relationship_to_player ?? null,
      c.long_term_agenda ?? null,
      c.tool_access ?? null,
      c.last_known_situation ?? null,
      aliasesText,
      c.agency_level ?? null,
      existing.id,
    )
    console.log(`  · "${c.name}" (#${existing.id}) updated`)
    return existing.id
  }

  const row = db
    .prepare(
      `INSERT INTO characters (
         world_id, name, description, is_player,
         personal_goals, private_beliefs, reveries,
         relationship_to_player, long_term_agenda, tool_access,
         last_known_situation, aliases, agency_level
       ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      worldId,
      c.name,
      c.description ?? null,
      c.personal_goals ?? null,
      c.private_beliefs ?? null,
      c.reveries ?? null,
      c.relationship_to_player ?? null,
      c.long_term_agenda ?? null,
      c.tool_access ?? null,
      c.last_known_situation ?? null,
      aliasesText,
      c.agency_level ?? 'npc',
    )
  console.log(`  ✓ "${c.name}" (#${row.id}) created`)
  return row.id
}

function main() {
  const db = openDb()
  const world = db.prepare('SELECT id, name FROM worlds WHERE id = ?').get(TARGET_WORLD_ID)
  if (!world) {
    console.error(`world ${TARGET_WORLD_ID} not found`)
    process.exit(1)
  }
  console.log(`[seed] target: #${world.id} "${world.name}"`)
  console.log(`[seed] characters (${CHARACTERS.length})`)
  const tx = db.transaction(() => {
    for (const c of CHARACTERS) upsertCharacter(db, TARGET_WORLD_ID, c)
    console.log(`[seed] places (${PLACES.length})`)
    for (const p of PLACES) upsertPlace(db, TARGET_WORLD_ID, p)
  })
  tx()
  db.close()
  console.log('[seed] done')
}

main()

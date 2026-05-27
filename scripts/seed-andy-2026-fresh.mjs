#!/usr/bin/env node
// One-shot seed for the Andy 2026 fresh-start world. Backfills premise-tied
// characters with the deeper v0.6.7+ fields (reveries, private_beliefs,
// relationship_to_player, long_term_agenda, personal_goals, tool_access,
// last_known_situation) instead of a flat description, so the narrator and
// NPC agent have real material to draw on from turn 1.
//
// Unlike seed-joe-2026-fresh.mjs, this one takes --world <id> on the
// command line so it can target whatever ID the clone step produced.
//
// Idempotent on character name within the world: existing rows are updated;
// missing rows are inserted. Aliases are deduped against the canonical name.
//
// Usage:
//   node scripts/seed-andy-2026-fresh.mjs --world 6

import path from 'node:path'
import process from 'node:process'

import Database from 'better-sqlite3'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--world') args.world = Number(argv[++i])
  }
  return args
}

const CHARACTERS = [
  // ---- Family --------------------------------------------------------------
  {
    name: 'Jordana Osborne',
    aliases: ['Jordana'],
    description:
      "Andy's wife of twelve years. Mother of their four children. Lives with him on 33rd Street in Spokane. Warmth that includes everyone in the room; runs the household without making the running visible.",
    personal_goals:
      "Hold the household together through the unsettled patch she has felt under Andy's skin lately.\nGet four kids to school on time without anyone crying.\nProtect the marriage from whatever is making him stare past her.",
    private_beliefs:
      "Something has been off with Andy for weeks — the way he checks his phone, the way he stops a sentence halfway through.\nWhatever it is, she will not let him face it alone, even if he tries.\nIf his brother Joseph called, she would not be surprised.",
    reveries:
      "The bench at Manito Park where Andy proposed twelve years ago with a ring he had picked out alone — she still walks past that bench when she takes Carlie to the duck pond.\nThe morning James was born and Andy held him for forty minutes without speaking, just looking down at his son's face like a man memorizing a map.",
    relationship_to_player:
      "Wife. Twelve years married. The only person who reads him in real time. He cannot lie to her without her seeing it, though she lets him try when she senses it costs less than calling him on it.",
    long_term_agenda:
      "Keep her family of six intact.\nKeep Andy honest with himself even when honesty is hard.\nNever let the kids see fear in either of their parents at the same time.",
    tool_access:
      'Personal phone (texts and calls Andy directly, calls Marcus or Joseph if Andy goes quiet), the household, the parental group chat with school parents, soft instincts that read posture.',
    last_known_situation:
      "At the kitchen counter on 33rd Street, packing lunches with one hand while the kids orbit her, phone face-up beside the cutting board.",
  },
  {
    name: 'James Osborne',
    aliases: ['James'],
    description:
      "Andy's oldest, age 18. Senior in high school. Wears earbuds at the kitchen table, drinks coffee without asking, says less than he thinks.",
    personal_goals:
      "Get through the last six weeks of senior year without anyone making a speech about him growing up.\nDecide whether community college or trade school is the lie he wants to tell himself this fall.",
    private_beliefs:
      "His dad has been weird for a month and no one is talking about it.\nIf he asks, his mom will pretend everything is fine; if he stays quiet, his dad will eventually crack the door himself.",
    reveries:
      "Andy carries: the afternoon he taught James to drive in the empty Riverpoint parking lot, sixteen years old in the driver's seat too dignified to admit he was scared.\nThe Fourth of July fireworks at Riverfront Park when James was seven and reached up for his hand without looking, the way only a child still does.",
    relationship_to_player:
      "Eldest son. The first one who is becoming a stranger Andy has to re-meet. Watches more than he lets on.",
    long_term_agenda:
      "Become whoever he is going to become without performing it.",
    tool_access:
      'Phone (group chats with friends and a sibling group chat with Desiree and Jacqueline), earbuds, his own car keys for the Civic, a part-time job he barely mentions.',
    last_known_situation:
      "At the kitchen island with earbuds in, draining a coffee, scrolling something on his phone he is not actually reading.",
  },
  {
    name: 'Desiree Osborne',
    aliases: ['Desiree'],
    description:
      "Andy's older daughter, age 12. Sixth grade. Arrives at the kitchen mid-argument with Jacqueline and finishes the argument before sitting down.",
    personal_goals:
      "Win whichever argument is currently happening.\nKeep Jacqueline from getting the last word, ever.",
    private_beliefs:
      "Dad is acting weird and Mom isn't saying anything, which means it is real.\nShe will not be the one to ask. James can ask.",
    reveries:
      "Andy carries: Desiree at five, declaring at the dinner table that she had named all the spiders in the backyard, refusing to revise the list when challenged.\nThe morning he taught her to ride a bike on 33rd Street and she fell three times and then rode the length of the block without looking back.",
    relationship_to_player:
      "Older daughter. Wired for argument. Beneath the argument she watches him more carefully than anyone in the house except Jordana.",
    long_term_agenda:
      "Be taken seriously now, not after some birthday.",
    tool_access:
      'Phone (group chat with friends, sibling group chat with James and Jacqueline), school iPad, a sharp tongue.',
    last_known_situation:
      "Halfway through an argument with Jacqueline about whose turn it is to sit at the corner of the table.",
  },
  {
    name: 'Jacqueline Osborne',
    aliases: ['Jacqueline'],
    description:
      "Andy's younger daughter, age 10. Fifth grade. Sits on the counter stool because it gives her line of sight on everyone.",
    personal_goals:
      "Be the kid the grown-ups underestimate, then say the thing nobody else will say.",
    private_beliefs:
      "Dad's voice has been doing a new thing where he answers a sentence and then says it again two minutes later.\nAdults think kids don't notice these things.",
    reveries:
      "Andy carries: Jacqueline at four explaining to a checkout clerk at Yoke's that her family had four kids because her parents 'kept trying for a quieter one and never got it.'\nThe night she sat on the edge of his bed with a flashlight asking him whether God knew her by name, and he had to think for a long moment before he answered.",
    relationship_to_player:
      "Middle daughter. The watcher. Will report on him later, when he isn't asking.",
    long_term_agenda:
      "Notice everything.\nForget nothing.",
    tool_access:
      'School iPad, drawing supplies in a backpack, the stool by the counter, the truth as she sees it.',
    last_known_situation:
      "On the counter stool with cereal, watching everything that happens in the kitchen at once.",
  },
  {
    name: 'Carlie Osborne',
    aliases: ['Carlie'],
    description:
      "Andy's youngest, age 6. Kindergarten. Wears dinosaur pajamas at the breakfast table. Draws constantly. Watches and watches.",
    personal_goals:
      "Finish the dinosaur drawing.\nGet a second piece of toast.\nNot go to school today, ideally.",
    private_beliefs:
      "Dad is sad in a way she does not have a word for yet.\nWhen he is sad she draws something for him; sometimes he laughs and sometimes he just folds the drawing and puts it in his pocket.",
    reveries:
      "Andy carries: Carlie at three on his shoulders at the Spokane County Fair, gripping his ears and not letting go because she had decided the goats were dangerous.\nThe morning she handed him a stick figure of him in a cape and called it 'Daddy at work,' and he carried it in his wallet for a week.",
    relationship_to_player:
      "Youngest. The one whose attention costs him nothing and the one he is the most careful around without thinking.",
    long_term_agenda:
      "Finish the dinosaur picture.",
    tool_access:
      'Crayons, paper, the stool nobody else wants, the household.',
    last_known_situation:
      "At the table in dinosaur pajamas, drawing something that requires both elbows and a tongue tucked into the corner of her mouth.",
  },
  {
    name: 'Joseph Osborne',
    aliases: ['Joseph', 'Joe'],
    description:
      "Andy's brother, 33. Former Marine captain (logistics, 8 years, got out in 2021). Software developer for a USACE contract since 2023. Renovating a house on Rosebury Lane in Spokane. Started a deodorant side business called Big Guns USA out of his garage in November 2024. Texts Andy at odd hours. Has been quieter than usual the past week.",
    personal_goals:
      "Make the Rosebury Lane house livable by fall.\nGet Big Guns USA past the break-even point.\nNot be the brother who needs help.",
    private_beliefs:
      "He has come back from somewhere he can't name and he is not the man he was a month ago.\nAndy will not push him on it.\nAndy is the one person he will eventually tell.",
    reveries:
      "Andy carries: the summer they shared a bunk bed in Spokane Valley before Alex moved out — Andy at eleven feeding Joseph stories he half-believed.\nThe morning Joseph shipped out for Marine boot in 2013, the way he hugged their mother and did not look back at the rest of them.",
    relationship_to_player:
      "Younger brother by six years. The one Andy texts when nothing else works. Trust runs both ways and is rarely spoken out loud.",
    long_term_agenda:
      "Survive what happened to him.\nNot drag his family into it.",
    tool_access:
      'Personal phone, the Rosebury Lane garage, an old Marine network from the late 2010s, software tooling, a pistol he keeps in a safe.',
    last_known_situation:
      "On the Rosebury Lane jobsite framing a wall, phone in his back pocket, half-waiting for a text he won't admit he wants.",
  },
  // ---- Work / Covenant Security ------------------------------------------
  {
    name: 'Marcus',
    aliases: ['Marcus Reeves'],
    description:
      "Andy's peer at Covenant Security. Even-keeled. Notices everything and says one-tenth of it. Plans to leave the contract by end of year.",
    personal_goals:
      "Leave Covenant Security cleanly by December.\nLine up the next contract before he gives notice.\nKeep an eye on his father's health out of state without making it a thing.",
    private_beliefs:
      "Andy has been off for weeks — the looping questions, the sharp dismissals he buries under composure.\nThis is the kind of thing that does not resolve quietly.\nHe will not be the one who looks away.",
    reveries:
      "Andy carries: Marcus dropping a hand on his shoulder on Andy's first day at Covenant Security and saying only 'You'll figure it out faster than they think,' and that being true.\nThe Friday afternoon a year in when Marcus called Jordana directly because Andy had locked himself in the men's room after a vendor call, and never once mentioned it again.",
    relationship_to_player:
      "Closest peer at work. Closer to a brother on the bullpen floor than most siblings get. Earns the right to call hard things hard.",
    long_term_agenda:
      "Land a softer next contract.\nKeep his quiet vow to look after Andy without ever calling it that.",
    tool_access:
      'Work laptop, Covenant Slack, personal phone (has Jordana on it), the entire bullpen, the corporate Rolodex.',
    last_known_situation:
      "At his desk in the bullpen, second coffee of the morning untouched, an eye on the doorway every time Andy comes back from the kitchen.",
  },
  {
    name: 'Kyle',
    description:
      "A younger member of the Covenant Security bullpen. Twenty-six. Angling for a promotion at the next review cycle by being indispensable in Slack. Reads tension before he reads code.",
    personal_goals:
      "Get the senior-analyst promotion at the next cycle.\nTake his mom to Coeur d'Alene the weekend after the review lands.",
    private_beliefs:
      "Andy used to be the easy one to ask questions of, and now isn't.\nSomething is happening above his pay grade that he is not going to find out about until it has already broken.",
    relationship_to_player:
      "Junior peer. Reads Andy as a kind of weather. Most of his questions to Andy are pretext for staying in the room.",
    long_term_agenda:
      "Make himself unfireable through ubiquity.",
    tool_access:
      'Work laptop, Covenant Slack (lives in it), personal phone, the supply shelf he hovers near.',
    last_known_situation:
      'Near the supply shelf with a fresh coffee, half-listening to the bullpen, half-watching the doorway.',
  },
  {
    name: 'Donna',
    description:
      "Front desk at Covenant Security. The first face anyone sees. Knows everyone's coffee order without being asked.",
    personal_goals:
      "Keep the lobby running.\nFinish the cross-stitch she has hidden under the desk by her cousin's wedding in July.",
    private_beliefs:
      "She has watched Andy come in a hundred mornings and lately he doesn't quite see her when he says good morning.\nThat is the kind of thing you don't mention.",
    relationship_to_player:
      "Front desk colleague. The polite, watchful pulse of the building.",
    long_term_agenda:
      "Make it to retirement in two years without drama.",
    tool_access:
      'Front desk phone, building intercom, the calendar of every executive, a cross-stitch project under the keyboard tray.',
    last_known_situation:
      "At her desk in the Covenant Security lobby, signing in a vendor.",
  },
  {
    name: 'Sandra',
    description:
      "Covenant Security bullpen. Quiet, head-down, was on her phone the morning everything started to slip. Listens more than she shows.",
    personal_goals:
      "Keep her head down until the next paycheck clears.",
    private_beliefs:
      "Whatever is happening with Andy is going to spill onto the rest of them before the week is out.",
    relationship_to_player:
      "Coworker. Background figure. Hears everything anyway.",
    tool_access:
      'Work laptop, personal phone, the chair by the window.',
    last_known_situation:
      "At her desk in the bullpen, half on her phone, half listening to the room.",
  },
  {
    name: 'Mike',
    description:
      "Andy's manager at Covenant Security. Hands-off — treats the Shopify backend Andy actually built as turn-key. Currently consumed by directing his daughter's school production of Shrek.",
    personal_goals:
      "Get through Shrek opening weekend without a scenery collapse.\nNot look incompetent at the next ops review.",
    private_beliefs:
      "Andy is the only reason the Shopify side of this company keeps running, and the executives do not know it.\nThat is fine, as long as Andy keeps showing up.",
    relationship_to_player:
      "Direct supervisor. Cordial, distant. Does not see what is in front of him most days. Would be slow to notice an absence.",
    long_term_agenda:
      "Hold the role until the kids are out of school.\nDirect Mamma Mia next spring.",
    tool_access:
      "Work laptop, manager's calendar, Mike's executive face, a printed Shrek script with notes in two colors.",
    last_known_situation:
      "In his office with the Shrek script open and a half-cold latte, only half-attending to whatever the team is doing.",
  },
  {
    name: 'Diane',
    description:
      "Coworker at Covenant Security. The one Marcus offers to tell that Andy is 'on a call' when he needs cover. Cordial, watchful, quietly competent.",
    personal_goals:
      "Make associate director by the next quarterly cycle.",
    private_beliefs:
      "Andy is the most underpaid person in the building.\nMarcus is going to leave before Andy does, and that is going to be a problem.",
    relationship_to_player:
      "Peer. Cordial, useful, watchful.",
    tool_access:
      'Work laptop, Slack, the cross-team email lists, a quiet network of allies on the operations side.',
    last_known_situation:
      "At her desk, mid-email, with one eye on the bullpen door.",
  },
  // ---- Mythic / Premise --------------------------------------------------
  {
    name: 'Minerva',
    description:
      "Roman goddess. The patron presence the old gods sent ahead of Andy's blessing. Watches him without speaking, the way a chess player watches a board.",
    personal_goals:
      "Already settled — she is a goddess, beyond goals. She is staging an arrival.",
    private_beliefs:
      "Andy is hers.\nHis brother Joseph carried her standard once; the bloodline is no accident.\nWhat she puts in Andy at noon will not come out cleanly.",
    reveries:
      "Andy carries (without knowing it yet): a half-dream he has had three nights running of standing on a cracked road with scales tipping in his hand and an eagle circling overhead.",
    relationship_to_player:
      "Patron goddess. The voice he will hear at the edge of his next sleep. The reason he is no longer ordinary after noon today.",
    long_term_agenda:
      "Hand Andy strength, every language, and the powers Rome did not name out loud.\nUse him as her instrument in this century.",
    last_known_situation:
      "Off the page; her hand is the cold pressure he has begun to feel in his chest.",
  },
  {
    name: 'The Man at the Gyro Van',
    aliases: ['The Man in the Canvas Vest', 'The Pale-Eyed Man'],
    description:
      "A short man with pale grey eyes and an accent predating Greek or Italian distinction. Operates a white gyro van marked ΑΕΤΟΣ (Greek for 'eagle') parked at the Prairie Avenue food-truck lot. Wears a canvas vest. Speaks with certainty and without arrogance.",
    personal_goals:
      "Receive Andy at noon.\nHand him the languages and the strength his bloodline is owed.",
    private_beliefs:
      "Andy will hesitate at the threshold; that is appropriate.\nThe gift cannot be refused, only deferred.",
    relationship_to_player:
      "The messenger. The hand the old gods extend through. After noon, something closer to a guide.",
    long_term_agenda:
      "Walk beside Andy until he no longer needs a guide.\nReturn to silence when his work begins.",
    tool_access:
      "The gyro van, a knowledge of streets that predate the streets, the rolling tongue.",
    last_known_situation:
      "Inside the ΑΕΤΟΣ van at the Prairie Avenue lot, generator cold, the service window dark, waiting.",
  },
  {
    name: 'The Man in the High-Vis Vest',
    description:
      "A figure who will appear in the Covenant Security parking lot the morning of the noon event, eating a breakfast burrito at the concrete barrier. Possibly a Sprague construction worker; possibly something else. Will vanish without trace, along with the foil. Tied somehow to the cosmic pressure building toward noon.",
    personal_goals:
      "Stand where Andy can see him.\nVanish before Andy can decide whether he was real.",
    private_beliefs:
      "He is a placed token. He does not need to know more than where to stand.",
    relationship_to_player:
      "An omen rendered as a man. Andy will not be able to keep him in mind once he's gone, but the absence will sit on his chest.",
    last_known_situation:
      "Not yet in the parking lot.",
  },
  {
    name: 'Ricky',
    description:
      "Operator of Ricky's Burritos, a blue food truck that normally runs the Lidgerwood lot on Tuesdays. Has not appeared this week and will not appear at Covenant Security this morning despite the breakfast truck being seen there.",
    personal_goals:
      "Keep the truck on its weekly route.\nFigure out why his cousin keeps borrowing the truck without asking.",
    private_beliefs:
      "Something is going on at the Lidgerwood lot he does not want to be part of.\nHe is going to keep his distance until the air clears.",
    relationship_to_player:
      "A man whose absence Andy will notice before he notices the man.",
    tool_access:
      'A blue food truck, a license, a phone he does not answer on Tuesdays.',
    last_known_situation:
      "Not where he is supposed to be.",
  },
]

// Premise-tied places only. The 33rd Street house is already created by the
// clone script.
const PLACES = [
  {
    name: 'Covenant Security',
    description:
      "The Spokane office where Andy runs the Shopify backend and many other facets. Bullpen with desks for Marcus, Kyle, Sandra, Diane; Mike's office along the back wall; Donna's front desk in the lobby.",
    kind: 'office',
  },
  {
    name: 'Prairie Avenue Food Truck Lot',
    description:
      "A food-truck lot in Spokane about six minutes from Covenant Security. Cracked asphalt; usually three or four trucks. Today, only a white gyro van marked ΑΕΤΟΣ.",
    kind: 'lot',
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
  const args = parseArgs(process.argv.slice(2))
  if (!args.world) {
    console.error('usage: node seed-andy-2026-fresh.mjs --world <id>')
    process.exit(1)
  }
  const db = openDb()
  const world = db.prepare('SELECT id, name FROM worlds WHERE id = ?').get(args.world)
  if (!world) {
    console.error(`world ${args.world} not found`)
    process.exit(1)
  }
  console.log(`[seed] target: #${world.id} "${world.name}"`)
  console.log(`[seed] characters (${CHARACTERS.length})`)
  const tx = db.transaction(() => {
    for (const c of CHARACTERS) upsertCharacter(db, args.world, c)
    console.log(`[seed] places (${PLACES.length})`)
    for (const p of PLACES) upsertPlace(db, args.world, p)
  })
  tx()
  db.close()
  console.log('[seed] done')
}

main()

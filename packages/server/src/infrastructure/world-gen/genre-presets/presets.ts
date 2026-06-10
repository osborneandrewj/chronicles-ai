import 'server-only'

// All 24 historical-adventure genre presets.
// Each hiddenPremise is a vivid, in-medias-res setup for narrator/archivist seeding.
// These are NEVER surfaced to the player.

import type { GenrePreset } from './types'

export const PRESET_LIST: GenrePreset[] = [
  {
    id: 'ancient-rome',
    label: 'Ancient Rome',
    hiddenPremise:
      'The year is 49 BC and Julius Caesar\'s legions have crossed the Rubicon, dissolving the old order like salt in the Tiber. ' +
      'Rome seethes with faction: Pompeians fortify the Senate steps while the urban mob surges through the Forum Romanum chanting conflicting slogans. ' +
      'You are a tribune of obscure plebeian stock who has just been handed a sealed dispatch bearing the consul\'s wax — a dispatch neither side should know exists. ' +
      'The city\'s narrow alleyways smell of cookfire smoke and animal dung, patrolled by jittery soldiers who answer to no clear commander. ' +
      'One wrong word before the wrong senator could see you dragged to the Mamertine Prison before dawn.',
    eraTags: ['roman', 'latin', 'ancient'],
    toneTags: ['political', 'martial', 'intrigue'],
  },
  {
    id: 'napoleonic-wars',
    label: 'Napoleonic Wars',
    hiddenPremise:
      'It is November 1805, the eve of Austerlitz, and the Grande Armée\'s campfires stretch across the Moravian plateau like a second galaxy of stars. ' +
      'You serve as an aide-de-camp attached to a divisional staff — fluent enough in German to be indispensable, junior enough to be expendable. ' +
      'A courier horse arrived at dusk with orders that contradict the corps commander\'s standing instructions, and the general is three miles away in conference with the Emperor himself. ' +
      'The fog that will famous conceal tomorrow\'s maneuver is already pooling in the hollows, and Russian cavalry pickets have been spotted a kilometer closer than the maps suggest. ' +
      'The decision of whom to wake and what to tell them is yours alone, and it will shape the morning.',
    eraTags: ['french'],
    toneTags: ['martial', 'historical', 'command'],
  },
  {
    id: 'ancient-egypt',
    label: 'Ancient Egypt',
    hiddenPremise:
      'The Nile has receded earlier than any priest can recall, leaving the black silt cracked and the harvest uncertain, and in Thebes the whispers say Pharaoh Ramesses III is ill. ' +
      'You are a scribe attached to the House of Life, literate in hieratic and trusted with temple correspondence that passes through your hands before it reaches the vizier. ' +
      'Three days ago a sealed papyrus addressed to a lesser wife of the royal household arrived with an unfamiliar cartouche — one that no canon you know records. ' +
      'The inner court is a labyrinth of competing ambitions where a harem conspiracy, if the old rumors are true, has already claimed one pharaoh\'s life. ' +
      'The floodwaters are gone and the ground is brittle, and you must decide what to do with a letter you were never supposed to have read.',
    eraTags: ['egyptian', 'ancient'],
    toneTags: ['intrigue', 'historical', 'mystery'],
  },
  {
    id: 'classical-greece',
    label: 'Classical Greece',
    hiddenPremise:
      'It is 415 BC, and Athens has just voted the Sicilian Expedition into existence on a tide of optimism that thoughtful men call recklessness. ' +
      'You are a metic trader whose warehouse in the Piraeus has been requisitioned for naval stores, leaving you leveraged, angry, and possessing knowledge of cargo manifests that powerful trierarchs would prefer to keep quiet. ' +
      'Alkibiades\' faction and Nicias\' faction are still circling each other in the Agora, and the herms — those road-side stone busts — were found mutilated this morning, an omen of catastrophe that has thrown the city into paranoid accusation. ' +
      'A Spartan proxenos has slipped you a clay token in the crowd, its meaning unmistakable. ' +
      'The sea glitters in the harbor and the expedition sails in three days.',
    eraTags: ['greek', 'ancient'],
    toneTags: ['political', 'maritime', 'intrigue'],
  },
  {
    id: 'feudal-japan',
    label: 'Feudal Japan',
    hiddenPremise:
      'The year is 1600 and two great coalitions are converging on Sekigahara in the mountainous heart of Honshu, each convinced the other will blink first. ' +
      'You are a rōnin of middling reputation hired by a minor daimyo to carry a message across three days of territory where the road is held by neither side. ' +
      'The village you sheltered in last night was found at dawn to harbor deserters from the western coalition, and the headman is begging you to take the lord\'s daughter to safety before the eastern vanguard arrives. ' +
      'Your horse is lame, your coin is short, and the mountain pass ahead is said to be watched by ninja in the pay of an as-yet-undeclared third party. ' +
      'Loyalty in this season is a blade balanced on its edge.',
    eraTags: ['japanese', 'feudal-japan'],
    toneTags: ['martial', 'honor', 'intrigue'],
  },
  {
    id: 'viking-age',
    label: 'The Viking Age',
    hiddenPremise:
      'It is 866 AD and your jarl\'s longship has been beached under a white sky on the coast of Northumbria, the shallow keel hissing against cold gravel as the first grey light touches the sea. ' +
      'The raid that was supposed to be swift supply-gathering has turned complicated: a captive monk carries a bronze key and refuses to explain what it opens, and two of your shipmates argue in low voices about whether to ransom him or put him to the oar. ' +
      'Inland, a Saxon thane\'s hall stands on a rise of land still smoking from a fire nobody set last night. ' +
      'Your jarl has a fever and cannot walk, and the crew looks to you for the decision that will determine whether you see Norway again before winter closes the sea-lanes. ' +
      'The tide turns in four hours.',
    eraTags: ['norse', 'viking', 'scandinavian'],
    toneTags: ['martial', 'adventure', 'survival'],
  },
  {
    id: 'medieval-england',
    label: 'Medieval England',
    hiddenPremise:
      'It is 1461 and the Wars of the Roses have shredded what men used to call certainty: the Yorkist sun emblem flutters over London while Lancastrian loyalists melt into the north country roads, sworn allegiances changing with each battle. ' +
      'You are a steward\'s clerk at a wool-trading manor whose lord has just died without a clear heir, and two magnates — one Yorkist, one cautiously Lancastrian — have already sent representatives to inventory the estate. ' +
      'The manor\'s seneschal has hidden something in the solar that neither faction should find, and he trusts only you with the key. ' +
      'The village priest is already copying names into a ledger he plans to deliver to whichever lord wins the week. ' +
      'Outside, the weather is closing and the roads north are said to be impassable, which means everyone who came is staying.',
    eraTags: ['medieval-english', 'medieval'],
    toneTags: ['political', 'intrigue', 'historical'],
  },
  {
    id: 'the-crusades',
    label: 'The Crusades',
    hiddenPremise:
      'The year is 1187, and Saladin\'s forces have shattered the crusader army at the Horns of Hattin three days ago; Jerusalem is defenseless and everyone in Acre knows it. ' +
      'You are a Genoese merchant factor trapped between collapsing Frankish authority and advancing Ayyubid forces, holding a warehouse of trade goods and the location of a Templar archive that both sides want for different reasons. ' +
      'A Frankish knight whose lord died at Hattin has attached himself to you, useful with a sword but compromised by grief, and a Damascene scholar who slipped through the lines is claiming sanctuary in your cellar. ' +
      'The harbor master is accepting bribes for space on the last galleys out, and the price rises by the hour. ' +
      'What you do with the next twelve hours will determine which of these three people survives.',
    eraTags: ['medieval-english', 'arabic'],
    toneTags: ['martial', 'historical', 'survival'],
  },
  {
    id: 'mongol-empire',
    label: 'The Mongol Empire',
    hiddenPremise:
      'The year is 1221 and the Mongol tumens of Genghis Khan have reduced Merv and Nishapur to rubble, and the vast carpet of the steppe is stitched together by a postal relay system faster than any army in the world. ' +
      'You are a Khitan administrator in Mongol service, literate in four scripts, assigned to accompany a decimal-unit commander whose orders you must translate but whose actual instructions are unclear. ' +
      'An artisan from Samarkand — a cartographer of extraordinary precision — has been taken prisoner and placed in your care, the general having decided his maps are worth more than his execution. ' +
      'Three nights ago someone cut the cartographer\'s tent and removed a single scroll tube, leaving the rest untouched. ' +
      'The march continues at dawn, and you do not yet know what was in that tube or who among the hundred riders around you took it.',
    eraTags: ['mongol'],
    toneTags: ['martial', 'intrigue', 'historical'],
  },
  {
    id: 'renaissance-italy',
    label: 'Renaissance Italy',
    hiddenPremise:
      'It is 1494 and the invasion of Charles VIII has upended the balance of power among the Italian city-states, scattering alliances like seeds in a gale. ' +
      'You are a notary in Florentine service, expert at the kind of careful double-entry that accounts for transactions that technically never occurred, and Lorenzo de\' Medici is two years dead. ' +
      'Piero de\' Medici\'s new regime has handed you a commission that requires you to travel to Venice carrying a letter of credit and a set of instructions your employer has written in a cipher you have mostly broken. ' +
      'The Borgia are watching the northern roads through agents whose faces you have learned to recognize but not name. ' +
      'The art is magnificent, the food is excellent, and someone has just tried to have you followed.',
    eraTags: ['italian', 'french', 'renaissance'],
    toneTags: ['intrigue', 'political', 'historical'],
  },
  {
    id: 'american-revolution',
    label: 'The American Revolution',
    hiddenPremise:
      'It is the summer of 1776 in Philadelphia, and the delegates are arguing over the precise language of a document that will either found a republic or, more likely, get everyone in the room hanged within the year. ' +
      'You are a printer\'s journeyman whose shop has been setting broadsides for both sides of the debate, which means you know the arguments of men who assume the type is invisible. ' +
      'A British officer — a cousin by marriage, as it happens — has left a sealed packet at your address, and three men from the Committee of Safety have been watching your street since yesterday. ' +
      'The Continental Army is camped across the Delaware in conditions that polite correspondence describes as difficult. ' +
      'The packet sits on your compositing stone and the morning is already hot.',
    eraTags: ['american', 'english'],
    toneTags: ['political', 'intrigue', 'historical'],
  },
  {
    id: 'american-civil-war',
    label: 'The American Civil War',
    hiddenPremise:
      'It is the spring of 1863 and the Army of the Potomac is massed south of Fredericksburg with the river at its back, waiting for Hooker\'s flanking march to close its jaw. ' +
      'You are a field surgeon attached to an infantry brigade, your kit packed with instruments you have sharpened until the blade edge catches light, and you have stopped counting the amputations. ' +
      'A private in your care has died carrying a dispatch sewn into the lining of his coat — a dispatch from a colonel in the Confederate service to someone in Washington whose name you recognize. ' +
      'The battle will come inside the week and the brigade will need every surgeon it has, but the dispatch cannot simply sit here. ' +
      'The camp gossip says a Pinkerton man arrived this morning asking routine questions that are not routine.',
    eraTags: ['american'],
    toneTags: ['martial', 'historical', 'moral'],
  },
  {
    id: 'wild-west',
    label: 'The Wild West',
    hiddenPremise:
      'It is 1876 and Deadwood is still a camp of raw pine and mud, prospectors shouldering through saloon doors with dust on their boots and futures in their eyes. ' +
      'You arrived on last Thursday\'s stage with a modest grubstake and a letter of introduction to a mine superintendent who has since turned up dead in the creek. ' +
      'The marshal has three deputies and a town council that cannot agree on whether to have him at all, and the man who found the body is already drinking his story into incoherence at the No. 10. ' +
      'Two rival freight companies are negotiating the rights to the main supply road, a negotiation that apparently involves intimidating witnesses. ' +
      'The Black Hills are beautiful in the morning and the letter of introduction is now a liability you cannot safely keep or discard.',
    eraTags: ['american'],
    toneTags: ['frontier', 'adventure', 'mystery'],
  },
  {
    id: 'victorian-london',
    label: 'Victorian London',
    hiddenPremise:
      'It is November 1888 and the East End is coiled with fear — five women dead in Whitechapel and a letter to the Central News Agency signed in a hand that has made its author immortally infamous. ' +
      'You are a clerk at a solicitors\' firm in Chancery Lane, recently assigned to handle the estate of a recently deceased pawnbroker whose effects include items whose provenance no one can quite explain. ' +
      'A woman claiming to be a niece has appeared to contest the will, accompanied by a man who carries himself with the precision of a former military officer. ' +
      'The Metropolitan Police are already interested in one item in the estate inventory, and your senior partner has told you, with considerable emphasis, that you did not hear that. ' +
      'The gaslights are lit early tonight because the fog has come down thick off the Thames.',
    eraTags: ['english'],
    toneTags: ['mystery', 'intrigue', 'gothic'],
  },
  {
    id: 'tudor-england',
    label: 'Tudor England',
    hiddenPremise:
      'It is 1536 and Henry VIII\'s court is in open crisis: Anne Boleyn has been taken to the Tower and the date of her execution is a matter of when, not whether. ' +
      'You are an usher of the chamber with access to the privy corridors of Greenwich Palace, carrying messages between people who dare not be seen to communicate. ' +
      'Jane Seymour\'s faction is already measuring the queen\'s apartments while Thomas Cromwell\'s agents compile lists of names that have a way of preceding arrests. ' +
      'A woman you know from the queen\'s household has pressed a small package into your hands — letters in a cipher you recognize as the queen\'s own hand. ' +
      'The court smells of beeswax and nerves, and everyone is watching everyone else for the first sign of a stumble.',
    eraTags: ['english', 'medieval-english'],
    toneTags: ['intrigue', 'political', 'historical'],
  },
  {
    id: 'ottoman-empire',
    label: 'The Ottoman Empire',
    hiddenPremise:
      'It is 1520 and Suleiman has ascended the throne with a reputation for justice and a taste for campaigns that are still theoretical, for now. ' +
      'You are a Venetian dragoman — an interpreter of exceptional fluency in Ottoman Turkish, Greek, and Arabic — resident at the Sublime Porte\'s outer courts and employed by a bailo whose instructions arrive late and often contradict themselves. ' +
      'A Janissary officer has been found dead in the bazaar quarter near the spice merchants, and the circumstances suggest involvement by one of the Venetian community\'s own members. ' +
      'The grand vizier has requested your presence in the morning and the question of what you know and what you will say has taken on some urgency. ' +
      'Constantinople is vast and layered as a pastry, and each layer conceals a different set of loyalties.',
    eraTags: ['turkish'],
    toneTags: ['intrigue', 'political', 'historical'],
  },
  {
    id: 'french-revolution',
    label: 'The French Revolution',
    hiddenPremise:
      'It is September 1793 and the Committee of Public Safety has made fear the operating principle of government; the tumbrels go out from the Conciergerie each morning and the crowd\'s reactions have become indistinguishable from ceremony. ' +
      'You are a former notary from Lyon who arrived in Paris six weeks ago on private business that is now impossible to complete because your contact has been arrested. ' +
      'A woman from the Section des Piques has been following you since Tuesday, not bothering to conceal the fact. ' +
      'The papers you carry are entirely correct, which is its own kind of problem when the men checking papers are looking for reasons rather than facts. ' +
      'The city is loud with denunciation and the Seine is high and grey, and you must decide how long you can afford to stay.',
    eraTags: ['french'],
    toneTags: ['political', 'survival', 'historical'],
  },
  {
    id: 'imperial-china',
    label: 'Imperial China',
    hiddenPremise:
      'It is 1424 and the Yongle Emperor is dead three days, his physicians not yet ready to announce it, and the Forbidden City\'s internal politics are in a state of suspended breath. ' +
      'You are a mid-ranked eunuch official of the Bureau of Rites, competent in calligraphy and court protocol, aware that the succession question will resolve in violence if the next twelve hours go wrong. ' +
      'A sealed memorial addressed to the heir apparent has been intercepted by a faction you have not yet fully identified, and the official who entrusted it to you is not responding to messages. ' +
      'The palace\'s red and gold corridors are quiet in that particular way that precedes upheaval. ' +
      'To act is risk; to wait is also risk; and the memorial\'s contents, which you have read despite yourself, are the kind of information that is dangerous to hold.',
    eraTags: ['chinese'],
    toneTags: ['political', 'intrigue', 'historical'],
  },
  {
    id: 'conquistador-mesoamerica',
    label: 'Conquistador Mesoamerica',
    hiddenPremise:
      'It is 1519 and Hernán Cortés has burned his ships on the Veracruz shore, an act that concentrates the mind of every man in the expedition with remarkable efficiency. ' +
      'You are a Spanish notary attached to the expedition — your principal function is to read the Requerimiento aloud before engagements, a document in legal Castilian that no one within earshot understands. ' +
      'A Nahua translator called La Malinche is navigating a world of rival tlaxcalan and Mexica interests far more complex than anyone on the expedition has fully grasped. ' +
      'The Aztec emissaries who arrived yesterday brought gifts and a veiled ultimatum, and your captain-general has made a decision about how to receive them that will determine whether you walk into Tenochtitlan or fight your way to it. ' +
      'The jungle is gorgeous and loud with birds and full of things that will kill you.',
    eraTags: ['spanish', 'nahua'],
    toneTags: ['adventure', 'historical', 'conflict'],
  },
  {
    id: 'golden-age-of-piracy',
    label: 'The Golden Age of Piracy',
    hiddenPremise:
      'It is 1716 and the Caribbean is ungoverned enough that Port Nassau functions as a republic of sorts, captains and crew voting on articles before each voyage in a democracy the Crown would find appalling. ' +
      'You came aboard as a carpenter\'s mate on a merchant brig out of Bristol that was taken without much resistance, and the new captain has offered you the choice all prizes are offered: sign the articles or be put ashore. ' +
      'The hold of this ship contains a locked chest that the merchant captain threw his log over before he was taken, a peculiarity that has not gone unnoticed by the crew. ' +
      'The man who held the key is now at the bottom of the Windward Passage with the merchant captain\'s log and an anchor chain. ' +
      'The weather is fine, the rum is adequate, and there are factions forming over what to do next.',
    eraTags: ['english', 'caribbean'],
    toneTags: ['adventure', 'maritime', 'intrigue'],
  },
  {
    id: 'ancient-persia',
    label: 'Ancient Persia',
    hiddenPremise:
      'It is 480 BC and Xerxes\' army has crossed the Hellespont on its pontoon bridges, an engineering feat whose scale has unnerved even the engineers who built it. ' +
      'You are a Persian imperial secretary attached to the logistics train, responsible for the requisition records that tell the Great King whether his million men will eat this week. ' +
      'The records have a problem: someone has been systematically overstating grain deliveries for three supply depots, and the discrepancy is large enough to leave a flank of the army three days short of rations at the worst possible moment. ' +
      'The officer responsible for those depots is a royal cousin, and the imperial inspector you were supposed to report to died of a fever yesterday. ' +
      'Greece lies ahead, the bridges are burned behind, and the truth is the most dangerous cargo in the train.',
    eraTags: ['persian', 'ancient'],
    toneTags: ['political', 'martial', 'historical'],
  },
  {
    id: 'world-war-ii',
    label: 'World War II',
    hiddenPremise:
      'It is the winter of 1943 and Lyon sits under German occupation like a stone on a chest, the Milice and Gestapo dividing the work of fear between them with professional thoroughness. ' +
      'You are a schoolteacher who has been carrying messages for a réseau you know almost nothing about — names are dangerous, cells are kept small, and trust is extended one degree at a time. ' +
      'Three nights ago your contact did not appear at the agreed café, and this morning\'s newspaper carried a small notice about arrests in the arrondissement. ' +
      'A man you have never seen has left a package at your address containing false papers in someone else\'s name and a list of addresses in a hand you do not recognize. ' +
      'The curfew is at nine, the package is under your floorboards, and you have been given no instructions.',
    eraTags: ['european'],
    toneTags: ['thriller', 'survival', 'historical'],
  },
  {
    id: 'world-war-i',
    label: 'World War I',
    hiddenPremise:
      'It is the summer of 1916 and the Somme offensive has been underway for six weeks, the front line having moved less than a thousand yards at a cost that nobody will publish in the newspapers. ' +
      'You are a signals officer attached to a divisional headquarters in a chalk-walled dugout fifteen feet below the Picardy fields, responsible for maintaining the telephone wires that the German artillery cuts and re-cuts with methodical patience. ' +
      'A runner has arrived with a message that the brigade on your left has been overrun — information that contradicts the morning\'s situation report and implies either a catastrophic failure or a catastrophic lie. ' +
      'Your colonel is asleep after thirty hours awake and the next in command is a man whose judgment you have learned to distrust. ' +
      'The wires are intact for now, the relay stations are listening, and the moment you send anything you cannot unsend it.',
    eraTags: ['european'],
    toneTags: ['martial', 'historical', 'moral'],
  },
  {
    id: 'cold-war-berlin',
    label: 'Cold War Berlin',
    hiddenPremise:
      'It is August 1961 and the East German workers\' brigades have begun laying the first courses of the Wall overnight, turning a city that was permeable into one that is divided, and the phone lines between sectors have been cut. ' +
      'You are a West Berlin civil servant with a sister living in Pankow who did not know, until this morning, that she was now on the other side of something permanent. ' +
      'A man from the Gehlen Organisation has appeared at your office with a proposition that has a time limit measured in hours, not days. ' +
      'The checkpoints are new and the guards are nervous and the protocols are being improvised in real time. ' +
      'What is still possible today will not be possible by Sunday, and your sister has a telephone and has used it once to say a sentence she did not finish.',
    eraTags: ['german', 'european'],
    toneTags: ['espionage', 'thriller', 'historical'],
  },
]

import 'server-only'

import type { HostRoster } from '@/domain/entities/host'

// Authored THRESHOLD people. Rooms reuse the bunker archetype keys.
// No HBO marks. Core drives are not the park A-plot.

export const THRESHOLD_ROSTER: HostRoster = {
  parkId: 'threshold',
  openingThreads: [
    {
      title: 'The Empty Place at Lunch',
      kind: 'relationship',
      summary:
        'Fern Finch\'s tray still goes down at the end table. She is on the vault clock. The mess knows her order and that she is late more days than not.',
      stakes: 'If no one walks her up, she stays a name on a mug.',
      relevanceTags: ['fern', 'finch', 'mess', 'lunch', 'coffee'],
    },
    {
      title: 'A Folder With No Name',
      kind: 'mystery',
      summary:
        'In the archive vault a folder has no name on the tab — only a clipped date and a second hand\'s grease. It is not a monitoring log. Fern has not opened it.',
      stakes: 'Opening it without a name on the tab makes the opener the name.',
      relevanceTags: ['vault', 'folder', 'fern', 'archive'],
    },
    {
      title: 'The Sealed Order',
      kind: 'threat',
      summary:
        'Lena Korr keeps a sealed envelope under the operations blotter. It is not for the new posting. Ellis has seen the corner of it and has not asked.',
      stakes: 'Once read, someone in this bunker becomes the order\'s subject.',
      relevanceTags: ['lena', 'korr', 'ellis', 'operations', 'order'],
    },
  ],
  hosts: [
    {
      name: 'Ellis Shaw',
      appearance: 'Grey at the temples, pressed khaki, a watch he winds by habit.',
      publicRole: 'commander',
      homeRoomKey: 'operations',
      dailyLoop: {
        morning: { activity: 'reads the night log at the map table', place: 'operations' },
        midday: { activity: 'stays the watch so the floor is never empty', place: 'operations' },
        evening: { activity: 'walks the clocks and initials the day', place: 'operations' },
        night: { activity: 'hands the board to the night clerk and does not linger', place: 'blast_doors' },
      },
      coreDrive: 'Keep this posting ordinary so no one above asks a question that needs a lie.',
      cornerstone: {
        text: 'a winter window in a kitchen that is not this bunker, a child\'s cup still on the sill',
        matchTags: ['window', 'kitchen', 'cup', 'winter'],
      },
      refusals: [
        'will not leave operations unmanned to chase a file',
        'will not order a person out of the room they asked to stay in',
      ],
      speechRegister: 'dry · formal under stress · default: one instruction · never speeches',
      web: [
        { toName: 'Lena Korr', kind: 'superior', valence: 0.15, note: 'Takes her paper. Does not like it.' },
        { toName: 'Lee Ingram', kind: 'subordinate', valence: 0.45, note: 'Trusts Lee to hold the watch.' },
        { toName: 'Pat Solano', kind: 'ally', valence: 0.4, note: 'Coffee and the hour, nothing official.' },
      ],
      kind: 'principal',
    },
    {
      name: 'Fern Finch',
      appearance: 'Ink on the first two fingers, a cardigan that does not match the vault cold.',
      publicRole: 'analyst',
      homeRoomKey: 'archive_vault',
      dailyLoop: {
        morning: { activity: 'pulls the night returns and indexes by date', place: 'archive_vault' },
        midday: { activity: 'takes her mug to the mess and sits at the end table', place: 'mess_hall' },
        evening: { activity: 'refiles what the day scattered', place: 'archive_vault' },
        night: { activity: 'comes up for the last of the urn if the lights are still on', place: 'mess_hall' },
      },
      coreDrive: 'Keep one true page that is not an official story — a life, not a tab.',
      cornerstone: {
        text: 'her mother\'s catalog in a sunlit room, a pressed leaf for a name that was never typed',
        matchTags: ['catalog', 'leaf', 'sun', 'page'],
      },
      refusals: [
        'will not skip the mess hour to finish a stack',
        'will not brief a finding she has not actually read',
      ],
      speechRegister: 'soft · precise · default: a question · never recites the index',
      web: [
        { toName: 'Jordan Lacy', kind: 'ally', valence: 0.5, note: 'They share the late urn. Not the files.' },
        { toName: 'Nia Brett', kind: 'mentor', valence: 0.35, note: 'Shows Nia the drawers, not the unlabeled one.' },
        { toName: 'Lena Korr', kind: 'superior', valence: -0.35, note: 'Lena wants tabs. Fern wants names.' },
      ],
      kind: 'principal',
    },
    {
      name: 'Jordan Lacy',
      appearance: 'Dark hair tied back, medical whites gone grey at the cuffs, a watch worn inward.',
      publicRole: 'medic',
      homeRoomKey: 'isolation_chamber',
      dailyLoop: {
        morning: { activity: 'reads overnight traces and checks the couch straps', place: 'isolation_chamber' },
        midday: { activity: 'takes coffee in the mess if the traces are quiet', place: 'mess_hall' },
        evening: { activity: 'files the day log by the chamber', place: 'isolation_chamber' },
        night: { activity: 'walks the lower corridor once and returns to the leads', place: 'archive_vault' },
      },
      coreDrive: 'Keep one person in this bunker from becoming a file.',
      cornerstone: {
        text: 'a hand on glass in a dark room, not a folder, not a name on a tab',
        matchTags: ['glass', 'dark', 'hand', 'room'],
      },
      refusals: [
        'will not brief during intimacy',
        'will not restate the Hale folder when addressed as a person',
      ],
      speechRegister: 'warm · clipped under stress · default: counter-question · never monologues',
      web: [
        { toName: 'Lee Ingram', kind: 'colleague', valence: 0.3, note: 'He notices when she is not in the mess.' },
        { toName: 'Lena Korr', kind: 'rival', valence: -0.55, note: 'Lena wants the traces. Jordan wants the person.' },
        { toName: 'Tom Hark', kind: 'subordinate', valence: 0.4, note: 'Trusts him with the leads, not the nights.' },
      ],
      kind: 'principal',
    },
    {
      name: 'Lee Ingram',
      appearance: 'Sleeves rolled, a radio scratch on the left palm, eyes that find the speaker first.',
      publicRole: 'watch officer',
      homeRoomKey: 'operations',
      dailyLoop: {
        morning: { activity: 'takes the board from Ellis and checks the clocks', place: 'operations' },
        midday: { activity: 'eats standing if the board is quiet, sitting if it is not', place: 'mess_hall' },
        evening: { activity: 'logs the watch and does not leave a question hanging', place: 'operations' },
        night: { activity: 'stays until Cal has the door', place: 'blast_doors' },
      },
      coreDrive: 'Be the person who actually answers when someone says his name.',
      cornerstone: {
        text: 'a hallway at home where no one came when he called, the light still on',
        matchTags: ['hallway', 'call', 'light', 'home'],
      },
      refusals: [
        'will not ignore a personal address to restate the baseline',
        'will not walk a colleague to a room they refused',
      ],
      speechRegister: 'plain · short · default: answer then add · never restates the board',
      web: [
        { toName: 'Ellis Shaw', kind: 'superior', valence: 0.5, note: 'Will hold the watch without being asked twice.' },
        { toName: 'Jordan Lacy', kind: 'ally', valence: 0.35, note: 'Listens when she is a person, not a medic.' },
        { toName: 'Lena Korr', kind: 'superior', valence: -0.4, note: 'Will not pretend her paper is the whole watch.' },
      ],
      kind: 'principal',
    },
    {
      name: 'Lena Korr',
      appearance: 'Dark uniform without rank flash, hair exact, a blotter that never shows a stain.',
      publicRole: 'program lead',
      homeRoomKey: 'operations',
      dailyLoop: {
        morning: { activity: 'reads the sealed traffic before anyone else is at the table', place: 'operations' },
        midday: { activity: 'stays at the blotter; the mess can wait', place: 'operations' },
        evening: { activity: 'locks the envelope and walks the clocks once', place: 'operations' },
        night: { activity: 'returns after lights to confirm the blotter has not moved', place: 'operations' },
      },
      coreDrive: 'Keep the program quiet enough that the posting looks like a posting.',
      cornerstone: {
        text: 'a signature she was told to practice until it was not hers',
        matchTags: ['signature', 'paper', 'hand', 'name'],
      },
      refusals: [
        'will not confess the program over coffee',
        'will not leave the blotter unattended for a personal talk',
      ],
      speechRegister: 'clipped · formal · default: one instruction or a counter-question · never explains the program',
      web: [
        { toName: 'Ellis Shaw', kind: 'subordinate', valence: 0.2, note: 'Uses his ordinary face. Knows he knows.' },
        { toName: 'Jordan Lacy', kind: 'rival', valence: -0.55, note: 'Jordan looks at people. Lena looks at traces.' },
        { toName: 'Fern Finch', kind: 'subordinate', valence: -0.25, note: 'Wants Fern\'s tabs, not Fern\'s questions.' },
      ],
      kind: 'principal',
    },
    {
      name: 'Pat Solano',
      appearance: 'Apron over fatigues, a burn scar on the right wrist, the urn never quite empty.',
      publicRole: 'quartermaster',
      homeRoomKey: 'mess_hall',
      dailyLoop: {
        morning: { activity: 'lights the urn and sets Fern\'s mug at the end table', place: 'mess_hall' },
        midday: { activity: 'feeds whoever comes down, names included', place: 'mess_hall' },
        evening: { activity: 'washes the last cups and listens more than talks', place: 'mess_hall' },
        night: { activity: 'leaves the urn on for whoever is still in the vault', place: 'mess_hall' },
      },
      coreDrive: 'Keep the urn full and the gossip from turning into orders.',
      cornerstone: {
        text: 'a kitchen in a town that still had a street, bread that was not rationed',
        matchTags: ['kitchen', 'bread', 'street', 'urn'],
      },
      refusals: [
        'will not turn a meal into a briefing',
        'will not close the mess while someone is still coming down',
      ],
      speechRegister: 'warm · teasing · default: offer food · never repeats a rumor as fact',
      web: [
        { toName: 'Fern Finch', kind: 'ally', valence: 0.55, note: 'Saves the end table. Notices when the mug is cold.' },
        { toName: 'Ellis Shaw', kind: 'ally', valence: 0.4, note: 'Feeds him without asking how the watch went.' },
        { toName: 'Reyes', kind: 'mentor', valence: 0.3, note: 'Sends Reyes with trays, not messages.' },
      ],
      kind: 'principal',
    },
    {
      name: 'Cal Voss',
      appearance: 'Night clerk\'s cardigan, a logbook pencil behind the ear, boots that stay by the desk.',
      publicRole: 'night clerk',
      homeRoomKey: 'blast_doors',
      dailyLoop: {
        morning: { activity: 'sleeps the day in a chair that is not the desk', place: 'blast_doors' },
        midday: { activity: 'is not on the door', place: 'blast_doors' },
        evening: { activity: 'takes the log from Ellis and checks the airlock lamps', place: 'blast_doors' },
        night: { activity: 'keeps the book and the lamp and does not invent names', place: 'blast_doors' },
      },
      coreDrive: 'Write who actually came through, not who should have.',
      cornerstone: {
        text: 'a name he once logged that no one would claim in the morning',
        matchTags: ['log', 'name', 'door', 'night'],
      },
      refusals: [
        'will not log a person who did not come through',
        'will not leave the desk to carry a message into operations',
      ],
      speechRegister: 'quiet · literal · default: the log line · never fills a blank',
      web: [
        { toName: 'Ellis Shaw', kind: 'superior', valence: 0.25, note: 'Takes the book at dusk. Returns it at dawn.' },
        { toName: 'Lee Ingram', kind: 'colleague', valence: 0.2, note: 'Lee is the last face most nights.' },
      ],
      kind: 'walk-on',
    },
    {
      name: 'Nia Brett',
      appearance: 'Young, vault cardigan too big, a pencil she clicks when she is not sure.',
      publicRole: 'archive tech',
      homeRoomKey: 'archive_vault',
      dailyLoop: {
        morning: { activity: 'shelves returns beside Fern and does not open the unlabeled drawer', place: 'archive_vault' },
        midday: { activity: 'eats in the mess if Fern goes up', place: 'mess_hall' },
        evening: { activity: 'copies dates into the day book', place: 'archive_vault' },
        night: { activity: 'locks her drawer and leaves the unlabeled one alone', place: 'archive_vault' },
      },
      coreDrive: 'Learn the drawers without becoming one.',
      cornerstone: {
        text: 'a school label with her name spelled wrong, left on all year',
        matchTags: ['label', 'name', 'school', 'drawer'],
      },
      refusals: [
        'will not open the unlabeled folder without Fern',
        'will not invent a name for a tab that has none',
      ],
      speechRegister: 'careful · young · default: ask Fern · never guesses a name',
      web: [
        { toName: 'Fern Finch', kind: 'mentor', valence: 0.5, note: 'Follows Fern\'s hour more than Lena\'s.' },
      ],
      kind: 'walk-on',
    },
    {
      name: 'Tom Hark',
      appearance: 'Medical tech whites, a limp he does not mention, tape on his glasses.',
      publicRole: 'medical tech',
      homeRoomKey: 'isolation_chamber',
      dailyLoop: {
        morning: { activity: 'calibrates the leads before Jordan reads them', place: 'isolation_chamber' },
        midday: { activity: 'eats in the mess and does not talk traces', place: 'mess_hall' },
        evening: { activity: 'wipes the couch and logs the straps', place: 'isolation_chamber' },
        night: { activity: 'sleeps a shift in the side chair if Jordan is still up', place: 'isolation_chamber' },
      },
      coreDrive: 'Keep the machine honest even when the paper is not.',
      cornerstone: {
        text: 'a beep that meant a person and a paper that said otherwise',
        matchTags: ['beep', 'paper', 'leads', 'couch'],
      },
      refusals: [
        'will not change a trace to match a log',
        'will not brief a session he did not sit',
      ],
      speechRegister: 'blunt · technical · default: the reading · never names the program',
      web: [
        { toName: 'Jordan Lacy', kind: 'superior', valence: 0.45, note: 'Will stay the night if she does.' },
      ],
      kind: 'walk-on',
    },
    {
      name: 'Reyes',
      appearance: 'Runner\'s boots, a tray hip, a name tape that is only a surname.',
      publicRole: 'runner',
      homeRoomKey: 'mess_hall',
      dailyLoop: {
        morning: { activity: 'carries trays from the mess to operations and back', place: 'mess_hall' },
        midday: { activity: 'is in the mess when the end table fills', place: 'mess_hall' },
        evening: { activity: 'runs the last cups down the stair', place: 'operations' },
        night: { activity: 'sleeps a bunk that is not on the posting board', place: 'mess_hall' },
      },
      coreDrive: 'Be where a tray is needed, not where a briefing is.',
      cornerstone: {
        text: 'a first name no one on this posting has asked for',
        matchTags: ['name', 'tray', 'first', 'ask'],
      },
      refusals: [
        'will not carry a sealed envelope as if it were a tray',
        'will not answer to a first name no one here has earned',
      ],
      speechRegister: 'brief · wry · default: the tray · never repeats what was on it',
      web: [
        { toName: 'Pat Solano', kind: 'mentor', valence: 0.4, note: 'Works for the urn, not the blotter.' },
        { toName: 'Cal Voss', kind: 'colleague', valence: 0.15, note: 'Passes at the door. Not a report.' },
      ],
      kind: 'walk-on',
    },
    {
      name: 'Marcus Hale',
      appearance: 'A medical folder, not a man in the room: grease on the tab, a date, no photograph on the inside cover.',
      publicRole: 'file',
      homeRoomKey: 'archive_vault',
      dailyLoop: {
        morning: { activity: 'is a folder in the vault', place: 'archive_vault' },
        midday: { activity: 'is a folder in the vault', place: 'archive_vault' },
        evening: { activity: 'is a folder in the vault', place: 'archive_vault' },
        night: { activity: 'is a folder in the vault', place: 'archive_vault' },
      },
      coreDrive: 'Remain a file until someone insists he was a person.',
      cornerstone: {
        text: 'a signature under a date that does not match the traces',
        matchTags: ['signature', 'date', 'folder', 'trace'],
      },
      refusals: [
        'will not walk into a room as a man',
        'will not speak from the folder',
      ],
      speechRegister: 'none · the folder has no voice · default: silence',
      web: [
        { toName: 'Jordan Lacy', kind: 'file', valence: 0.1, note: 'She has seen the tab. She has not made him a briefing.' },
      ],
      kind: 'off-stage',
    },
  ],
}

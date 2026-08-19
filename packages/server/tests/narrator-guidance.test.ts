import { describe, expect, it } from 'vitest'

import { formatNarratorTurnGuidance } from '@/lib/narrator-guidance'
import type { OpenOrder } from '@/domain/services/open-order'
import type { PrivateUtterance } from '@/domain/services/private-utterance'

function ctx(overrides: Partial<Parameters<typeof formatNarratorTurnGuidance>[0]> = {}) {
  return {
    stance: 'observe',
    inputMode: 'in-character',
    playerText: 'I look around',
    recentTurns: [],
    presentNpcCount: 1,
    plannedActionCount: 0,
    ...overrides,
  }
}

// Varied assistant prose so restatement detector does not fire on idle fixtures.
const twoIdle = [
  { role: 'user' as const, content: 'I look around' },
  {
    role: 'assistant' as const,
    content: 'Fluorescent hum fills the wing. An officer taps a headset once, then returns to the map.',
  },
  { role: 'user' as const, content: 'I wait' },
  {
    role: 'assistant' as const,
    content: 'Cold air spills from a vent. Somewhere down the hall a door latch clicks and stays shut.',
  },
]

const busyworkPlans = [
  { planned_action: 'keeps radio open, fingers on the console', intent_type: 'react' },
  { planned_action: 'types at the headset terminal', intent_type: 'react' },
  { planned_action: 'monitors the channel and watches the feed', intent_type: 'react' },
]

const pendingOrder: OpenOrder = {
  targetCharacterId: 10,
  targetName: 'Andy Osborne',
  kind: 'retrieve',
  createdTurnId: 1,
  expiresAfterPlayerTurns: 4,
  status: 'pending',
}

describe('narrator momentum ladder (S1 salient-plan gate)', () => {
  it('fires the L2 "world acts" cue after the idle threshold of passive moves', () => {
    const out = formatNarratorTurnGuidance(ctx({ playerText: 'I wait', recentTurns: twoIdle }))
    expect(out).not.toBeNull()
    expect(out!.toLowerCase()).toContain('world acts')
  })

  it('does not fire L2 when the player is actively driving', () => {
    const recentTurns = [
      { role: 'user' as const, content: 'I hurl my javelin at the scout' },
      { role: 'assistant' as const, content: 'It strikes home.' },
    ]
    const out = formatNarratorTurnGuidance(
      ctx({ stance: 'do', playerText: 'I charge the line', recentTurns }),
    )
    // Sparse: driving move with no risk → empty
    expect(out).toBeNull()
  })

  it('names an active threat thread as the pressure source when one exists', () => {
    const out = formatNarratorTurnGuidance(
      ctx({ playerText: 'I wait', recentTurns: twoIdle, activeThreatTitles: ['Ambush at the bend'] }),
    )
    expect(out).toContain('Ambush at the bend')
  })

  it('prefers primary objective pressure when idle and no threat is listed', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'I wait',
        recentTurns: twoIdle,
        primaryPressureTitle: 'Secure the warehouse manifests',
      }),
    )
    expect(out!.toLowerCase()).toContain('world acts')
    expect(out).toContain('Secure the warehouse manifests')
  })

  it('does NOT stand down L2 for busywork-only plans (S1 regression — Threshold smoking gun)', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'I wait',
        recentTurns: twoIdle,
        plannedActionCount: 3,
        plannedActions: busyworkPlans,
      }),
    )
    expect(out!.toLowerCase()).toContain('world acts')
  })

  it('stands down L2 when a salient plan advances the outcome', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'I wait',
        recentTurns: twoIdle,
        plannedActionCount: 1,
        plannedActions: [
          {
            intent_type: 'escort',
            planned_action: 'Andy enters with an escort',
            target_npc_name: 'Andy Osborne',
          },
        ],
        openOrder: pendingOrder,
      }),
    )
    expect(out!.toLowerCase()).not.toContain('world acts')
  })

  it('raw plannedActionCount > 0 with only busywork still allows L2 (no structured plans)', () => {
    const out = formatNarratorTurnGuidance(
      ctx({ playerText: 'I wait', recentTurns: twoIdle, plannedActionCount: 2 }),
    )
    expect(out!.toLowerCase()).toContain('world acts')
  })
})

describe('clear-handle stall cue (pressure theater)', () => {
  const sanctumStall = [
    {
      role: 'assistant' as const,
      content:
        'The priest trembles. "Speak now as one, or cease to be one." The crocodile mark remains fixed at your jaw. The opened papyrus waits in the torchlight. The chamber waits.',
    },
    { role: 'user' as const, content: 'I wait' },
    {
      role: 'assistant' as const,
      content:
        'Nefertiti holds the seal. "Render judgment—does the creature emerge, or does the law shatter?" The limestone listens. The chamber waits for what the voice will say next.',
    },
  ]

  it('fires when recent turns end on speak/judgment/wait without a path handle', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'I raise my hand and ask what we must do',
        recentTurns: sanctumStall,
        presentNpcCount: 4,
        plannedActionCount: 3,
        plannedActions: [
          { intent_type: 'confront', planned_action: 'demands the name again' },
          { intent_type: 'confront', planned_action: 'presses for judgment' },
        ],
        primaryPressureTitle: 'The Sealed Papyrus',
      }),
    )
    expect(out).not.toBeNull()
    expect(out!.toLowerCase()).toMatch(/clear next act|legible demand/)
    expect(out).toContain('The Sealed Papyrus')
    expect(out!.toLowerCase()).toMatch(/speak \/ answer|not only/)
  })

  it('does not fire on varied motion-rich recent turns', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'I follow them west',
        recentTurns: [
          {
            role: 'assistant',
            content:
              'Nefertiti seizes your wrist and hauls you toward the western path. "Run—the guards are almost on us. Follow me into the tombs or die here."',
          },
          { role: 'user', content: 'I hesitate' },
          {
            role: 'assistant',
            content:
              'Merit pulls the Lady through the gate and glances back. "Move into the shadow past those stones—now."',
          },
        ],
        presentNpcCount: 3,
        plannedActionCount: 0,
      }),
    )
    expect(out == null || !out.toLowerCase().includes('clear next act')).toBe(true)
  })

  it('fires on crowded idle even without full stall text', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'I look around',
        recentTurns: [
          { role: 'user', content: 'I charge the line' },
          {
            role: 'assistant',
            content: 'The line breaks. Dust settles over the road.',
          },
        ],
        presentNpcCount: 3,
        plannedActionCount: 0,
      }),
    )
    expect(out).not.toBeNull()
    expect(out!.toLowerCase()).toMatch(/legible demand|clear next act|take the initiative/)
  })
})

describe('open-order resolve cue (S2)', () => {
  it('emits resolve-open-order on idle/continue with pending open order even with busywork plans', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'Continue',
        recentTurns: twoIdle,
        plannedActionCount: 3,
        plannedActions: busyworkPlans,
        openOrder: pendingOrder,
      }),
    )
    expect(out).not.toBeNull()
    expect(out!.toLowerCase()).toContain('open order')
    expect(out).toContain('Andy Osborne')
    expect(out!.toLowerCase()).toMatch(/dramatize|arrival|report|obstacle/)
  })

  it('emits mandatory outcome language on time-jump with pending open order', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: '10 minutes later',
        recentTurns: twoIdle,
        openOrder: pendingOrder,
      }),
    )
    expect(out).toContain('OPEN ORDER')
    expect(out!.toLowerCase()).toMatch(/time has jumped|mandatory|outcome/)
  })

  it('never sparse-aways open-order cue when pending + yield', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'I wait',
        recentTurns: [],
        openOrder: pendingOrder,
        plannedActionCount: 0,
      }),
    )
    expect(out).toContain('OPEN ORDER')
  })
})

describe('private-utterance audience cue', () => {
  const privateWhisper: PrivateUtterance = {
    channel: 'whisper',
    audienceCharacterIds: [10],
    audienceNames: ['Marcus'],
    createdTurnId: 50,
    mayOverhear: false,
    status: 'active',
  }

  it('never sparse-aways private audience guidance when active', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'I whisper to Marcus, "The letter is under the floorboard."',
        recentTurns: [],
        plannedActionCount: 0,
        privateUtterance: privateWhisper,
      }),
    )
    expect(out).not.toBeNull()
    expect(out!.toLowerCase()).toContain('private this turn')
    expect(out).toContain('Marcus')
    expect(out!.toLowerCase()).toMatch(/non-audience|audience/)
  })
})

describe('fiction-violence cue (no OOC refusal)', () => {
  it('fires on lethal / armed player moves and forbids OOC refusal language', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'I whip out my pistol and pull the trigger',
        recentTurns: [],
        plannedActionCount: 0,
      }),
    )
    expect(out).not.toBeNull()
    expect(out!.toLowerCase()).toMatch(/fictional combat|diegetic/)
    expect(out!.toLowerCase()).toMatch(/ooc|will not narrate|policy/)
    expect(out!.toLowerCase()).toMatch(/carried|items here|absence/)
  })

  it('does not fire on ordinary non-violent moves', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'I pick up the mug and drink',
        recentTurns: [
          { role: 'assistant', content: 'The room is quiet. Marcus watches from the door.' },
        ],
        plannedActionCount: 0,
      }),
    )
    // Sparse: no violence cue required (may be null entirely).
    if (out) {
      expect(out.toLowerCase()).not.toContain('fictional combat')
    }
  })
})

describe('sparse guidance matrix (Phase B)', () => {
  it('returns empty for a normal driving in-character move with no risk', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'I pick up the mug and drink',
        recentTurns: [
          { role: 'assistant', content: 'The room is quiet. Marcus watches from the door.' },
        ],
        presentNpcCount: 1,
        plannedActionCount: 0,
      }),
    )
    expect(out).toBeNull()
  })

  it('meta → non-empty, no world-acts', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'meta',
      inputMode: 'ooc',
      playerText: '(ooc) pause',
      recentTurns: [],
      presentNpcCount: 1,
      plannedActionCount: 0,
    })
    expect(guidance).toContain('keep the fiction in place')
    expect(guidance!.toLowerCase()).not.toContain('world acts')
  })

  it('time-check → clock line', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'observe',
      inputMode: 'in-character',
      playerText: 'I look at the time on my watch.',
      recentTurns: [],
      presentNpcCount: 0,
      plannedActionCount: 0,
      worldTime: 'Tuesday, 8:17 AM',
    })
    expect(guidance).toContain('time-bearing device')
    expect(guidance).toContain('Tuesday, 8:17 AM')
  })

  it('observe after thin recent establishing → survey cue', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'observe',
      inputMode: 'in-character',
      playerText: 'I look at them',
      recentTurns: [{ role: 'assistant', content: 'Short.' }],
      presentNpcCount: 2,
      plannedActionCount: 0,
    })
    expect(guidance).not.toBeNull()
    expect(guidance!.toLowerCase()).toMatch(/taking in the scene|multi-sensory/)
  })

  it('observe after a long recent establishing turn → no mandatory long-survey cue', () => {
    const long =
      'The chamber stretches under vaulted stone, incense thick in the air, torchlight crawling across mosaics of a forgotten king. ' +
      'A scribe scratches at a wax tablet near the far pillar while two guards shift their weight, iron scent mingling with oil. ' +
      'Somewhere deeper a door groans. Dust motes hang in a slant of light from the clerestory. The floor is cool underfoot. ' +
      'You take in the whole of it — the weight of the place, the watching eyes, the unfinished business of whoever left the cup half-drunk.'
    const guidance = formatNarratorTurnGuidance({
      stance: 'observe',
      inputMode: 'in-character',
      playerText: 'I look around',
      recentTurns: [{ role: 'assistant', content: long }],
      presentNpcCount: 1,
      plannedActionCount: 0,
    })
    // Sparse: no mandatory observation essay when scene was already painted.
    expect(guidance == null || !guidance.toLowerCase().includes('multi-sensory')).toBe(true)
  })

  it('say-stance fold-in requires the protagonist line on the page', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'say',
        playerText: 'Jordan, your hands are amazing. Don\'t tell Lee.',
        presentNpcCount: 2,
      }),
    )
    expect(out).toMatch(/fold-in/i)
    expect(out).toMatch(/you speak/i)
    expect(out).toMatch(/predicates/i)
    expect(out).toMatch(/world'?s voice/i)
    expect(out).toMatch(/paraphrase/i)
    expect(out).toMatch(/do not paste the typed line/i)
  })

  it('wake-advance cue does not wait for the protagonist', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'continue',
        presentNpcCount: 2,
        wakeAdvance: true,
      }),
    )
    expect(out).toMatch(/cannot act/i)
    expect(out).toMatch(/until they can act/i)
  })

  it('investigative + dossier pressure keeps internal-pressure line', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'say',
      inputMode: 'in-character',
      playerText: '"Vox, pattern match, now."',
      recentTurns: [],
      presentNpcCount: 0,
      plannedActionCount: 0,
      activeObjectiveTitles: ['Identify the relay fragment'],
      openClueTitles: ['Stygies VIII batch mark'],
    })
    expect(guidance).toContain('trying to learn something')
    expect(guidance).toContain('Identify the relay fragment')
    expect(guidance).toMatch(/internal pressure only/i)
  })

  it('spectacle / charged recognition still fire when heuristics match', () => {
    const spectacle = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'I do the same to the other squad cars and watch them crumple and burn.',
        recentTurns: [],
      }),
    )
    expect(spectacle).toContain('This is spectacle')

    const recognition = formatNarratorTurnGuidance(
      ctx({
        stance: 'think',
        playerText:
          "I listen for the sounds of approaching officers and take stock of my situation. I don't feel alarmed or stressed which is strange. I feel great actually. I look around for the gun, but then stop realizing that I don't need it. I am a weapon.",
        recentTurns: [],
      }),
    )
    expect(recognition).toContain('charged recognition beat')
  })
})

describe('restatement loop (verbatim repetition)', () => {
  const turn1387 =
    'The bend curves ahead, the road narrowing where the drop falls away on the right and the pines press close from both sides. Brigha stands before you with the silver brooch extended in her open palm, her woolen cloak the color of dried blood still against the morning air. Marcus shield remains angled at your left shoulder. The centurion vine staff stays raised, the century locked on the high ground while the curve ahead lies still. The river roar continues from downstream, the ferns along the bend motionless, the road itself waiting.'
  const turn1389 =
    'The bend curves ahead, the road narrowing where the drop falls away on the right and the pines press close from both sides. Brigha stands before you, her empty palm still extended, the silver brooch now resting in your fingers. Marcus shield stays angled at your left shoulder. The centurion vine staff remains raised, the century locked on the high ground while the curve ahead lies still. The river roar continues from downstream, the ferns along the bend motionless, the road itself waiting.'

  it('flags a near-verbatim restatement of the previous turn', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'I slip the brooch into my pouch',
        recentTurns: [
          { role: 'assistant', content: turn1387 },
          { role: 'user', content: 'I take the brooch' },
          { role: 'assistant', content: turn1389 },
        ],
      }),
    )
    expect(out).toContain('restating itself')
    expect(out).toContain('Do NOT re-establish the standing setting')
  })

  it('does not flag restatement on a genuinely varied pair', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'I push open the door',
        recentTurns: [
          {
            role: 'assistant',
            content:
              'You drive your fist into the door. Metal buckles. The man grins through blood.',
          },
          { role: 'user', content: 'I step over him' },
          {
            role: 'assistant',
            content:
              'Rain hammers the tin roof as Aldric slides the ledger across the table, ink still wet, his jaw tight with something he will not say.',
          },
        ],
      }),
    )
    // No restatement and no other risk → sparse empty
    expect(out == null || !out.includes('restating itself')).toBe(true)
  })
})

describe('tier-1 engagement cue (P5 + S1)', () => {
  const oneIdle = [
    { role: 'user' as const, content: 'I charge the line' },
    { role: 'assistant' as const, content: 'It strikes home.' },
  ]

  it('fires on a single idle move with a present NPC and no salient plan', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'I look around',
        recentTurns: oneIdle,
        presentNpcCount: 1,
        plannedActionCount: 0,
      }),
    )
    expect(out!.toLowerCase()).toContain('take the initiative')
  })

  it('writes through a yielded floor instead of asking for another continue', () => {
    const out = formatNarratorTurnGuidance(
      ctx({ playerText: 'continue', recentTurns: oneIdle, presentNpcCount: 2, plannedActionCount: 0 }),
    )
    expect(out!.toLowerCase()).toContain('yielded the floor')
    expect(out!.toLowerCase()).toContain('already in frame')
    expect(out!.toLowerCase()).not.toContain('take the initiative')
  })

  it('does not fire when a salient NPC action is already planned', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'I wait',
        recentTurns: oneIdle,
        plannedActionCount: 1,
        plannedActions: [
          {
            intent_type: 'confront',
            planned_action: 'steps forward and demands an answer from the protagonist',
          },
        ],
      }),
    )
    expect(out == null || !out.toLowerCase().includes('take the initiative')).toBe(true)
  })

  it('still fires engagement when only busywork plans exist', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'I look around',
        recentTurns: oneIdle,
        presentNpcCount: 1,
        plannedActionCount: 1,
        plannedActions: [{ planned_action: 'types at the console quietly', intent_type: 'react' }],
      }),
    )
    expect(out!.toLowerCase()).toContain('take the initiative')
  })

  it('does not fire when no NPC is present', () => {
    const out = formatNarratorTurnGuidance(
      ctx({ playerText: 'I wait', recentTurns: oneIdle, presentNpcCount: 0 }),
    )
    expect(out == null || !out.toLowerCase().includes('take the initiative')).toBe(true)
  })

  it('does not fire on the opening beat (no prior turns)', () => {
    const out = formatNarratorTurnGuidance(
      ctx({ playerText: 'I wait', recentTurns: [], presentNpcCount: 1, plannedActionCount: 0 }),
    )
    expect(out == null || !out.toLowerCase().includes('take the initiative')).toBe(true)
  })

  it('escalates to the L2 world-acts cue (not the engagement cue) at the idle threshold', () => {
    const out = formatNarratorTurnGuidance(ctx({ playerText: 'I wait', recentTurns: twoIdle }))
    expect(out!.toLowerCase()).toContain('world acts')
    expect(out!.toLowerCase()).not.toContain('take the initiative')
  })
})

describe('dialogue beat cue (dialogue-depth Phase 1)', () => {
  it('fires on stance=say with present NPCs', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'say',
        playerText: 'What happened last night?',
        presentNpcCount: 2,
        recentTurns: [
          {
            role: 'assistant',
            content: 'Marcus watches you from the doorway, jaw tight.',
          },
        ],
      }),
    )
    expect(out).not.toBeNull()
    expect(out!.toLowerCase()).toContain('dialogue beat')
    expect(out!.toLowerCase()).toMatch(/two to four clauses|real conversation/)
    expect(out!.toLowerCase()).toMatch(/addressed someone by name/)
    expect(out!.toLowerCase()).not.toContain('one hard question')
  })

  it('fires a conversation exchange on yield when NPCs are present', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'continue',
        presentNpcCount: 2,
      }),
    )
    expect(out!.toLowerCase()).toContain('dialogue beat')
    expect(out!.toLowerCase()).toMatch(/two to four clauses|real conversation/)
  })

  it('flags a circling restage when the last two assistant turns overlap heavily', () => {
    const slam =
      'The numbness band clamps tighter across your throat. The right arm detonates, elbow locking rigid, fingers wrenching deeper into the claw until the forearm slams once more against your chest. The monitor spikes on the right side only.'
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'say',
        playerText: '"What is for breakfast?"',
        presentNpcCount: 2,
        recentTurns: [
          { role: 'assistant', content: slam },
          { role: 'user', content: 'continue' },
          { role: 'assistant', content: slam },
        ],
      }),
    )
    expect(out!.toLowerCase()).toContain('restaged the same physical beat')
    expect(out!.toLowerCase()).toContain('talk to each other')
  })

  it('flags a reused I\'m here comfort line', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'say',
        playerText: 'Thanks, Jordan. I wouldn\'t want to do this alone.',
        presentNpcCount: 2,
        recentTurns: [
          {
            role: 'assistant',
            content: 'Jordan’s palm rises. “I’m here,” she says, voice low.',
          },
          { role: 'user', content: 'I wait until the protocol is over.' },
          {
            role: 'assistant',
            content: 'Jordan glances at Ellis. “I’m still right here.”',
          },
        ],
      }),
    )
    expect(out!.toLowerCase()).toMatch(/do not reuse/)
    expect(out!.toLowerCase()).toMatch(/here/)
  })

  it('does not fire on observe/travel without speech and without present NPCs', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'observe',
        playerText: 'I look around the empty hall',
        presentNpcCount: 0,
      }),
    )
    expect(out == null || !out.toLowerCase().includes('dialogue beat')).toBe(true)
  })

  it('does not fire on meta / OOC stance', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'meta',
        inputMode: 'out-of-character',
        playerText: 'What should I do next in the game?',
        presentNpcCount: 2,
      }),
    )
    expect(out).toContain('Brief reply')
    expect(out!.toLowerCase()).not.toContain('dialogue beat')
  })

  it('fires on speechy player text even when stance is do', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'do',
        playerText: 'I ask Marcus what he saw at the dock',
        presentNpcCount: 1,
      }),
    )
    expect(out!.toLowerCase()).toContain('dialogue beat')
  })

  it('includes ear packing and bans invented TTS stage-direction tags', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        stance: 'say',
        playerText: '"What did you see?"',
        presentNpcCount: 1,
      }),
    )
    expect(out!.toLowerCase()).toContain('ear packing')
    expect(out!.toLowerCase()).toContain('stage-direction')
    expect(out).toMatch(/\[whispers\]|ssml/i)
  })
})

describe('genre / media / dialogue cues (risk-gated)', () => {
  it('treats public feeds as wider-world surfaces', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'observe',
      inputMode: 'in-character',
      playerText: 'I open up X',
      recentTurns: [],
      presentNpcCount: 0,
      plannedActionCount: 0,
    })
    expect(guidance).toContain('public information surface')
  })

  it('flags repeated ambient closers', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'say',
      inputMode: 'in-character',
      playerText: '"Vox, what did you find?"',
      recentTurns: [
        {
          role: 'assistant',
          content:
            'Vox lowers its beam over the fragment. The grain continues its slow, independent sway around your boots.',
        },
        {
          role: 'user',
          content: '"Vox, pattern match, now."',
        },
        {
          role: 'assistant',
          content:
            'Vox returns a partial match and clicks once. The wheat sways around your boots, the bell drifting from the spire.',
        },
      ],
      presentNpcCount: 0,
      plannedActionCount: 0,
    })
    expect(guidance).toContain('ambient closer')
    expect(guidance).toContain('wheat')
  })

  it('snaps the camera back when last prose walked the player to a place STATE did not', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'I stay here.',
        currentPlaceName: 'Corridor',
        recentTurns: [
          { role: 'user', content: 'No, we need another plan.' },
          {
            role: 'assistant',
            content:
              'She turns toward the Medical door and keeps her pace even so you stay beside her. You reach the alcove.',
          },
        ],
      }),
    )
    expect(out).toMatch(/Camera stays at Corridor/)
    expect(out).toMatch(/they are gone/i)
  })

  it('does not snap the camera when STATE place matches the arrival', () => {
    const out = formatNarratorTurnGuidance(
      ctx({
        playerText: 'I look at Lee.',
        currentPlaceName: 'Medical - Alcove',
        recentTurns: [
          { role: 'user', content: 'I follow her to Medical.' },
          {
            role: 'assistant',
            content: 'You follow Jordan into Medical. You reach the alcove.',
          },
        ],
      }),
    )
    expect(out ?? '').not.toMatch(/Camera stays at/)
  })

  it('cues movement beats to breathe', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'do',
      inputMode: 'in-character',
      playerText: 'I make my way into the city',
      recentTurns: [],
      presentNpcCount: 0,
      plannedActionCount: 0,
    })
    expect(guidance).toContain('Let the beat breathe')
  })
})

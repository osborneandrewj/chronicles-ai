import { describe, expect, it } from 'vitest'

import { decideDirector } from '@/domain/services/director'
import type { RankableObjective, RankableThread } from '@/domain/services/dossier-ranking'
import { formatDirectorBlock } from '@/lib/world-state'

function thread(
  partial: Partial<RankableThread> & Pick<RankableThread, 'id' | 'title' | 'kind'>,
): RankableThread {
  return {
    status: 'active',
    summary: null,
    stakes: null,
    consequences: null,
    hidden: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    source_turn_id: 1,
    ...partial,
  }
}

function objective(
  partial: Partial<RankableObjective> & Pick<RankableObjective, 'id' | 'title'>,
): RankableObjective {
  return {
    status: 'active',
    detail: null,
    blocker: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    source_turn_id: 1,
    ...partial,
  }
}

describe('decideDirector', () => {
  it('returns empty beat when no actives', () => {
    const d = decideDirector({
      threads: [],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 10,
      playerText: 'look around',
    })
    expect(d.foregroundThreadId).toBeNull()
    expect(d.guidanceLines).toHaveLength(0)
    expect(d.beatKind).toBeNull()
    expect(d.mustStage).toHaveLength(0)
    expect(d.mustNot).toHaveLength(0)
    expect(d.cast).toHaveLength(0)
  })

  it('applies a pending brain beat unless the player engages another thread', () => {
    const pending = {
      beatKind: 'reveal' as const,
      foregroundThreadId: 1,
      mustStage: ['Stage the papyrus seal'],
      mustNot: ['Do not open a new major arc this turn.'],
      cast: [{ characterId: 2, name: 'Setnakht', role: 'initiate' as const }],
      guidanceLines: ['Brain: keep the courier in frame'],
      reason: 'stall' as const,
      sourceTurnId: 8,
    }
    const used = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'The Sealed Papyrus',
          kind: 'quest',
          summary: 'Setnakht carries a letter',
          source_turn_id: 4,
        }),
        thread({
          id: 2,
          title: 'Temple politics',
          kind: 'threat',
          summary: 'The vizier watches',
          source_turn_id: 5,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 10,
      playerText: 'I ask about the papyrus',
      pendingBeat: pending,
    })
    expect(used.beatKind).toBe('reveal')
    expect(used.mustStage).toContain('Stage the papyrus seal')
    expect(used.cast[0]?.name).toBe('Setnakht')

    const overridden = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'The Sealed Papyrus',
          kind: 'quest',
          summary: 'Setnakht carries a letter',
          source_turn_id: 4,
        }),
        thread({
          id: 2,
          title: 'Temple politics',
          kind: 'threat',
          summary: 'The vizier watches',
          source_turn_id: 5,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 10,
      playerText: 'I confront the vizier about temple politics',
      pendingBeat: pending,
    })
    expect(overridden.mustStage).not.toContain('Stage the papyrus seal')
  })

  it('picks one foreground among Threshold-shaped multi-threat pile', () => {
    const threads = [
      thread({
        id: 1,
        title: 'Quiet audit',
        kind: 'background',
        stakes: 'minor paperwork',
        source_turn_id: 5,
      }),
      thread({
        id: 2,
        title: 'Corporate hit squad',
        kind: 'threat',
        stakes: 'death if they find you by dusk',
        source_turn_id: 20,
      }),
      thread({
        id: 3,
        title: 'Missing courier',
        kind: 'mystery',
        stakes: 'urgent lead',
        source_turn_id: 18,
      }),
      thread({
        id: 4,
        title: 'Blackmail ledger',
        kind: 'threat',
        stakes: 'career-ending exposure',
        source_turn_id: 15,
      }),
      thread({
        id: 5,
        title: 'Side romance',
        kind: 'relationship',
        stakes: null,
        source_turn_id: 2,
      }),
      thread({
        id: 6,
        title: 'Main contract',
        kind: 'quest',
        stakes: 'must deliver before Day 3 dusk or die',
        source_turn_id: 19,
      }),
    ]
    const d = decideDirector({
      threads,
      objectives: [
        objective({ id: 10, title: 'Reach the vault logs' }),
        objective({ id: 11, title: 'Pay the debt' }),
      ],
      clockMinutes: (3 - 1) * 1440 + 18 * 60, // Day 3 evening-ish
      currentTurnId: 50,
      playerText: 'I check the hit squad intel',
    })
    expect(d.foregroundThreadId).not.toBeNull()
    expect(d.guidanceLines.length).toBeGreaterThan(0)
    // Heavy pressure capped — not all 6 threads are heavy.
    expect(d.heavyThreadIds.length).toBeLessThanOrEqual(4)
    expect(d.backgroundThreadIds.length).toBeGreaterThan(0)
  })

  it('Meridian-shaped many objectives still one foreground thread', () => {
    const threads = [
      thread({
        id: 1,
        title: 'Sequence Vigil investigation',
        kind: 'quest',
        stakes: 'operator clearance and program control',
        source_turn_id: 100,
      }),
    ]
    const objectives = Array.from({ length: 7 }, (_, i) =>
      objective({ id: i + 1, title: `Objective ${i + 1}`, detail: 'active route' }),
    )
    const d = decideDirector({
      threads,
      objectives,
      clockMinutes: 200,
      currentTurnId: 120,
      playerText: 'continue the investigation',
    })
    expect(d.foregroundThreadId).toBe(1)
    expect(d.phase).toBeTruthy()
  })

  it('stalls escalate guidance without hard climax mandate', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'Stalled plot',
          kind: 'quest',
          stakes: 'something important',
          source_turn_id: 1,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 40,
      playerText: 'I drink coffee and stare at the wall',
    })
    expect(d.guidanceLines.some((l) => /stall/i.test(l))).toBe(true)
    expect(d.guidanceLines.every((l) => !/must climax|force climax/i.test(l))).toBe(true)
    expect(d.beatKind).toBe('stall_escalate')
    expect(d.mustStage.some((l) => /escalate/i.test(l))).toBe(true)
    expect(d.mustNot).toContain('Do not open a new major arc this turn.')
    expect(d.mustNot.every((l) => !/must climax|force climax/i.test(l))).toBe(true)
  })

  it('gives the addressed present NPC the initiate slot and their thread the floor', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 17,
          title: 'What the Sessions Are For',
          kind: 'mystery',
          summary: 'The crossings do not stay put.',
          source_turn_id: 200,
        }),
        thread({
          id: 18,
          title: 'The Face Lena Hides',
          kind: 'threat',
          summary: 'Commander Lena Korr will burn a newcomer to keep the cycles running.',
          source_turn_id: 201,
        }),
      ],
      objectives: [],
      clockMinutes: 5400,
      currentTurnId: 1280,
      playerText: '"Lena, speak now."',
      presentCast: [
        { id: 12, name: 'Ellis Shaw' },
        { id: 14, name: 'Jordan Lacy' },
        { id: 15, name: 'Lee Ingram' },
        { id: 34, name: 'Lena Korr' },
      ],
    })
    expect(d.foregroundThreadId).toBe(18)
    const lena = d.cast.find((c) => c.name === 'Lena Korr')
    expect(lena?.role).toBe('initiate')
    expect(d.mustStage.join(' ')).toMatch(/lena korr initiates/i)
  })

  it('does not force a new plot finding on an intimate beat', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 39,
          title: 'The Official Story',
          kind: 'mystery',
          summary: 'Lena sealed the Hale file',
          source_turn_id: 1460,
        }),
      ],
      objectives: [],
      clockMinutes: 12446,
      currentTurnId: 1481,
      playerText: 'I kiss her face in the dark',
      presentCast: [{ id: 14, name: 'Jordan Lacy' }],
      lastBeatKind: 'pressure',
      lastForegroundThreadId: 39,
    })
    expect(d.beatKind).toBe('local')
    expect(d.mustStage.join(' ')).toMatch(/stay with this beat/i)
    expect(d.mustStage.join(' ')).not.toMatch(/new consequence|Official Story/i)
  })

  it('does not advance a thread the player did not name this turn', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 39,
          title: 'The Official Story',
          kind: 'mystery',
          summary: 'Lena sealed the Hale file',
          source_turn_id: 1460,
        }),
      ],
      objectives: [],
      clockMinutes: 12446,
      currentTurnId: 1487,
      playerText: 'Jordan, can we just leave the logs and Marcus be for tonight? I want to enjoy this moment.',
      presentCast: [{ id: 14, name: 'Jordan Lacy' }],
      lastBeatKind: 'pressure',
      lastForegroundThreadId: 39,
    })
    expect(d.mustStage.join(' ')).toMatch(/stay with this beat/i)
    expect(d.mustStage.join(' ')).not.toMatch(/new consequence|Official Story/i)
  })

  it('does not mint a new finding when they continue off-thread', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 39,
          title: 'The Official Story',
          kind: 'mystery',
          summary: 'Lena sealed the Hale file',
          source_turn_id: 1460,
        }),
      ],
      objectives: [],
      clockMinutes: 12446,
      currentTurnId: 1483,
      playerText: 'continue',
      presentCast: [{ id: 14, name: 'Jordan Lacy' }],
      lastBeatKind: 'pressure',
      lastForegroundThreadId: 39,
    })
    expect(d.beatKind).toBe('yield')
    expect(d.mustStage.join(' ')).toMatch(/already in frame/i)
    expect(d.mustStage.join(' ')).not.toMatch(/new consequence|named next place|Official Story/i)
  })

  it('does not stall when the player is talking to someone on stage', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 5,
          title: 'The Deep Session Effect',
          kind: 'mystery',
          summary: 'Memory gaps after the session',
          source_turn_id: 350,
        }),
      ],
      objectives: [],
      clockMinutes: 4900,
      currentTurnId: 1036,
      playerText: 'Jordan, your hands are amazing. Don\'t tell Lee.',
      presentCast: [
        { id: 16, name: 'Andrew', isPlayer: true },
        { id: 14, name: 'Jordan Lacy' },
        { id: 15, name: 'Lee Ingram' },
      ],
    })
    expect(d.beatKind).not.toBe('stall_escalate')
  })

  it('does not stall when play continues on the live foreground', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 5,
          title: 'The Deep Session Effect',
          kind: 'mystery',
          summary: 'Memory gaps after the session',
          source_turn_id: 350,
        }),
      ],
      objectives: [],
      clockMinutes: 4900,
      currentTurnId: 1034,
      playerText: 'What are you picking up and what does it mean?',
      presentCast: [
        { id: 14, name: 'Jordan Lacy' },
        { id: 15, name: 'Lee Ingram' },
      ],
      lastBeatKind: 'stall_escalate',
      lastForegroundThreadId: 5,
    })
    expect(d.beatKind).not.toBe('stall_escalate')
  })

  it('drops a stall pending when the player is in-scene on that thread', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 5,
          title: 'The Deep Session Effect',
          kind: 'mystery',
          summary: 'Memory gaps after the session',
          source_turn_id: 350,
        }),
      ],
      objectives: [],
      clockMinutes: 4900,
      currentTurnId: 1036,
      playerText: 'I ask Lee what the reading means',
      presentCast: [{ id: 15, name: 'Lee Ingram' }],
      pendingBeat: {
        beatKind: 'stall_escalate',
        foregroundThreadId: 5,
        mustStage: ['Jordan initiates a facility-wide monitoring sequence'],
        mustNot: ['Do not resolve or explain the nature of the Deep Session Effect'],
        cast: [{ characterId: 14, name: 'Jordan Lacy', role: 'initiate' }],
        guidanceLines: [],
        reason: 'stall',
        sourceTurnId: 1033,
      },
    })
    expect(d.mustStage.join(' ')).not.toMatch(/facility-wide monitoring/i)
    expect(d.beatKind).not.toBe('stall_escalate')
  })

  it('drops an empty-dossier local pending when the player asks to leave the procedure', () => {
    const d = decideDirector({
      threads: [],
      objectives: [],
      clockMinutes: 10752,
      currentTurnId: 1354,
      playerText: "Ok I'm ready to be done with testing. When's dinner?",
      lastBeatKind: 'local',
      pendingBeat: {
        beatKind: 'local',
        foregroundThreadId: null,
        mustStage: ['Andrew experiences the protocol under way'],
        mustNot: ['Do not interrupt protocols once the timer begins'],
        cast: [{ characterId: 12, name: 'Ellis Shaw', role: 'initiate' }],
        guidanceLines: [],
        reason: 'empty_dossier',
        sourceTurnId: 1352,
      },
    })
    expect(d.mustStage.join(' ')).not.toMatch(/protocol under way/i)
    expect(d.mustStage.join(' ')).toMatch(/named next place/i)
    expect(d.mustNot.join(' ')).toMatch(/monitoring/i)
    expect(d.beatKind).toBe('yield')
  })

  it('drops a yield pending when the player has moved on to a new beat', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 17,
          title: 'What the Sessions Are For',
          kind: 'mystery',
          summary: 'The isolation runs send Andrew into other lives',
          source_turn_id: 1200,
        }),
      ],
      objectives: [],
      clockMinutes: 10752,
      currentTurnId: 1355,
      playerText: "When's dinner?",
      lastBeatKind: 'local',
      pendingBeat: {
        beatKind: 'yield',
        foregroundThreadId: 17,
        mustStage: ['Ellis ends the isolation cycle and unseals the chamber.'],
        mustNot: ['Do not start another monitoring interval, timer, or deep session.'],
        cast: [{ characterId: 12, name: 'Ellis Shaw', role: 'initiate' }],
        guidanceLines: [],
        reason: 'empty_dossier',
        sourceTurnId: 1354,
      },
    })
    expect(d.mustStage.join(' ')).not.toMatch(/unseals the chamber/i)
    expect(d.beatKind).not.toBe('yield')
  })

  it('drops a pending beat when its whole CAST has left the room', () => {
    const d = decideDirector({
      threads: [],
      objectives: [],
      clockMinutes: 12446,
      currentTurnId: 1447,
      playerText: 'I stay in the corridor and think.',
      presentCast: [],
      knownCast: [
        { id: 14, name: 'Jordan Lacy' },
        { id: 15, name: 'Lee Ingram' },
        { id: 16, name: 'Andrew Osborne', isPlayer: true },
      ],
      lastBeatKind: 'reveal',
      pendingBeat: {
        beatKind: 'reveal',
        foregroundThreadId: null,
        mustStage: [
          'Lee hands you the medical log sheet',
          "Jordan Lacy's read on what Lee's candor means",
        ],
        mustNot: ['Do not let the player leave this scene without a clear next commit point'],
        cast: [{ characterId: 14, name: 'Jordan Lacy', role: 'react' }],
        guidanceLines: ["Jordan has the folder and the sheet"],
        reason: 'empty_dossier',
        sourceTurnId: 1446,
      },
    })
    expect(d.mustStage.join(' ')).not.toMatch(/Lee hands you/i)
    expect(d.mustStage.join(' ')).not.toMatch(/Jordan Lacy's read/i)
    expect(d.cast).toHaveLength(0)
    expect(d.beatKind).toBeNull()
  })

  it('keeps a present CAST member but strips must-stage that names someone who left', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 33,
          title: 'The Sealed File',
          kind: 'mystery',
          summary: 'Hale medical folder',
          source_turn_id: 1400,
        }),
      ],
      objectives: [],
      clockMinutes: 12400,
      currentTurnId: 1446,
      playerText: 'No, we need another plan. I could use that drink.',
      presentCast: [{ id: 14, name: 'Jordan Lacy' }],
      knownCast: [
        { id: 14, name: 'Jordan Lacy' },
        { id: 15, name: 'Lee Ingram' },
        { id: 16, name: 'Andrew Osborne', isPlayer: true },
      ],
      pendingBeat: {
        beatKind: 'local',
        foregroundThreadId: 33,
        mustStage: [
          "Lee's response to a direct question about Ingram's tremor entries",
          'The next specific location or action the player must commit to',
        ],
        mustNot: ['Do not withhold information about what Lee knows'],
        cast: [{ characterId: 14, name: 'Jordan Lacy', role: 'react' }],
        guidanceLines: [],
        reason: 'empty_dossier',
        sourceTurnId: 1444,
      },
    })
    expect(d.mustStage.join(' ')).not.toMatch(/Lee's response/i)
    expect(d.mustStage.join(' ')).not.toMatch(/next specific location/i)
    expect(d.mustNot.join(' ')).not.toMatch(/what Lee knows/i)
  })

  it('repeat empty-dossier local must change the board', () => {
    const d = decideDirector({
      threads: [],
      objectives: [],
      clockMinutes: 10752,
      currentTurnId: 1352,
      playerText: 'I wait until the protocol is over',
      lastBeatKind: 'local',
    })
    expect(d.beatKind).toBe('yield')
    expect(d.mustStage.join(' ')).toMatch(/named next place/i)
    expect(d.mustNot.join(' ')).toMatch(/interval/i)
  })

  it('repeat stall_escalate must change the board', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'Stalled plot',
          kind: 'quest',
          stakes: 'something important',
          source_turn_id: 1,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 40,
      playerText: 'I drink coffee and stare at the wall',
      lastBeatKind: 'stall_escalate',
      lastForegroundThreadId: 1,
      stallStreak: 1,
    })
    expect(d.beatKind).toBe('stall_escalate')
    expect(d.mustStage.some((l) => /change the board/i.test(l))).toBe(true)
  })

  it('bare continue after live pressure yields and writes through', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 14,
          title: 'Pre-Arrival Tremor Baseline',
          kind: 'mystery',
          source_turn_id: 1140,
        }),
      ],
      objectives: [],
      clockMinutes: 5200,
      currentTurnId: 1160,
      playerText: 'continue',
      presentCast: [
        { id: 12, name: 'Ellis Shaw' },
        { id: 14, name: 'Jordan Lacy' },
      ],
      lastBeatKind: 'pressure',
      lastForegroundThreadId: 14,
    })
    expect(d.beatKind).toBe('yield')
    expect(d.mustStage.join(' ')).toMatch(/yielded the floor/i)
    expect(d.mustStage.join(' ')).toMatch(/already in frame/i)
    expect(d.mustStage.join(' ')).not.toMatch(/write through|named next place|new consequence/i)
  })

  it('prefers a live mystery over a somatic clawing-arm threat', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 16,
          title: 'The Clawing Arm',
          kind: 'threat',
          summary: 'Right arm spasming into a rigid claw with blood-pressure spikes.',
          source_turn_id: 1240,
        }),
        thread({
          id: 8,
          title: 'What the Sessions Are For',
          kind: 'mystery',
          summary: 'The work sends people into other lives.',
          stakes: 'They will not know which memories are theirs.',
          source_turn_id: 200,
        }),
      ],
      objectives: [],
      clockMinutes: 5400,
      currentTurnId: 1262,
      playerText: '"I\'m starved. Talk to me."',
      presentCast: [{ id: 14, name: 'Jordan Lacy' }],
    })
    expect(d.foregroundThreadId).toBe(8)
    expect(d.mustStage.join(' ')).not.toMatch(/clawing arm/i)
  })

  it('repeat pressure on the same thread must advance, not restage the body', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 16,
          title: 'The Clawing Arm',
          kind: 'threat',
          source_turn_id: 1230,
        }),
      ],
      objectives: [],
      clockMinutes: 5400,
      currentTurnId: 1262,
      playerText: 'The clawing in my arm is worse. What does it mean?',
      presentCast: [
        { id: 12, name: 'Ellis Shaw' },
        { id: 14, name: 'Jordan Lacy' },
      ],
      lastBeatKind: 'pressure',
      lastForegroundThreadId: 16,
    })
    expect(d.beatKind).toBe('pressure')
    expect(d.mustStage.join(' ')).toMatch(/new consequence/i)
    expect(d.mustStage.join(' ')).not.toMatch(/stage a concrete beat of "the clawing arm"/i)
    expect(d.mustNot.join(' ')).toMatch(/unchanged symptom/i)
  })

  it('wait-until-done yields even when the text contains "done"', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 12,
          title: "Jordan's Interest in Andrew",
          kind: 'relationship',
          source_turn_id: 1080,
        }),
      ],
      objectives: [],
      clockMinutes: 5100,
      currentTurnId: 1150,
      playerText: '"No change that I\'ve noticed." I wait until the examination is done.',
      presentCast: [{ id: 14, name: 'Jordan Lacy' }],
      lastBeatKind: 'close',
      lastForegroundThreadId: 12,
    })
    expect(d.beatKind).toBe('yield')
    expect(d.mustStage.join(' ')).toMatch(/already in frame|write through/i)
  })

  it('does not press a leftover tremor thread after the baseline resolved', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 14,
          title: 'Pre-Arrival Tremor Baseline',
          kind: 'mystery',
          status: 'resolved',
          source_turn_id: 1040,
        }),
        thread({
          id: 13,
          title: 'Unexplained Tremor',
          kind: 'mystery',
          status: 'active',
          source_turn_id: 320,
        }),
      ],
      objectives: [
        objective({
          id: 15,
          title: "Obtain Andrew's pre-assignment medical records",
          status: 'completed',
        }),
      ],
      clockMinutes: 5300,
      currentTurnId: 1203,
      playerText: 'I head to medical',
      presentCast: [{ id: 12, name: 'Ellis Shaw' }],
    })
    expect(d.foregroundThreadId).not.toBe(13)
    expect(d.suggestDormantThreadIds).toContain(13)
    expect(d.mustStage.join(' ')).not.toMatch(/unexplained tremor/i)
  })

  it('must not reverse completed findings', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 13,
          title: 'Unexplained Tremor',
          kind: 'mystery',
          source_turn_id: 10,
        }),
      ],
      objectives: [
        objective({
          id: 15,
          title: "Obtain Andrew's pre-assignment medical records",
          status: 'completed',
        }),
      ],
      clockMinutes: 100,
      currentTurnId: 1203,
      playerText: 'I head to medical',
    })
    expect(d.mustNot.join(' ')).toMatch(/settled findings/i)
    expect(d.mustNot.join(' ')).toMatch(/pre-assignment medical records/i)
  })

  it('does not treat "continue the investigation" as a floor yield', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'Sequence Vigil investigation',
          kind: 'quest',
          source_turn_id: 100,
        }),
      ],
      objectives: [],
      clockMinutes: 200,
      currentTurnId: 120,
      playerText: 'continue the investigation',
    })
    expect(d.beatKind).not.toBe('yield')
    expect(d.mustStage.join(' ')).not.toMatch(/yielded the floor/i)
  })

  it('wake-advance yields and does not wait for the protagonist', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 5,
          title: 'Mapping the Facility Tremor',
          kind: 'mystery',
          source_turn_id: 1040,
        }),
      ],
      objectives: [],
      clockMinutes: 5000,
      currentTurnId: 1050,
      playerText: 'continue',
      presentCast: [
        { id: 14, name: 'Jordan Lacy' },
        { id: 15, name: 'Lee Ingram' },
      ],
      lastBeatKind: 'pressure',
      lastForegroundThreadId: 5,
      wakeAdvance: true,
    })
    expect(d.beatKind).toBe('yield')
    expect(d.mustStage.join(' ')).toMatch(/cannot act/i)
    expect(d.mustStage.join(' ')).toMatch(/changed board/i)
    expect(d.mustStage.join(' ')).not.toMatch(/jordan lacy initiates/i)
  })

  it('stay-under advances the world without restoring agency', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 5,
          title: 'The cellar rope',
          kind: 'threat',
          source_turn_id: 10,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 20,
      playerText: "I don't respond, and don't wake yet",
      stayUnder: true,
    })
    expect(d.beatKind).toBe('yield')
    expect(d.mustStage.join(' ')).toMatch(/still cannot act/i)
    expect(d.mustStage.join(' ')).toMatch(/do not restore/i)
  })


  it('assigns one initiator from present cast and must-stage them', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'The Sealed Papyrus',
          kind: 'quest',
          summary: 'Setnakht carries a sealed letter',
          source_turn_id: 10,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 12,
      playerText: 'I ask what the papyrus holds',
      presentCast: [
        { id: 1, name: 'Joseph', isPlayer: true },
        { id: 2, name: 'Setnakht' },
        { id: 3, name: 'A temple porter' },
        { id: 4, name: 'A second scribe' },
        { id: 5, name: 'A door guard' },
      ],
    })
    expect(d.cast.filter((c) => c.role === 'initiate')).toHaveLength(0)
    expect(d.cast.filter((c) => c.role === 'react').map((c) => c.name)).toContain(
      'Setnakht',
    )
    expect(d.cast.some((c) => c.role === 'background')).toBe(true)
    expect(d.cast.every((c) => c.name !== 'Joseph')).toBe(true)
    expect(d.mustStage.some((l) => /Setnakht initiates/i.test(l))).toBe(false)
    expect(d.mustStage.some((l) => /Sealed Papyrus/i.test(l))).toBe(true)
  })

  it('marks an en-route foreground name as arrive', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'Bring Marcus in',
          kind: 'quest',
          summary: 'Marcus is driving across town',
          source_turn_id: 4,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 8,
      playerText: 'I wait by the window',
      presentCast: [{ id: 1, name: 'Kyle' }],
      enRouteCast: [{ id: 9, name: 'Marcus' }],
    })
    expect(d.cast).toEqual(
      expect.arrayContaining([
        { characterId: 1, name: 'Kyle', role: 'initiate' },
        { characterId: 9, name: 'Marcus', role: 'arrive' },
      ]),
    )
    expect(d.beatKind).toBe('arrival')
  })
})

describe('formatDirectorBlock', () => {
  it('renders binding MUST STAGE / MUST NOT / CAST', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'Hit squad',
          kind: 'threat',
          stakes: 'death by dusk',
          source_turn_id: 8,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 10,
      playerText: 'I check the alley',
      presentCast: [{ id: 2, name: 'Lira' }],
    })
    const block = formatDirectorBlock(d, [
      {
        id: 1,
        title: 'Hit squad',
        kind: 'threat',
        status: 'active',
        summary: null,
        stakes: 'death by dusk',
      } as never,
    ])
    expect(block).toContain('## DIRECTOR')
    expect(block).toContain('MUST STAGE')
    expect(block).toContain('CAST')
    expect(block).toMatch(/react: Lira/)
    expect(block).toContain('same force as PLANNED MOVES')
    expect(block).not.toMatch(/Soft structural pressure/)
  })

  it('does not give initiate to an unengaged host when the player has the floor', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 39,
          title: 'The Official Story',
          kind: 'mystery',
          summary: 'Lena sealed the Hale file',
          source_turn_id: 1460,
        }),
      ],
      objectives: [],
      clockMinutes: 12446,
      currentTurnId: 1500,
      playerText: 'I walk to the coffee urn.',
      presentCast: [
        { id: 14, name: 'Jordan Lacy' },
        { id: 15, name: 'Lee Ingram' },
      ],
    })
    expect(d.cast.find((c) => c.name === 'Jordan Lacy')?.role).not.toBe('initiate')
    expect(d.cast.find((c) => c.name === 'Lee Ingram')?.role).not.toBe('initiate')
  })

  it('drops a mustStage that contradicts a present host refusal', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 39,
          title: 'The Official Story',
          kind: 'mystery',
          summary: 'Lena sealed the Hale file',
          source_turn_id: 1460,
        }),
      ],
      objectives: [],
      clockMinutes: 12446,
      currentTurnId: 1501,
      playerText: 'I kiss her face in the dark',
      presentCast: [
        {
          id: 14,
          name: 'Jordan Lacy',
          refusals: ['will not brief during intimacy', 'will not restate the Hale folder'],
        },
      ],
      pendingBeat: {
        beatKind: 'pressure',
        foregroundThreadId: 39,
        mustStage: [
          'Jordan briefs the Hale folder from ops',
          'Stay with this beat. Do not introduce a new file.',
        ],
        mustNot: [],
        cast: [{ characterId: 14, name: 'Jordan Lacy', role: 'initiate' }],
        guidanceLines: [],
        reason: 'stall',
        sourceTurnId: 1490,
      },
    })
    expect(d.mustStage.join(' ')).not.toMatch(/briefs the Hale/i)
    expect(d.mustStage.join(' ')).toMatch(/stay with this beat/i)
  })

  it('returns empty string when the beat is empty', () => {
    const d = decideDirector({
      threads: [],
      objectives: [],
      clockMinutes: 0,
      currentTurnId: 1,
      playerText: 'look around',
    })
    expect(formatDirectorBlock(d, [])).toBe('')
  })
})

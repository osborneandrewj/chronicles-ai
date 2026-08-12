import { describe, expect, it } from 'vitest'

import {
  buildInfluencePacket,
  compactInfluencePacket,
} from '@/domain/services/build-influence-packet'
import {
  hasLogQueryIntent,
  isConsoleCapablePlace,
  shouldInjectSimLogs,
  shouldShowSimIndex,
} from '@/domain/services/console-access'
import { clearanceMeets } from '@/domain/services/clearance'
import {
  extractAntagonistNameHint,
  linkAntagonistCharacter,
} from '@/domain/services/link-antagonist'
import {
  compactPlayerModel,
  emptyPlayerModel,
  refreshPlayerModelFromReport,
} from '@/domain/services/player-model'
import {
  buildDeterministicSimRunReport,
  compactSimRunReport,
  formatAmbientSimIndexBlock,
  formatConsoleLogPullBlock,
  formatReportBody,
  selectReportSliceForClearance,
  SIM_REPORT_CAPS,
} from '@/domain/services/sim-run-report'
import type { Character, MetaStoryBible, SimRunReport } from '@/domain/entities'

function sampleReport(overrides: Partial<SimRunReport> = {}): SimRunReport {
  return {
    id: 1,
    hub_world_id: 10,
    subworld_id: 77,
    codename: 'Sequence Vigil',
    genre_tags: ['roman'],
    status: 'death_exit',
    headline: 'Subject lost in third act; anomaly spike.',
    summary: 'A'.repeat(50),
    outcomes: ['Primary subject declared dead in-sim'],
    anomalies: ['Lucidity events near archive'],
    persons_of_interest: ['Marcus'],
    min_clearance: 'operator',
    source_turn_id: 9,
    created_at: '2026-01-01 00:00:00',
    ...overrides,
  }
}

describe('compactSimRunReport', () => {
  it('enforces hard field caps', () => {
    const raw = compactSimRunReport({
      hub_world_id: 1,
      subworld_id: 2,
      codename: 'X'.repeat(200),
      genre_tags: ['a', 'b'],
      status: 'completed',
      headline: 'H'.repeat(200),
      summary: 'S'.repeat(2000),
      outcomes: Array.from({ length: 10 }, (_, i) => `o${i} ${'x'.repeat(200)}`),
      anomalies: Array.from({ length: 10 }, (_, i) => `a${i}`),
      persons_of_interest: Array.from({ length: 10 }, (_, i) => `p${i}${'y'.repeat(50)}`),
      min_clearance: 'operator',
      source_turn_id: null,
    })
    expect(raw.headline.length).toBeLessThanOrEqual(SIM_REPORT_CAPS.headline)
    expect(raw.summary.length).toBeLessThanOrEqual(SIM_REPORT_CAPS.summary)
    expect(raw.outcomes.length).toBeLessThanOrEqual(SIM_REPORT_CAPS.outcomeMax)
    expect(raw.anomalies.length).toBeLessThanOrEqual(SIM_REPORT_CAPS.anomalyMax)
    expect(raw.persons_of_interest.length).toBeLessThanOrEqual(SIM_REPORT_CAPS.poiMax)
  })
})

describe('selectReportSliceForClearance', () => {
  it('gives public_crew restricted index when min_clearance is operator', () => {
    const slice = selectReportSliceForClearance(sampleReport(), 'public_crew')
    expect(slice.kind).toBe('index')
    if (slice.kind === 'index') expect(slice.line).toContain('restricted')
  })

  it('gives public_crew headline when min_clearance is public_crew', () => {
    const slice = selectReportSliceForClearance(
      sampleReport({ min_clearance: 'public_crew' }),
      'public_crew',
    )
    expect(slice.kind).toBe('headline')
  })

  it('gives operator body without anomalies', () => {
    const slice = selectReportSliceForClearance(sampleReport(), 'operator')
    expect(slice.kind).toBe('body')
    if (slice.kind === 'body') {
      expect(slice.report.anomalies).toEqual([])
      expect(slice.report.summary.length).toBeGreaterThan(0)
    }
  })

  it('gives classified full body', () => {
    const slice = selectReportSliceForClearance(sampleReport(), 'classified')
    expect(slice.kind).toBe('body')
    if (slice.kind === 'body') {
      expect(slice.report.anomalies.length).toBeGreaterThan(0)
      expect(slice.report.persons_of_interest).toContain('Marcus')
    }
  })
})

describe('console gate', () => {
  it('shows index only post-awaken on hub', () => {
    expect(shouldShowSimIndex({ worldLayer: 'hub', hasAwoken: true })).toBe(true)
    expect(shouldShowSimIndex({ worldLayer: 'hub', hasAwoken: false })).toBe(false)
    expect(shouldShowSimIndex({ worldLayer: 'subworld', hasAwoken: true })).toBe(false)
  })

  it('injects body in sim room or on log query', () => {
    const base = {
      worldLayer: 'hub' as const,
      placeId: 1,
      placeName: 'Sim Deck',
      isConsoleCapablePlace: true,
      playerText: 'I look around',
      actingCharacterClearance: 'operator' as const,
      hasAwoken: true,
    }
    expect(shouldInjectSimLogs(base).inject).toBe(true)
    expect(
      shouldInjectSimLogs({
        ...base,
        isConsoleCapablePlace: false,
        playerText: 'pull up the mission report',
      }).inject,
    ).toBe(true)
    expect(
      shouldInjectSimLogs({
        ...base,
        isConsoleCapablePlace: false,
        playerText: 'I walk to the mess',
      }).inject,
    ).toBe(false)
  })

  it('matches console place by simulation room name', () => {
    expect(
      isConsoleCapablePlace({ placeName: 'Sim Deck', simulationRoomName: 'Sim Deck' }),
    ).toBe(true)
    expect(
      isConsoleCapablePlace({ placeName: 'Mess', simulationRoomName: 'Sim Deck' }),
    ).toBe(false)
  })

  it('detects log query intent with precision', () => {
    expect(hasLogQueryIntent('open Sequence Vigil')).toBe(true)
    expect(hasLogQueryIntent('access the log for protocol')).toBe(true)
    expect(hasLogQueryIntent('I wait by the bulkhead')).toBe(false)
  })
})

describe('format blocks', () => {
  it('ambient index has no full summary body', () => {
    const block = formatAmbientSimIndexBlock([sampleReport()], 'public_crew')
    expect(block).toContain('Simulation index')
    expect(block).toContain('Sequence Vigil')
    expect(block).not.toContain('## Simulation log:')
  })

  it('console pull includes summary for operator+', () => {
    const block = formatConsoleLogPullBlock(sampleReport(), 'operator')
    expect(block).toContain('Simulation log: Sequence Vigil')
    expect(block).toContain('Summary:')
  })

  it('formatReportBody stays under token budget for oversized input', () => {
    const body = formatReportBody(
      sampleReport({
        summary: 'Z'.repeat(5000),
        anomalies: ['a1', 'a2', 'a3', 'a4'],
        persons_of_interest: ['p1', 'p2', 'p3', 'p4'],
      }),
    )
    expect(Math.ceil(body.length / 4)).toBeLessThanOrEqual(SIM_REPORT_CAPS.bodyTokenBudget + 20)
  })
})

describe('buildDeterministicSimRunReport', () => {
  it('maps death exit to death_exit status', () => {
    const r = buildDeterministicSimRunReport({
      codename: 'Sequence Vigil',
      exitKind: 'death',
      sourceTurnId: 12,
      recentTurns: [{ role: 'assistant', content: 'You fall motionless on the marble.' }],
    })
    expect(r.status).toBe('death_exit')
    expect(r.codename).toBe('Sequence Vigil')
    expect(r.headline.length).toBeGreaterThan(0)
  })
})

describe('player model', () => {
  it('caps fields on compact', () => {
    const m = compactPlayerModel({
      hub_world_id: 1,
      tactics: ['a', 'b', 'c', 'd', 'e', 'f'],
      soft_spots: ['1', '2', '3', '4'],
      tells: [],
      open_goals: [],
      stance_toward_program: 'x'.repeat(300),
      antagonist_beliefs: [],
      updated_at: 't',
    })
    expect(m.tactics).toHaveLength(4)
    expect(m.soft_spots).toHaveLength(3)
    expect(m.stance_toward_program.length).toBeLessThanOrEqual(120)
  })

  it('refreshes from death exit', () => {
    const next = refreshPlayerModelFromReport({
      prior: emptyPlayerModel(10, 't0'),
      hubWorldId: 10,
      report: sampleReport(),
      exitKind: 'death',
      updatedAt: 't1',
    })
    expect(next.soft_spots.length).toBeGreaterThan(0)
    expect(next.antagonist_beliefs.length).toBeGreaterThan(0)
  })
})

describe('influence packet', () => {
  it('builds compact packet with vessel and pressure tags', () => {
    const packet = compactInfluencePacket(
      buildInfluencePacket({
        hubWorldId: 10,
        targetSubworldId: 99,
        bible: {
          antagonist: 'Director Hale runs the program',
          bleedMotifs: ['the coin', 'the bell'],
        } as MetaStoryBible,
        playerModel: emptyPlayerModel(10, 't'),
        recentReports: [sampleReport()],
        seed: 3,
      }),
    )
    expect(packet.plan_summary.length).toBeGreaterThan(0)
    expect(packet.plan_summary.length).toBeLessThanOrEqual(200)
    expect(packet.vessel).not.toBeNull()
    expect(packet.pressure_tags.length).toBeGreaterThan(0)
    expect(packet.pressure_tags.length).toBeLessThanOrEqual(4)
  })
})

describe('link antagonist', () => {
  const bible = {
    antagonist: 'Director Hale will burn the subject to stay hidden',
  } as MetaStoryBible

  it('extracts a name hint from prose (strips leading titles)', () => {
    expect(extractAntagonistNameHint(bible.antagonist)).toBe('Hale')
    expect(
      extractAntagonistNameHint(
        'Deputy Director Lira Voss, who will purge any crew member whose bleed threatens the final extraction window.',
      ),
    ).toBe('Lira Voss')
  })

  it('is idempotent when already linked', () => {
    const chars = [
      {
        id: 5,
        name: 'Hale',
        is_player: 0,
        clearance_level: 'antagonist',
        status: 'active',
        agency_level: 'local',
      },
    ] as Character[]
    expect(
      linkAntagonistCharacter({
        bible,
        hubCharacters: chars,
        existingAntagonistId: 5,
      }),
    ).toEqual({ action: 'already_linked', characterId: 5 })
  })

  it('matches existing by name hint', () => {
    const chars = [
      {
        id: 8,
        name: 'Director Hale',
        is_player: 0,
        clearance_level: 'public_crew',
        status: 'active',
        agency_level: 'local',
      },
    ] as Character[]
    const d = linkAntagonistCharacter({
      bible,
      hubCharacters: chars,
      existingAntagonistId: null,
    })
    expect(d.action).toBe('match_existing')
    if (d.action === 'match_existing') expect(d.characterId).toBe(8)
  })

  it('creates a named antagonist when the cast has no match (does not promote seniors)', () => {
    const chars = [
      {
        id: 21,
        name: 'Dana Noel',
        is_player: 0,
        clearance_level: 'public_crew',
        status: 'active',
        agency_level: 'local',
      },
    ] as Character[]
    const d = linkAntagonistCharacter({
      bible: {
        antagonist:
          'Deputy Director Lira Voss, who will purge any crew member whose bleed threatens the window.',
      } as MetaStoryBible,
      hubCharacters: chars,
      existingAntagonistId: null,
    })
    expect(d).toEqual({
      action: 'create',
      name: 'Lira Voss',
      description: expect.stringContaining('Lira Voss'),
    })
  })
})

describe('clearanceMeets', () => {
  it('orders levels correctly', () => {
    expect(clearanceMeets('classified', 'operator')).toBe(true)
    expect(clearanceMeets('public_crew', 'operator')).toBe(false)
    expect(clearanceMeets('antagonist', 'classified')).toBe(true)
  })
})

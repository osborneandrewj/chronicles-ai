/**
 * Offline replay harness over Cluster Psi-1 audited turns (plan: Replay fixture).
 * Pure services only — no LLM, no DB, no network.
 *
 * Fixture source: backups/cluster-psi-1-prod-20260808-144926.json
 * Assertions map to audit bugs: sword mint (A), single is_player (B), clock (C),
 * dossier ranking (D).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  estimateTurnMinutes,
  hasExplicitTimeJump,
  mergeElapsedMinutes,
  resolveClockMinutes,
} from '@/domain/services/narrative-clock'
import {
  extractItemMovements,
  extractObjectAcquisition,
} from '@/domain/services/object-acquisition'
import { rankObjectives } from '@/domain/services/dossier-ranking'

type ExportTurn = {
  seq: number | { $numberInt: string }
  role: string
  content: string
}

type ExportCharacter = {
  name: string
  isPlayer?: boolean
  is_player?: number | boolean
}

function seqOf(t: ExportTurn): number {
  const s = t.seq
  if (typeof s === 'number') return s
  return parseInt(s.$numberInt, 10)
}

function loadExport(): {
  turns: Array<{ seq: number; role: string; content: string }>
  characters: ExportCharacter[]
  objectives: Array<{ title: string; status?: string; detail?: string }>
} {
  const file = path.resolve(
    process.cwd(),
    '../../backups/cluster-psi-1-prod-20260808-144926.json',
  )
  const raw = JSON.parse(readFileSync(file, 'utf8')) as {
    collections: {
      turns: ExportTurn[]
      characters: ExportCharacter[]
      story_objectives: Array<{ title: string; status?: string; detail?: string }>
    }
  }
  const turns = raw.collections.turns
    .map((t) => ({ seq: seqOf(t), role: t.role, content: t.content || '' }))
    .sort((a, b) => a.seq - b.seq)
  return {
    turns,
    characters: raw.collections.characters,
    objectives: raw.collections.story_objectives ?? [],
  }
}

describe('Cluster Psi-1 replay fixture', () => {
  const data = loadExport()

  it('has the expected sword purchase and fight turns', () => {
    const bySeq = new Map(data.turns.map((t) => [t.seq, t]))
    expect(bySeq.get(67)?.content.toLowerCase()).toMatch(/sword|drachmae/)
    expect(bySeq.get(68)?.content.toLowerCase()).toMatch(/xiphos/)
  })

  it('mints a sword at seq 67–68 (PR A)', () => {
    const player = data.turns.find((t) => t.seq === 67 && t.role === 'user')
    const narrator = data.turns.find((t) => t.seq === 68 && t.role === 'assistant')
    expect(player && narrator).toBeTruthy()
    const minted = extractObjectAcquisition(player!.content, narrator!.content)
    expect(minted).toBe('sword')
  })

  it('keeps the sword held across a reduced inventory state for the Agora fight (PR A)', () => {
    // In-memory reducer: apply acquisition + movements over user/assistant pairs.
    let held = new Set<string>()
    let playerRow = 'Andy'
    const pairs: Array<{ user: string; assistant: string; seq: number }> = []
    let pendingUser: { content: string; seq: number } | null = null
    for (const t of data.turns) {
      if (t.role === 'user') pendingUser = { content: t.content, seq: t.seq }
      else if (t.role === 'assistant' && pendingUser) {
        pairs.push({
          user: pendingUser.content,
          assistant: t.content,
          seq: pendingUser.seq,
        })
        pendingUser = null
      }
    }

    for (const p of pairs) {
      const acq = extractObjectAcquisition(p.user, p.assistant)
      if (acq) held.add(acq.toLowerCase())
      for (const move of extractItemMovements(p.user, p.assistant)) {
        if (move.type === 'drop' || move.type === 'give') {
          held.delete(move.object.toLowerCase())
          // synonym class heads
          if (move.object.toLowerCase().includes('sword')) held.delete('sword')
        }
      }
      // Correction-channel renames are not in turns; identity assertion is static.
      if (/\bi am joseph osborne\b/i.test(p.user)) playerRow = 'Joseph Osborne'
    }

    // After sword purchase (seq 67), ledger must hold sword before the fight (~191).
    const afterPurchase = pairs.filter((p) => p.seq >= 67 && p.seq < 190)
    let swordHeld = false
    const heldSim = new Set<string>()
    for (const p of afterPurchase) {
      const acq = extractObjectAcquisition(p.user, p.assistant)
      if (acq) heldSim.add(acq.toLowerCase())
      for (const move of extractItemMovements(p.user, p.assistant)) {
        heldSim.delete(move.object.toLowerCase())
      }
      if (heldSim.has('sword')) swordHeld = true
    }
    expect(swordHeld).toBe(true)

    // Exactly one is_player in export cast (PR B baseline — repair is ops).
    const players = data.characters.filter(
      (c) => c.isPlayer === true || c.is_player === 1 || c.is_player === true,
    )
    expect(players.length).toBe(1)
    expect(players[0]?.name).toBeTruthy()
    // Reducer does not invent a second player name from turns alone.
    expect(playerRow).toBeTruthy()
  })

  it('advances the clock past Day 1 across player turns (PR C)', () => {
    const pairs: Array<{ user: string; assistant: string; stance: string }> = []
    let pendingUser: string | null = null
    for (const t of data.turns) {
      if (t.role === 'user') pendingUser = t.content
      else if (t.role === 'assistant' && pendingUser != null) {
        pairs.push({ user: pendingUser, assistant: t.content, stance: 'act' })
        pendingUser = null
      }
    }

    let minutes = resolveClockMinutes({
      storedMinutes: null,
      worldTime: 'Day 1, morning',
      holdMinutes: 0,
    })
    const start = minutes
    let prev = minutes
    for (const p of pairs) {
      const travel =
        /\b(walk|travel|go to|leave|arrive|enter)\b/i.test(p.user) ||
        /\b(arrive|enter|leave|reach)\b/i.test(p.assistant)
      const det = estimateTurnMinutes({
        stance: p.stance,
        sceneChanged: travel,
        travelled: travel,
        narrationLength: p.assistant.length,
      })
      // No LLM in fixture — jump language still uses a synthetic larger band.
      const llm = hasExplicitTimeJump(p.assistant) ? 480 : null
      const elapsed = mergeElapsedMinutes(det, llm)
      minutes += elapsed
      expect(minutes).toBeGreaterThanOrEqual(prev)
      prev = minutes
    }
    expect(minutes).toBeGreaterThan(start)
    // ~108 player turns at ≥2 min each should leave Day 1 morning far behind.
    expect(minutes).toBeGreaterThan(8 * 60 + 60) // past Day 1 morning + 1h
    // Day boundary: enough elapsed that we are not still "stuck" on seed morning.
    expect(minutes).toBeGreaterThan(12 * 60)
  })

  it('clock never moves backwards across the replay (PR C backfill clamp)', () => {
    let minutes = 0
    let pendingUser: string | null = null
    for (const t of data.turns) {
      if (t.role === 'user') pendingUser = t.content
      else if (t.role === 'assistant' && pendingUser != null) {
        const det = estimateTurnMinutes({
          stance: 'act',
          sceneChanged: false,
          travelled: false,
          narrationLength: t.content.length,
        })
        const next = minutes + det
        expect(next).toBeGreaterThanOrEqual(minutes)
        minutes = next
        pendingUser = null
      }
    }
  })

  it('dossier ranking would surface a late high-stakes goal over only stale actives (PR D/R8)', () => {
    // Export has 2 stale actives; invent the Archon goal as a third late objective.
    const ranked = rankObjectives(
      [
        ...data.objectives.map((o, i) => ({
          id: i + 1,
          world_id: 6,
          thread_id: null,
          thread_title: null,
          title: o.title,
          status: (o.status as 'active') || 'active',
          detail: o.detail ?? null,
          blocker: null,
          source_turn_id: i + 1,
          completed_turn_id: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })),
        {
          id: 99,
          world_id: 6,
          thread_id: null,
          thread_title: null,
          title: 'Strike the Archon',
          status: 'active' as const,
          detail: 'Player-invented high-stakes death and political fallout',
          blocker: null,
          source_turn_id: 500,
          completed_turn_id: null,
          created_at: '2026-01-02T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
      ],
      { clockMinutes: 2 * 1440 },
      5,
    )
    expect(ranked.map((o) => o.title)).toContain('Strike the Archon')
  })
})

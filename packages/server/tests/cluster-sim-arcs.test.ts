import { describe, expect, it } from 'vitest'

import { ARC_THRESHOLD, clusterSimArcs, type SimBeat } from '@/domain/services/cluster-sim-arcs'

const beat = (id: number, summary: string, title = ''): SimBeat => ({ id, title, summary })

describe('clusterSimArcs', () => {
  it('detects a two-person conspiracy arc across several beats', () => {
    // Newest-first, as read from the timeline.
    const beats = [
      beat(5, 'Marcus and Lena exchange a silent look in the dark.'),
      beat(4, 'Lena hides the anomaly reading; Marcus says nothing.'),
      beat(3, 'Marcus and Lena meet again by the conduit.'),
      beat(2, 'Torres reviews the cargo manifest alone.'),
      beat(1, 'Marcus catches Lena watching the console.'),
    ]
    const arcs = clusterSimArcs(beats, ['Marcus', 'Lena', 'Torres'])
    expect(arcs).toHaveLength(1)
    expect(arcs[0].participants.sort()).toEqual(['Lena', 'Marcus'])
    expect(arcs[0].beatCount).toBe(4)
    // Summaries returned oldest-first.
    expect(arcs[0].summaries[0]).toContain('Marcus catches Lena')
    expect(arcs[0].eventIds[0]).toBe(1)
  })

  it('does not flag a one-off interaction below the threshold', () => {
    const beats = [
      beat(2, 'Marcus and Lena share a glance.'),
      beat(1, 'Marcus and Lena pass in the corridor.'),
    ]
    expect(clusterSimArcs(beats, ['Marcus', 'Lena'])).toHaveLength(0)
  })

  it('detects a single-person developing subplot', () => {
    const beats = [
      beat(3, 'Torres lingers at the sealed hatch again.'),
      beat(2, 'Torres studies the hatch controls.'),
      beat(1, 'Torres returns to the sealed hatch.'),
    ]
    const arcs = clusterSimArcs(beats, ['Torres', 'Marcus'])
    expect(arcs).toHaveLength(1)
    expect(arcs[0].participants).toEqual(['Torres'])
    expect(arcs[0].beatCount).toBe(ARC_THRESHOLD)
  })

  it('does not double-count: a pair arc suppresses the redundant single arcs', () => {
    const beats = [
      beat(4, 'Marcus and Lena conspire by the vents.'),
      beat(3, 'Marcus and Lena conspire in the hold.'),
      beat(2, 'Marcus and Lena conspire on the bridge.'),
      beat(1, 'Marcus and Lena conspire in the dark.'),
    ]
    const arcs = clusterSimArcs(beats, ['Marcus', 'Lena'])
    // Only the pair arc — no separate Marcus-only / Lena-only arc.
    expect(arcs).toHaveLength(1)
    expect(arcs[0].participants.sort()).toEqual(['Lena', 'Marcus'])
  })

  it('ignores names that do not appear and matches on word boundaries', () => {
    const beats = [
      beat(3, 'Ed works the airlock.'),
      beat(2, 'Ed checks the seals.'),
      beat(1, 'Ed waits by the airlock.'),
    ]
    // "Ed" must not match inside "sealed"/"waited".
    const arcs = clusterSimArcs(beats, ['Ed'])
    expect(arcs).toHaveLength(1)
    expect(arcs[0].beatCount).toBe(3)
  })
})

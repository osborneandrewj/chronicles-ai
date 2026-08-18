import { describe, expect, it } from 'vitest'

import type { Character, StoryObjective, StoryThread } from '@/domain/entities'
import {
  applySettledFindingsToSnapshot,
  collectSettledAnchors,
  isSettledLeftoverThread,
  planNpcFocusHygiene,
  titlesAreSameThread,
} from '@/domain/services/settled-findings'

function thread(
  p: Partial<StoryThread> & Pick<StoryThread, 'id' | 'title'>,
): StoryThread {
  return {
    world_id: 2,
    kind: 'mystery',
    status: 'active',
    summary: null,
    stakes: null,
    rewards: null,
    consequences: null,
    hidden: null,
    relevance_tags_json: '[]',
    source_turn_id: 1,
    resolved_turn_id: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...p,
  }
}

function objective(
  p: Partial<StoryObjective> & Pick<StoryObjective, 'id' | 'title'>,
): StoryObjective {
  return {
    world_id: 2,
    thread_id: null,
    thread_title: null,
    status: 'active',
    detail: null,
    blocker: null,
    source_turn_id: 1,
    completed_turn_id: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...p,
  }
}

describe('isSettledLeftoverThread', () => {
  it('dorms Unexplained Tremor after Pre-Arrival Tremor Baseline resolves', () => {
    const threads = [
      thread({
        id: 14,
        title: 'Pre-Arrival Tremor Baseline',
        status: 'resolved',
      }),
      thread({ id: 13, title: 'Unexplained Tremor', status: 'active' }),
    ]
    expect(isSettledLeftoverThread(threads[1]!, threads, [])).toBe(true)
  })

  it('treats The Unexplained Tremor as the same leftover as Unexplained Tremor', () => {
    expect(titlesAreSameThread('The Unexplained Tremor', 'Unexplained Tremor')).toBe(true)
    const threads = [
      thread({ id: 13, title: 'Unexplained Tremor', status: 'resolved' }),
      thread({ id: 15, title: 'The Unexplained Tremor', status: 'active' }),
    ]
    expect(isSettledLeftoverThread(threads[1]!, threads, [])).toBe(true)
  })

  it('keeps a leftover if it still has an active objective', () => {
    const threads = [
      thread({ id: 14, title: 'Pre-Arrival Tremor Baseline', status: 'resolved' }),
      thread({ id: 13, title: 'Unexplained Tremor', status: 'active' }),
    ]
    const objectives = [
      objective({
        id: 1,
        title: 'Map the tremor tonight',
        thread_id: 13,
        thread_title: 'Unexplained Tremor',
        status: 'active',
      }),
    ]
    expect(isSettledLeftoverThread(threads[1]!, threads, objectives)).toBe(false)
  })
})

describe('planNpcFocusHygiene', () => {
  it('rewrites Ellis focus that is still requesting records after they landed', () => {
    const anchors = collectSettledAnchors({
      threads: [
        thread({
          id: 14,
          title: 'Pre-Arrival Tremor Baseline',
          status: 'resolved',
        }),
      ],
      objectives: [
        objective({
          id: 15,
          title: "Obtain Andrew's pre-assignment medical records",
          status: 'completed',
          detail: 'Retrieve prior medical history',
        }),
      ],
    })
    const writes = planNpcFocusHygiene(
      [
        {
          id: 12,
          is_player: 0,
          current_focus:
            'Need to pull prior clinic records and submit the request at oh-eight',
          active_goal: null,
          last_known_situation: null,
        } as Character,
      ],
      anchors,
    )
    expect(writes).toHaveLength(1)
    expect(writes[0]?.current_focus).toMatch(/settled/i)
    expect(writes[0]?.current_focus).toMatch(/records/i)
  })

  it('leaves unrelated night wrap-up focus alone', () => {
    const anchors = collectSettledAnchors({
      threads: [],
      objectives: [
        objective({
          id: 15,
          title: "Obtain Andrew's pre-assignment medical records",
          status: 'completed',
        }),
      ],
    })
    const writes = planNpcFocusHygiene(
      [
        {
          id: 12,
          is_player: 0,
          current_focus:
            'Andrew is heading to rest; dismiss the medical team for the night',
          active_goal: null,
          last_known_situation: null,
        } as Character,
      ],
      anchors,
    )
    expect(writes).toHaveLength(0)
  })

  it('does not stamp settled slogans onto last_known_situation', () => {
    const anchors = collectSettledAnchors({
      threads: [],
      objectives: [
        objective({
          id: 15,
          title: "Obtain Andrew's pre-assignment medical records",
          status: 'completed',
        }),
      ],
    })
    const writes = planNpcFocusHygiene(
      [
        {
          id: 14,
          is_player: 0,
          current_focus: 'Need to pull the medical records request',
          active_goal: null,
          last_known_situation: 'standing in Medical, clinic name written in her notepad',
        } as Character,
      ],
      anchors,
    )
    expect(writes[0]?.current_focus).toMatch(/settled/i)
    expect(writes[0]?.last_known_situation).toBeUndefined()
  })

  it('does not clobber a live crash focus', () => {
    const anchors = collectSettledAnchors({
      threads: [],
      objectives: [
        objective({
          id: 15,
          title: "Obtain Andrew's pre-assignment medical records",
          status: 'completed',
        }),
      ],
    })
    const writes = planNpcFocusHygiene(
      [
        {
          id: 14,
          is_player: 0,
          current_focus:
            'Need to pull records after the Latin episode and transfer him to the cot',
          active_goal: null,
          last_known_situation: null,
        } as Character,
      ],
      anchors,
    )
    expect(writes).toHaveLength(0)
  })
})

describe('applySettledFindingsToSnapshot', () => {
  it('marks leftover threads dormant and rewrites matching NPC focus', () => {
    const { next, dormantThreadIds, focusWrites } = applySettledFindingsToSnapshot({
      knownCharacters: [
        {
          id: 12,
          is_player: 0,
          current_focus: 'Waiting to retrieve the medical records request',
          active_goal: null,
          last_known_situation: null,
        } as Character,
      ],
      presentCharacters: [],
      dossier: {
        threads: [
          thread({
            id: 14,
            title: 'Pre-Arrival Tremor Baseline',
            status: 'resolved',
          }),
          thread({ id: 13, title: 'Unexplained Tremor', status: 'active' }),
        ],
        objectives: [
          objective({
            id: 15,
            title: "Obtain Andrew's pre-assignment medical records",
            status: 'completed',
          }),
        ],
        clues: [],
      },
    })
    expect(dormantThreadIds).toContain(13)
    expect(next.dossier.threads.find((t) => t.id === 13)?.status).toBe('dormant')
    expect(focusWrites).toHaveLength(1)
    expect(next.knownCharacters[0]?.current_focus).toMatch(/settled/i)
  })
})

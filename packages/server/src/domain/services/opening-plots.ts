// Deterministic opening-thread drafts from premise + ensemble + Booker shapes.
// Used by the stub seeder and as a fail-open fallback when Grok is unavailable.

import {
  pickSeedPlotShapes,
  type BasicPlot,
  type BasicPlotId,
} from '@/domain/services/basic-plots'

export type OpeningPlotCrew = {
  name: string
  role: string
  persona?: string
  goal?: string
}

export type OpeningPlotRelationship = {
  fromRole: string
  toRole: string
  kind: string
  valence: number
}

export type OpeningPlotDraft = {
  title: string
  kind: 'quest' | 'mystery' | 'threat' | 'relationship'
  summary: string
  stakes: string
  relevanceTags: string[]
  plotShape: BasicPlotId
}

export type DraftOpeningPlotsInput = {
  premise: string
  worldName?: string | null
  crew: OpeningPlotCrew[]
  relationships?: OpeningPlotRelationship[]
  seed: number
}

export function draftOpeningPlots(input: DraftOpeningPlotsInput): OpeningPlotDraft[] {
  const shapes = pickSeedPlotShapes(input.seed, 3)
  const lead = input.crew[0]
  const second = input.crew[1] ?? lead
  const rival = (input.relationships ?? []).find((r) => r.valence < 0)
  const rivalCrew = rival
    ? input.crew.find((c) => c.role === rival.fromRole || c.role === rival.toRole)
    : input.crew.find((c) => /director|captain|chief|abbot/i.test(c.role))
  const seen = new Set<string>()
  const drafts: OpeningPlotDraft[] = []
  for (const shape of shapes) {
    const draft = draftForShape(shape, {
      premise: input.premise,
      worldName: input.worldName ?? null,
      lead,
      second,
      rival: rivalCrew ?? null,
    })
    if (seen.has(draft.title.toLowerCase())) continue
    seen.add(draft.title.toLowerCase())
    drafts.push(draft)
  }
  return drafts
}

function draftForShape(
  shape: BasicPlot,
  ctx: {
    premise: string
    worldName: string | null
    lead?: OpeningPlotCrew
    second?: OpeningPlotCrew
    rival?: OpeningPlotCrew | null
  },
): OpeningPlotDraft {
  const place = ctx.worldName?.trim() || 'this posting'
  const ally = ctx.second?.name ?? ctx.lead?.name ?? 'a crewmate'
  const foe = ctx.rival?.name ?? ctx.lead?.name ?? 'someone in charge'
  switch (shape.id) {
    case 'overcoming_the_monster':
      return {
        title: `The Face ${foe} Hides`,
        kind: 'threat',
        summary: `${foe} will burn a newcomer to keep the true purpose of ${place} buried.`,
        stakes: 'If ignored, the program closes ranks and the newcomer becomes expendable.',
        relevanceTags: ['authority', 'records', 'private'],
        plotShape: shape.id,
      }
    case 'rags_to_riches':
      return {
        title: 'A Place on the Roster',
        kind: 'quest',
        summary: `The newcomer must earn a real role at ${place} before the posting decides they do not belong.`,
        stakes: 'Failure means transfer, erasure, or being written out of the logs.',
        relevanceTags: ['crew', 'mess', 'duty'],
        plotShape: shape.id,
      }
    case 'the_quest':
      return {
        title: 'The File They Will Not Open',
        kind: 'quest',
        summary: `A record about the newcomer — or about ${place} — exists and is being withheld.`,
        stakes: 'Without it, every official story stays a lie they can be punished for questioning.',
        relevanceTags: ['archive', 'records', 'office'],
        plotShape: shape.id,
      }
    case 'voyage_and_return':
      return {
        title: 'What the Sessions Are For',
        kind: 'mystery',
        summary: `The work at ${place} sends people into other lives; something in those crossings does not stay put.`,
        stakes: 'If unanswered, the newcomer will not know which memories are theirs.',
        relevanceTags: ['session', 'chamber', 'bleed'],
        plotShape: shape.id,
      }
    case 'comedy':
      return {
        title: `${ally}'s Crossed Signals`,
        kind: 'relationship',
        summary: `${ally} wants something from the newcomer that they will not name, and the rest of the crew is already reading it wrong.`,
        stakes: 'A public misunderstanding could strand the newcomer with no ally left.',
        relevanceTags: ['crew', 'mess', 'corridor'],
        plotShape: shape.id,
      }
    case 'tragedy':
      return {
        title: `The Line ${foe} Will Cross`,
        kind: 'threat',
        summary: `${foe} is already choosing the program over people; the next sacrifice is being lined up.`,
        stakes: 'Someone trusted will be used, and the newcomer may be the instrument.',
        relevanceTags: ['authority', 'night', 'private'],
        plotShape: shape.id,
      }
    case 'rebirth':
      return {
        title: 'Who Arrived in This Body',
        kind: 'mystery',
        summary: `The newcomer is not only new to ${place} — something about their identity does not match the file.`,
        stakes: 'If they accept the official story, they become whoever the program needs.',
        relevanceTags: ['identity', 'records', 'session'],
        plotShape: shape.id,
      }
  }
}

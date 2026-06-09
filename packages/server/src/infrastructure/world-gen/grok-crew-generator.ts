import 'server-only'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { xai } from '@ai-sdk/xai'
import { generateObject } from 'ai'
import { z } from 'zod'

import type {
  CrewGenerator,
  CrewGeneratorInput,
  GeneratedCrew,
} from '@/domain/ports/crew-generator'
import { withObjectRetry } from '@/infrastructure/llm/generate-object'
import { NARRATOR_MODEL } from '@/infrastructure/llm/model-registry'

// GrokCrewGenerator (starship P1) — the live CrewGenerator adapter. One-shot
// structured Grok call (mirrors lib/world-generator.ts's generateObject pattern,
// but Grok via @ai-sdk/xai instead of Haiku, and living in infrastructure). It
// turns an authored deck-plan template + premise into a dressed crew: ship name,
// room descriptions, 3–5 crew with time-banded daily loops, and a relationship
// graph. The system prompt is loaded at runtime from prompts/crew-dressing.md so
// it stays git-diffable; Zod validates the model output, and a deterministic
// StubCrewGenerator backs tests + the offline seed script with no spend.

const DAILY_LOOP_ENTRY = z.object({
  activity: z.string().min(1).max(200),
  place: z.string().min(1).max(120),
})

const CrewSchema = z.object({
  shipName: z.string().min(1).max(120),
  premise: z.string().min(20).max(2000),
  roomDressing: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        description: z.string().min(1).max(600),
      }),
    )
    .min(1),
  crew: z
    .array(
      z.object({
        role: z.string().min(1).max(80),
        name: z.string().min(1).max(120),
        persona: z.string().min(1).max(600),
        goal: z.string().min(1).max(400),
        homeRoomKey: z.string().min(1).max(80),
        dailyLoop: z.object({
          morning: DAILY_LOOP_ENTRY,
          midday: DAILY_LOOP_ENTRY,
          evening: DAILY_LOOP_ENTRY,
          night: DAILY_LOOP_ENTRY,
        }),
      }),
    )
    .min(3)
    .max(5),
  relationships: z
    .array(
      z.object({
        fromRole: z.string().min(1).max(80),
        toRole: z.string().min(1).max(80),
        kind: z.string().min(1).max(40),
        valence: z.number().min(-1).max(1),
      }),
    )
    .max(20),
})

function loadCrewDressingPrompt(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const file = path.resolve(moduleDir, '../../../prompts', 'crew-dressing.md')
  return readFileSync(file, 'utf8').trim()
}

export class GrokCrewGenerator implements CrewGenerator {
  async generate(input: CrewGeneratorInput): Promise<GeneratedCrew> {
    const { template, premise, playerName } = input

    const roomManifest = template.rooms
      .map((r) => `- key="${r.key}" name="${r.name}": ${r.description}`)
      .join('\n')
    const crewSlots = template.crew
      .map((c) => `- role="${c.role}" homeRoomKey="${c.homeRoomKey}": ${c.description}`)
      .join('\n')
    const nameLine = playerName
      ? `The protagonist is named "${playerName}" — do not reuse this name for a crew member.`
      : 'The protagonist is unnamed for now.'

    const { object } = await withObjectRetry(() =>
      generateObject({
        model: xai(NARRATOR_MODEL),
        schema: CrewSchema,
        system: loadCrewDressingPrompt(),
        prompt: [
          `PREMISE: ${premise}`,
          '',
          nameLine,
          '',
          `SHIP: ${template.name}`,
          '',
          'ROOM MANIFEST (rooms are fixed — reference by key):',
          roomManifest,
          '',
          'CREW SLOTS (one crew member each, in order):',
          crewSlots,
          '',
          'Dress this ship now.',
        ].join('\n'),
      }),
    )

    return object
  }
}

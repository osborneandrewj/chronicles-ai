import 'server-only'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'

import type { CharacterRelationship } from '@/domain/entities'
import type {
  DramaBeat,
  DramaBeatInput,
  DramaParticipant,
  DramaPort,
} from '@/domain/ports/drama-port'
import { withObjectRetry } from '@/infrastructure/llm/generate-object'
import { HAIKU_MODEL } from '@/infrastructure/llm/model-registry'

// HaikuDramaPort (starship P3) — the live DramaPort adapter and the ONLY LLM seam
// in the forward sim. A pure domain gate (beat-gating) decides WHETHER to spend a
// beat; this adapter generates one when authorized. One-shot structured Haiku call
// (mirrors lib/world-generator.ts's generateObject pattern). The system prompt is
// loaded at runtime from prompts/drama-beat.md so it stays git-diffable; Zod
// validates + constrains the model output (deltas scoped to the group, in a small
// range), and a deterministic StubDramaPort backs tests + the offline sim script
// with no spend. The beat is a compact structured event summary — NOT generated
// dialogue — per the "compact persistence" decision.

const VALENCE_DELTA_BOUND = 0.4

const DramaBeatSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  participant_ids: z.array(z.number().int()).min(1),
  valenceDeltas: z
    .array(
      z.object({
        from_character_id: z.number().int(),
        to_character_id: z.number().int(),
        delta: z.number().min(-VALENCE_DELTA_BOUND).max(VALENCE_DELTA_BOUND),
      }),
    )
    .max(20),
})

function loadDramaBeatPrompt(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const file = path.resolve(moduleDir, '../../../prompts', 'drama-beat.md')
  return readFileSync(file, 'utf8').trim()
}

function describeParticipant(p: DramaParticipant): string {
  const role = p.role ? ` role="${p.role}"` : ''
  const goal = p.goal ? ` goal="${p.goal}"` : ''
  return `- character_id=${p.character_id} name="${p.name}"${role}${goal}`
}

function describeRelationship(
  rel: CharacterRelationship,
  nameById: Map<number, string>,
): string {
  const from = nameById.get(rel.from_character_id) ?? `#${rel.from_character_id}`
  const to = nameById.get(rel.to_character_id) ?? `#${rel.to_character_id}`
  return `- ${from} (#${rel.from_character_id}) -> ${to} (#${rel.to_character_id}): ${rel.kind ?? 'relation'} valence ${rel.valence}`
}

export class HaikuDramaPort implements DramaPort {
  async generateBeat(input: DramaBeatInput): Promise<DramaBeat> {
    const nameById = new Map(input.participants.map((p) => [p.character_id, p.name]))
    const memberIds = new Set(input.participants.map((p) => p.character_id))

    // Only relationships internal to the co-located group are relevant.
    const groupRelationships = input.relationships.filter(
      (rel) => memberIds.has(rel.from_character_id) && memberIds.has(rel.to_character_id),
    )

    const participantBlock = input.participants.map(describeParticipant).join('\n')
    const relationshipBlock =
      groupRelationships.length > 0
        ? groupRelationships.map((rel) => describeRelationship(rel, nameById)).join('\n')
        : '(no recorded relationships among this group)'
    const threadBlock =
      input.threads.length > 0
        ? input.threads.map((t) => `- ${t}`).join('\n')
        : '(no active threads)'
    // Ship-wide beat memory: when non-empty, surface prior beats so the model
    // advances the situation instead of restating a conflict it already recorded.
    const recentBeatsBlock =
      input.recentBeats.length > 0
        ? [
            'ALREADY HAPPENED (do not repeat — advance the situation):',
            input.recentBeats.map((b) => `- ${b}`).join('\n'),
            '',
          ]
        : []

    const { object } = await withObjectRetry(() =>
      generateObject({
      model: anthropic(HAIKU_MODEL),
      schema: DramaBeatSchema,
      system: loadDramaBeatPrompt(),
      prompt: [
        `PLACE: ${input.place_name} (place_id=${input.place_id})`,
        input.world_time ? `WORLD TIME: ${input.world_time}` : '',
        '',
        'PARTICIPANTS (co-located right now):',
        participantBlock,
        '',
        'RELATIONSHIPS (within this group):',
        relationshipBlock,
        '',
        'ACTIVE THREADS:',
        threadBlock,
        '',
        ...recentBeatsBlock,
        'Record one beat for this group now.',
      ]
        .filter((line) => line !== '')
        .join('\n'),
      }),
    )

    // Trust-but-verify: clamp the model to the co-located group so a stray id
    // never reaches relationship drift. (The Zod range already bounds delta.)
    return {
      title: object.title,
      summary: object.summary,
      participant_ids: object.participant_ids.filter((id) => memberIds.has(id)),
      valenceDeltas: object.valenceDeltas.filter(
        (d) => memberIds.has(d.from_character_id) && memberIds.has(d.to_character_id),
      ),
    }
  }
}

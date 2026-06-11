import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ArchivistPatchSchema } from '@/lib/archivist'
import { coerceJsonObject, tolerateNulls } from '@/lib/llm-schema'
import { NpcAgentPatchSchema } from '@/lib/npc-agent'

describe('tolerateNulls', () => {
  const schema = tolerateNulls(
    z.object({
      keep: z.string().optional(),
      // non-nullable optional: a stray null here must NOT fail the whole object
      strip: z.string().optional(),
      // deliberately nullable ("set null to clear"): null must be PRESERVED
      clearable: z.string().nullable().optional(),
    }),
  )

  it('drops null on a non-nullable optional field instead of failing validation', () => {
    expect(schema.parse({ keep: 'x', strip: null })).toEqual({ keep: 'x' })
  })

  it('preserves null on a field that deliberately accepts null', () => {
    expect(schema.parse({ clearable: null })).toEqual({ clearable: null })
  })

  it('leaves non-null values and absent keys untouched', () => {
    expect(schema.parse({ keep: 'a', strip: 'b' })).toEqual({ keep: 'a', strip: 'b' })
  })

  it('works as an array element schema', () => {
    const arr = z.array(tolerateNulls(z.object({ a: z.string().optional() })))
    expect(arr.parse([{ a: null }, { a: 'y' }])).toEqual([{}, { a: 'y' }])
  })
})

describe('coerceJsonObject', () => {
  const scene = coerceJsonObject(
    z.object({ action: z.literal('open'), title: z.string() }),
  ).optional()

  it('parses a stringified object back into an object before validation', () => {
    expect(scene.parse('{"action":"open","title":"X"}')).toEqual({ action: 'open', title: 'X' })
  })

  it('accepts a real object unchanged', () => {
    expect(scene.parse({ action: 'open', title: 'Y' })).toEqual({ action: 'open', title: 'Y' })
  })

  it('leaves an absent optional value undefined', () => {
    expect(scene.parse(undefined)).toBeUndefined()
  })

  it('passes an unparseable string through to fail validation as before', () => {
    expect(() => scene.parse('not json')).toThrow()
  })
})

// Regression: the exact malformations observed in prod logs on World 10 must no
// longer discard the whole patch.
describe('agent patch schemas tolerate the malformations seen in prod', () => {
  it('NpcAgentPatchSchema keeps a valid daily_loop when a sibling field is null', () => {
    const parsed = NpcAgentPatchSchema.parse({
      npc_updates: [
        { name: 'Abby', activity_append: null, daily_loop: { morning: { activity: 'opens the shop' } } },
      ],
    })
    expect(parsed.npc_updates?.[0]?.daily_loop?.morning?.activity).toBe('opens the shop')
    expect(parsed.npc_updates?.[0]?.activity_append).toBeUndefined()
  })

  it('NpcAgentPatchSchema still honors a deliberate null on a clearable field', () => {
    const parsed = NpcAgentPatchSchema.parse({
      npc_updates: [{ name: 'Abby', in_transit_to: null }],
    })
    expect(parsed.npc_updates?.[0]?.in_transit_to).toBeNull()
  })

  it('ArchivistPatchSchema tolerates a null current_place_name and a stringified scene', () => {
    const parsed = ArchivistPatchSchema.parse({
      characters: [{ name: 'Titus', current_place_name: null, status: 'active' }],
      scene: '{\n  "action": "keep_open"\n}',
    })
    expect(parsed.characters?.[0]?.current_place_name).toBeUndefined()
    expect(parsed.characters?.[0]?.name).toBe('Titus')
    expect(parsed.scene).toEqual({ action: 'keep_open' })
  })

  it('ArchivistPatchSchema still honors a deliberate null on a clearable field', () => {
    const parsed = ArchivistPatchSchema.parse({
      characters: [{ name: 'Titus', active_goal: null }],
    })
    expect(parsed.characters?.[0]?.active_goal).toBeNull()
  })
})

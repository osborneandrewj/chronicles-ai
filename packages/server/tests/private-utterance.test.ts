import { describe, expect, it } from 'vitest'

import {
  detectPrivateUtterance,
  filterArchivistKnowledgeForAudience,
  isAudience,
  playerTextForNpc,
  privateUtteranceFromMetadata,
  privateUtteranceToMetadata,
  publicDigest,
  redactedPlayerTextForNonAudience,
  type PrivateUtterance,
} from '@/domain/services/private-utterance'

const chars = [
  { id: 1, name: 'Player', is_player: 1 as const, status: 'active' },
  { id: 10, name: 'Marcus', is_player: 0 as const, status: 'active' },
  { id: 11, name: 'Kyle', is_player: 0 as const, status: 'active' },
  { id: 12, name: 'Jordana Reed', aliases: 'Jordana', is_player: 0 as const, status: 'active' },
  { id: 13, name: 'Andy Osborne', aliases: 'Andy', is_player: 0 as const, status: 'active' },
]

function whisperMarcus(overrides: Partial<PrivateUtterance> = {}): PrivateUtterance {
  return {
    channel: 'whisper',
    audienceCharacterIds: [10],
    audienceNames: ['Marcus'],
    contentHint: 'The letter is under the floorboard.',
    createdTurnId: 100,
    mayOverhear: false,
    status: 'active',
    ...overrides,
  }
}

describe('detectPrivateUtterance', () => {
  it('detects whisper to a known character', () => {
    const u = detectPrivateUtterance(
      'I whisper to Marcus, "The letter is under the floorboard."',
      chars,
      100,
    )
    expect(u).not.toBeNull()
    expect(u!.channel).toBe('whisper')
    expect(u!.audienceCharacterIds).toEqual([10])
    expect(u!.audienceNames).toEqual(['Marcus'])
    expect(u!.createdTurnId).toBe(100)
    expect(u!.status).toBe('active')
    expect(u!.mayOverhear).toBe(false)
    expect(u!.contentHint).toMatch(/floorboard/i)
  })

  it('detects lean-in and aside channels', () => {
    const lean = detectPrivateUtterance(
      'I lean in to Kyle and tell him the safe code is 9921',
      chars,
      1,
    )
    expect(lean).not.toBeNull()
    expect(lean!.channel).toBe('whisper')
    expect(lean!.audienceCharacterIds).toEqual([11])

    const aside = detectPrivateUtterance(
      'Aside to Jordana: do not trust the courier.',
      chars,
      2,
    )
    expect(aside).not.toBeNull()
    expect(aside!.channel).toBe('aside')
    expect(aside!.audienceCharacterIds).toEqual([12])
  })

  it('detects text / DM / private call', () => {
    const text = detectPrivateUtterance(
      'I text Jordana: "Meet me at the pier at midnight."',
      chars,
      3,
    )
    expect(text).not.toBeNull()
    expect(text!.channel).toBe('text')
    expect(text!.audienceCharacterIds).toEqual([12])

    const dm = detectPrivateUtterance('I DM Kyle the warehouse address', chars, 4)
    expect(dm).not.toBeNull()
    expect(dm!.channel).toBe('dm')
    expect(dm!.audienceCharacterIds).toEqual([11])

    const call = detectPrivateUtterance(
      'I call Marcus privately about the letter',
      chars,
      5,
    )
    expect(call).not.toBeNull()
    expect(call!.channel).toBe('private_call')
    expect(call!.audienceCharacterIds).toEqual([10])
  })

  it('supports multi-audience when both names resolve', () => {
    const u = detectPrivateUtterance(
      'I whisper to Marcus and Kyle, "The letter is under the floorboard."',
      chars,
      6,
    )
    expect(u).not.toBeNull()
    expect(u!.audienceCharacterIds.sort()).toEqual([10, 11])
    expect(u!.audienceNames).toContain('Marcus')
    expect(u!.audienceNames).toContain('Kyle')
  })

  it('ignores public speech and invents no audience for unknown names', () => {
    expect(detectPrivateUtterance('I say "Hello everyone" to the room', chars, 1)).toBeNull()
    expect(detectPrivateUtterance('Hello everyone', chars, 1)).toBeNull()
    expect(
      detectPrivateUtterance(
        'I whisper to StrangerX, "The letter is under the floorboard."',
        chars,
        1,
      ),
    ).toBeNull()
    expect(detectPrivateUtterance('I look around carefully', chars, 1)).toBeNull()
  })

  it('does not target the player character', () => {
    expect(detectPrivateUtterance('I whisper to Player the secret', chars, 1)).toBeNull()
  })

  it('sets mayOverhear only for loud / failed-stealth whispers', () => {
    const loud = detectPrivateUtterance(
      'I whisper too loud to Marcus "the letter is under the floorboard"',
      chars,
      1,
    )
    expect(loud).not.toBeNull()
    expect(loud!.mayOverhear).toBe(true)

    const text = detectPrivateUtterance(
      'I text Marcus loudly "the letter is under the floorboard"',
      chars,
      2,
    )
    expect(text).not.toBeNull()
    expect(text!.mayOverhear).toBe(false)
  })

  it('resolves aliases (Jordana from Jordana Reed)', () => {
    const u = detectPrivateUtterance('I text Jordana the pier address', chars, 1)
    expect(u).not.toBeNull()
    expect(u!.audienceCharacterIds).toEqual([12])
    expect(u!.audienceNames).toEqual(['Jordana Reed'])
  })
})

describe('isAudience / playerTextForNpc / publicDigest', () => {
  const u = whisperMarcus()

  it('membership is id-scoped', () => {
    expect(isAudience(10, u)).toBe(true)
    expect(isAudience(11, u)).toBe(false)
    expect(isAudience(10, null)).toBe(false)
  })

  it('gives full player text only to audience NPCs', () => {
    const full = 'I whisper to Marcus, "The letter is under the floorboard."'
    expect(playerTextForNpc(full, 10, u)).toBe(full)
    const redacted = playerTextForNpc(full, 11, u)
    expect(redacted).not.toContain('floorboard')
    expect(redacted.toLowerCase()).toContain('marcus')
    expect(redacted.toLowerCase()).toContain('not audible')
  })

  it('publicDigest redacts contentHint spans and falls back to a short digest', () => {
    const prior =
      'You lean close. Marcus nods as you say the letter is under the floorboard. Kyle watches the door.'
    const out = publicDigest(prior, u)
    expect(out.toLowerCase()).not.toContain('floorboard')
    expect(out.toLowerCase()).toContain('private to marcus')

    const noHint = publicDigest(
      'You lean close and share a secret. Kyle watches the door.',
      whisperMarcus({ contentHint: undefined }),
    )
    expect(noHint).toMatch(/private exchange with Marcus redacted/i)
  })

  it('redactedPlayerTextForNonAudience never leaks content', () => {
    const line = redactedPlayerTextForNonAudience(u)
    expect(line).not.toContain('floorboard')
    expect(line.toLowerCase()).toContain('marcus')
  })
})

describe('filterArchivistKnowledgeForAudience', () => {
  const u = whisperMarcus()

  it('drops non-audience observations_append under active private utterance', () => {
    const patch = filterArchivistKnowledgeForAudience(
      {
        characters: [
          { name: 'Marcus', observations_append: 'heard about the floorboard letter' },
          { name: 'Kyle', observations_append: 'heard about the floorboard letter' },
          { name: 'Jordana Reed', observations_append: 'somehow knows the floorboard letter' },
          { name: 'Marcus', current_attitude: 'tense' },
        ],
      },
      u,
      chars,
    )
    expect(patch.characters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Marcus',
          observations_append: 'heard about the floorboard letter',
        }),
        expect.objectContaining({ name: 'Marcus', current_attitude: 'tense' }),
      ]),
    )
    const kyle = patch.characters?.find((c) => c.name === 'Kyle')
    expect(kyle).toBeUndefined()
    const jordana = patch.characters?.find((c) => c.name === 'Jordana Reed')
    expect(jordana).toBeUndefined()
  })

  it('is a no-op when no private utterance is active', () => {
    const input = {
      characters: [
        { name: 'Kyle', observations_append: 'noticed Andrew was quiet' },
      ],
    }
    expect(filterArchivistKnowledgeForAudience(input, null, chars)).toEqual(input)
  })

  it('keeps non-observation fields on non-audience rows', () => {
    const patch = filterArchivistKnowledgeForAudience(
      {
        characters: [
          {
            name: 'Kyle',
            observations_append: 'heard the secret',
            current_attitude: 'bored',
          },
        ],
      },
      u,
      chars,
    )
    expect(patch.characters).toEqual([
      { name: 'Kyle', current_attitude: 'bored' },
    ])
  })
})

describe('privateUtterance metadata round-trip', () => {
  it('serializes and parses cleanly', () => {
    const u = whisperMarcus()
    const meta = privateUtteranceToMetadata(u)
    const back = privateUtteranceFromMetadata(meta)
    expect(back).toEqual(u)
  })

  it('rejects malformed metadata', () => {
    expect(privateUtteranceFromMetadata(null)).toBeNull()
    expect(privateUtteranceFromMetadata({})).toBeNull()
    expect(privateUtteranceFromMetadata({ channel: 'whisper' })).toBeNull()
  })
})

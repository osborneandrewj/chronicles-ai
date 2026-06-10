import { describe, expect, it } from 'vitest'

import { extractObjectAcquisition } from '@/domain/services/object-acquisition'

describe('extractObjectAcquisition', () => {
  it('extracts a taken object the narrator honours', () => {
    expect(
      extractObjectAcquisition('I take the photograph from her pocket', 'You slip the photograph free.'),
    ).toBe('photograph')
  })

  it('extracts a picked-up object', () => {
    expect(
      extractObjectAcquisition('I pick up the bolt pistol', 'Your hand closes around the bolt pistol.'),
    ).toBe('bolt pistol')
  })

  it('extracts a pocketed object', () => {
    expect(
      extractObjectAcquisition('i pocket the data pad', 'The data pad disappears into your jacket.'),
    ).toBe('data pad')
  })

  it('extracts an object handed to the player', () => {
    expect(
      extractObjectAcquisition('nothing', 'She hands you a brass key without a word.'),
    ).toBe('brass key')
  })

  it('strips a trailing clause to the bare object', () => {
    expect(
      extractObjectAcquisition('I grab the chainsword and swing it', 'You heft the chainsword.'),
    ).toBe('chainsword')
  })

  it('returns null when the narrator does not honour the grab', () => {
    expect(
      extractObjectAcquisition('I grab the pistol', 'Torres knocks your hand aside before you reach it.'),
    ).toBeNull()
  })

  it('ignores non-object idioms', () => {
    expect(extractObjectAcquisition('I take a look around', 'You survey the room.')).toBeNull()
    expect(extractObjectAcquisition('I take cover', 'You duck behind the crates.')).toBeNull()
    expect(extractObjectAcquisition('I grab her hand', 'You hold her hand.')).toBeNull()
  })

  it('returns null when there is no acquisition verb', () => {
    expect(extractObjectAcquisition('I look at the photograph', 'You study the photograph.')).toBeNull()
  })
})

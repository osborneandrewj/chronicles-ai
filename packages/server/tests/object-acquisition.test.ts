import { describe, expect, it } from 'vitest'

import {
  extractItemMovements,
  extractObjectAcquisition,
} from '@/domain/services/object-acquisition'

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

  // ── PR A: purchase / synonym / tightened acceptance ──────────────────────

  it('mints a sword when the player buys one and the narrator says xiphos', () => {
    // Cluster Psi-1 seq 67–68: player said "sword", narrator said "xiphos".
    expect(
      extractObjectAcquisition(
        'I pick up the sword. then I give the merchant 22 drachmae.',
        'You lift the xiphos from the merchant’s outstretched hand, the iron balanced cleanly along your forearm, and a low whistle escapes you as twenty-two drachmae change hands.',
      ),
    ).toBe('sword')
  })

  it('mints from buy / purchase commerce verbs', () => {
    expect(
      extractObjectAcquisition(
        'I buy the sword from the merchant',
        'You take the blade, buckling it at your hip as coins change hands.',
      ),
    ).toBe('sword')
  })

  it('mints from accept', () => {
    expect(
      extractObjectAcquisition(
        'I accept the cloak',
        'You accept the cloak, settling it across your shoulders.',
      ),
    ).toBe('cloak')
  })

  it('does not match sword as a substring of swordsman (word-boundary)', () => {
    expect(
      extractObjectAcquisition(
        'I take the sword',
        'The swordsman blocks your path.',
      ),
    ).toBeNull()
  })

  it('rejects a synonym present without a nearby possession verb', () => {
    expect(
      extractObjectAcquisition(
        'I take the sword',
        "A guard's blade rasps in its scabbard across the courtyard.",
      ),
    ).toBeNull()
  })

  it('rejects an exact noun with a denied possession outcome', () => {
    expect(
      extractObjectAcquisition(
        'I take the sword',
        'The guard keeps the sword out of reach.',
      ),
    ).toBeNull()
  })

  it('accepts synonym + possession verb (xiphos/sword)', () => {
    expect(
      extractObjectAcquisition(
        'I take the sword',
        'You lift the xiphos, belting it on.',
      ),
    ).toBe('sword')
  })

  it('does not treat currency as a give-object movement', () => {
    expect(
      extractItemMovements(
        'I give the merchant my drachmae',
        '…coins change hands as the merchant nods.',
      ),
    ).toEqual([])
  })

  it('does not mint currency as an acquired object', () => {
    expect(
      extractObjectAcquisition(
        'I take the drachmae',
        'You take the drachmae from the table.',
      ),
    ).toBeNull()
  })
})

describe('extractItemMovements', () => {
  it('extracts a drop with the location clause stripped to the bare object', () => {
    expect(
      extractItemMovements('I drop the key on the floor', 'You let the key fall to the concrete.'),
    ).toEqual([{ type: 'drop', object: 'key' }])
  })

  it('extracts a stash', () => {
    expect(
      extractItemMovements('I stash the bolt pistol under the seat', 'You wedge the bolt pistol out of sight.'),
    ).toEqual([{ type: 'drop', object: 'bolt pistol' }])
  })

  it('extracts a give (recipient first) and names the recipient', () => {
    expect(
      extractItemMovements('I hand Torres the pistol', 'You pass Torres the pistol grip-first.'),
    ).toEqual([{ type: 'give', object: 'pistol', recipient: 'Torres' }])
  })

  it('extracts a give phrased object-first with "to"', () => {
    expect(
      extractItemMovements('I give the photograph to Mara', 'You hold the photograph out and Mara takes it.'),
    ).toEqual([{ type: 'give', object: 'photograph', recipient: 'Mara' }])
  })

  it('prefers the give shape over drop when both could match', () => {
    expect(
      extractItemMovements('I hand Torres the key', 'Torres closes a fist around the key.'),
    ).toEqual([{ type: 'give', object: 'key', recipient: 'Torres' }])
  })

  it('returns nothing when the narrator does not honour the move', () => {
    expect(
      extractItemMovements('I drop the key', 'You think better of it and keep your hand closed.'),
    ).toEqual([])
  })

  it('does not treat "hand over the key to Torres" recipient as "over"', () => {
    expect(
      extractItemMovements('I hand over the key to Torres', 'Torres takes the key.'),
    ).toEqual([{ type: 'give', object: 'key', recipient: 'Torres' }])
  })
})

import { describe, expect, it } from 'vitest'
import {
  actionForButton,
  actionForKey,
  DEFAULT_BINDINGS,
  describeKey,
  normaliseKey,
  sanitizeBindings,
} from './bindings'

describe('normaliseKey', () => {
  it('treats a key and its shifted form as the same key', () => {
    // Reaching for a harder gear should not require finding the shifted form
    // of the key mid-climb.
    expect(normaliseKey('=')).toBe(normaliseKey('+'))
    expect(normaliseKey('_')).toBe(normaliseKey('-'))
  })

  it('ignores the shift state of letters', () => {
    expect(normaliseKey('E')).toBe(normaliseKey('e'))
  })

  it('keeps named keys distinguishable', () => {
    expect(normaliseKey('ArrowUp')).not.toBe(normaliseKey('ArrowDown'))
  })
})

describe('actionForKey', () => {
  it('resolves the defaults however the key is reported', () => {
    expect(actionForKey(DEFAULT_BINDINGS, '=')).toBe('shiftUp')
    expect(actionForKey(DEFAULT_BINDINGS, '+')).toBe('shiftUp')
    expect(actionForKey(DEFAULT_BINDINGS, 'ArrowDown')).toBe('shiftDown')
    expect(actionForKey(DEFAULT_BINDINGS, 'ArrowRight')).toBe('powerUp10')
  })

  it('says nothing about a key nobody bound', () => {
    expect(actionForKey(DEFAULT_BINDINGS, 'q')).toBeUndefined()
  })
})

describe('describeKey', () => {
  it('writes keys the way a rider would recognise them', () => {
    expect(describeKey(' ')).toBe('Space')
    expect(describeKey('e')).toBe('E')
    expect(describeKey('arrowup')).toBe('Arrow up')
    expect(describeKey('pagedown')).toBe('Page down')
  })
})

describe('sanitizeBindings', () => {
  it('falls back to the defaults when nothing was stored', () => {
    expect(sanitizeBindings(undefined)).toEqual(DEFAULT_BINDINGS)
    expect(sanitizeBindings('nonsense')).toEqual(DEFAULT_BINDINGS)
  })

  it('keeps an empty table rather than restoring the defaults over it', () => {
    // Unbinding everything is a legitimate choice, and having the defaults
    // reappear on the next load would be maddening.
    expect(sanitizeBindings({ keys: {} }).keys).toEqual({})
  })

  it('drops entries naming an action that no longer exists', () => {
    const bindings = sanitizeBindings({ keys: { a: 'shiftUp', b: 'launchTheRocket' } })
    expect(bindings.keys).toEqual({ a: 'shiftUp' })
  })

  it('normalises stored keys, so an old table still matches', () => {
    expect(sanitizeBindings({ keys: { '=': 'shiftUp' } }).keys).toEqual({ '+': 'shiftUp' })
  })

  it('reads the legacy swap setting when there are no bindings yet', () => {
    expect(sanitizeBindings(undefined, true).click).toEqual({ up: 'shiftDown', down: 'shiftUp' })
  })

  it('lets stored bindings win over the legacy setting', () => {
    const bindings = sanitizeBindings({ click: { up: 'powerUp50', down: 'powerDown50' } }, true)
    expect(bindings.click).toEqual({ up: 'powerUp50', down: 'powerDown50' })
  })

  it('falls back per side, not all or nothing', () => {
    const bindings = sanitizeBindings({ click: { up: 'togglePause' } })
    expect(bindings.click).toEqual({ up: 'togglePause', down: 'shiftDown' })
  })
})

describe('actionForButton', () => {
  const bindings = { ...DEFAULT_BINDINGS, buttons: {} }

  it('uses the documented layout for buttons we recognise', () => {
    expect(actionForButton(bindings, 'v1:1')).toBe('shiftUp')
    expect(actionForButton(bindings, 'v2:0x400')).toBe('shiftDown')
  })

  it('does nothing at all for a button we do not recognise', () => {
    // Guessing would shift the wrong way, which is worse than being inert
    // until the rider says what the button is for.
    expect(actionForButton(bindings, 'v2:0x8000')).toBe('nothing')
  })

  it('lets an override win over the documented layout', () => {
    const overridden = { ...bindings, buttons: { 'v1:1': 'powerUp10' as const } }
    expect(actionForButton(overridden, 'v1:1')).toBe('powerUp10')
  })

  it('binds a button no layout describes', () => {
    const learned = { ...bindings, buttons: { 'v2:0x8000': 'shiftDown' as const } }
    expect(actionForButton(learned, 'v2:0x8000')).toBe('shiftDown')
  })

  it('still honours a swapped pair for recognised buttons', () => {
    const swapped = { ...bindings, click: { up: 'shiftDown' as const, down: 'shiftUp' as const } }
    expect(actionForButton(swapped, 'v1:1')).toBe('shiftDown')
    expect(actionForButton(swapped, 'v1:2')).toBe('shiftUp')
  })
})

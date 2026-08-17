import { describe, expect, it } from 'vitest'
import {
  appearanceAttributes,
  DEFAULT_APPEARANCE,
  resolveTheme,
  sanitizeAppearance,
  TEXT_SCALES,
} from './appearance'

describe('resolveTheme', () => {
  it('follows the system only when asked to', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('lets an explicit choice override the system', () => {
    // The case a media query alone cannot express.
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('sanitizeAppearance', () => {
  it('defaults to following the system', () => {
    expect(sanitizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
    expect(sanitizeAppearance('nonsense')).toEqual(DEFAULT_APPEARANCE)
  })

  it('keeps a real choice', () => {
    expect(sanitizeAppearance({ theme: 'light', highContrast: true }).theme).toBe('light')
    expect(sanitizeAppearance({ highContrast: true }).highContrast).toBe(true)
  })

  it('rejects a theme nobody defined', () => {
    expect(sanitizeAppearance({ theme: 'sepia' }).theme).toBe('system')
  })

  it('snaps the text scale to a size the layout was built for', () => {
    // A stored 3.7 would break every panel at once.
    expect(sanitizeAppearance({ textScale: 3.7 }).textScale).toBe(1)
    expect(sanitizeAppearance({ textScale: 1.3 }).textScale).toBe(1.3)
    for (const scale of TEXT_SCALES) {
      expect(sanitizeAppearance({ textScale: scale }).textScale).toBe(scale)
    }
  })

  it('only accepts a real true for the switches', () => {
    for (const value of [1, 'yes', {}, null]) {
      expect(sanitizeAppearance({ announce: value }).announce).toBe(false)
      expect(sanitizeAppearance({ highContrast: value }).highContrast).toBe(false)
    }
  })
})

describe('appearanceAttributes', () => {
  it('always resolves to a concrete theme, never "system"', () => {
    // The stylesheet has no rule for "system", by design: the choice is made
    // here so the same answer can be applied before the first paint.
    expect(appearanceAttributes(DEFAULT_APPEARANCE, true).theme).toBe('dark')
    expect(appearanceAttributes(DEFAULT_APPEARANCE, false).theme).toBe('light')
  })

  it('reports contrast and scale as plain attribute values', () => {
    const attributes = appearanceAttributes(
      { ...DEFAULT_APPEARANCE, highContrast: true, textScale: 1.3 },
      false,
    )
    expect(attributes.contrast).toBe('high')
    expect(attributes.textScale).toBe('1.3')
  })
})

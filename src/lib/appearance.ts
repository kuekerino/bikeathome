/**
 * How the app looks, and how much it says out loud.
 *
 * The theme is resolved in JavaScript and stamped onto the root element rather
 * than left to a media query, because there are three choices — light, dark and
 * "whatever the system says" — and a media query alone cannot express the
 * third being overridden by the first two.
 */

export type ThemeChoice = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/** Steps rather than a slider: a slider invites a size nothing is tested at. */
export const TEXT_SCALES = [1, 1.15, 1.3, 1.5] as const

export interface AppearanceSettings {
  theme: ThemeChoice
  /**
   * Stronger colours and visible borders. Separate from the theme because
   * needing more contrast says nothing about preferring light or dark.
   */
  highContrast: boolean
  textScale: number
  /**
   * Announce what changes — a new interval, the heart rate ceiling crossed —
   * through a live region, for riders who cannot watch the screen.
   */
  announce: boolean
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'system',
  highContrast: false,
  textScale: 1,
  announce: false,
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'light' || choice === 'dark') return choice
  return prefersDark ? 'dark' : 'light'
}

export function sanitizeAppearance(raw: unknown): AppearanceSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_APPEARANCE

  const input = raw as Partial<Record<keyof AppearanceSettings, unknown>>
  const theme = input.theme
  const scale = input.textScale

  return {
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system',
    highContrast: input.highContrast === true,
    // Snapped to a known step: a stored 3.7 would break every layout at once.
    textScale:
      typeof scale === 'number' && Number.isFinite(scale)
        ? (TEXT_SCALES.find((s) => Math.abs(s - scale) < 0.001) ?? 1)
        : 1,
    announce: input.announce === true,
  }
}

/** Everything the document needs to know, as plain attributes. */
export function appearanceAttributes(
  settings: AppearanceSettings,
  prefersDark: boolean,
): { theme: ResolvedTheme; contrast: 'normal' | 'high'; textScale: string } {
  return {
    theme: resolveTheme(settings.theme, prefersDark),
    contrast: settings.highContrast ? 'high' : 'normal',
    textScale: String(settings.textScale),
  }
}

/**
 * Applies the look to the document.
 *
 * Kept out of the component tree so the same call can run from an inline
 * script before the first paint, which is what stops a light-mode rider being
 * shown a dark screen for a frame.
 */
export function applyAppearance(settings: AppearanceSettings, prefersDark: boolean): void {
  if (typeof document === 'undefined') return

  const { theme, contrast, textScale } = appearanceAttributes(settings, prefersDark)
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.contrast = contrast
  root.style.setProperty('--text-scale', textScale)
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

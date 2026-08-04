/**
 * Which key, and which Click button, does what.
 *
 * Stored as data rather than baked into the devices, so the same table serves
 * a keyboard and a two-button shifter, and so a rider can rearrange either
 * without a code change.
 */

import { isRideAction, type RideAction } from './actions'

export interface Bindings {
  /** Normalised key name to action. */
  keys: Record<string, RideAction>
  /** The Click's two buttons, whichever way round they turn out to be. */
  click: { up: RideAction; down: RideAction }
}

export const DEFAULT_BINDINGS: Bindings = {
  keys: {
    '+': 'shiftUp',
    '-': 'shiftDown',
    arrowup: 'shiftUp',
    arrowdown: 'shiftDown',
    arrowright: 'powerUp10',
    arrowleft: 'powerDown10',
    pageup: 'powerUp50',
    pagedown: 'powerDown50',
    e: 'togglePower',
    ' ': 'togglePause',
  },
  click: { up: 'shiftUp', down: 'shiftDown' },
}

/**
 * One name per physical key, so a binding survives the shift state.
 *
 * `+` and `=` are the same key on most layouts and `_` and `-` likewise, which
 * matters because reaching for a harder gear should not require finding the
 * shifted form mid-climb.
 */
export function normaliseKey(key: string): string {
  if (key === '=' || key === '+') return '+'
  if (key === '_' || key === '-') return '-'
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase()
}

/** How to write a key so a rider recognises it in the settings panel. */
export function describeKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  // arrowup -> Arrow up
  const spaced = key.replace(/^arrow/, 'arrow ').replace(/^page/, 'page ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function actionForKey(bindings: Bindings, key: string): RideAction | undefined {
  return bindings.keys[normaliseKey(key)]
}

/** Stored bindings outlive code changes, so nothing here is trusted. */
export function sanitizeBindings(raw: unknown, legacySwapButtons = false): Bindings {
  const fallbackClick: Bindings['click'] = legacySwapButtons
    ? { up: 'shiftDown', down: 'shiftUp' }
    : DEFAULT_BINDINGS.click

  if (typeof raw !== 'object' || raw === null) {
    return { keys: { ...DEFAULT_BINDINGS.keys }, click: fallbackClick }
  }

  const input = raw as Partial<Record<keyof Bindings, unknown>>

  const keys: Record<string, RideAction> = {}
  if (typeof input.keys === 'object' && input.keys !== null) {
    for (const [key, action] of Object.entries(input.keys)) {
      if (key.length > 0 && isRideAction(action)) keys[normaliseKey(key)] = action
    }
  }

  const click = (input.click ?? {}) as Partial<Record<'up' | 'down', unknown>>

  return {
    // An empty table is a legitimate choice — a rider who unbound everything
    // should not silently get the defaults back on the next load.
    keys: input.keys === undefined ? { ...DEFAULT_BINDINGS.keys } : keys,
    click: {
      up: isRideAction(click.up) ? click.up : fallbackClick.up,
      down: isRideAction(click.down) ? click.down : fallbackClick.down,
    },
  }
}

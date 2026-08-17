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
  /**
   * Per-button overrides, keyed by the id the device reports. Only these can
   * describe a unit whose layout we guessed wrong — which is most of the point,
   * since the layout is not documented and varies with firmware.
   */
  buttons: Record<string, RideAction>
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
  buttons: {},
}

/**
 * Which of the two roles a known button plays, before the rider says otherwise.
 * Anything not listed has no default at all: an unrecognised button does
 * nothing until it is bound, rather than guessing and shifting the wrong way.
 */
const DEFAULT_ROLE: Record<string, 'up' | 'down'> = {
  'v1:1': 'up',
  'v1:2': 'down',
  'v2:0x200': 'up',
  'v2:0x400': 'down',
  'v2:0x2000': 'up',
  'v2:0x4000': 'down',
}

/** What a shifter button should do: the rider's override, then the default. */
export function actionForButton(bindings: Bindings, id: string): RideAction {
  const bound = bindings.buttons[id]
  if (bound !== undefined) return bound

  const role = DEFAULT_ROLE[id]
  if (role === 'up') return bindings.click.up
  if (role === 'down') return bindings.click.down
  return 'nothing'
}

/** Whether this button is one we would have guessed at. */
export function isKnownButton(id: string): boolean {
  return id in DEFAULT_ROLE
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
    return { keys: { ...DEFAULT_BINDINGS.keys }, click: fallbackClick, buttons: {} }
  }

  const input = raw as Partial<Record<keyof Bindings, unknown>>

  const keys: Record<string, RideAction> = {}
  if (typeof input.keys === 'object' && input.keys !== null) {
    for (const [key, action] of Object.entries(input.keys)) {
      if (key.length > 0 && isRideAction(action)) keys[normaliseKey(key)] = action
    }
  }

  const click = (input.click ?? {}) as Partial<Record<'up' | 'down', unknown>>

  const buttons: Record<string, RideAction> = {}
  if (typeof input.buttons === 'object' && input.buttons !== null) {
    for (const [id, action] of Object.entries(input.buttons)) {
      if (id.length > 0 && isRideAction(action)) buttons[id] = action
    }
  }

  return {
    buttons,
    // An empty table is a legitimate choice — a rider who unbound everything
    // should not silently get the defaults back on the next load.
    keys: input.keys === undefined ? { ...DEFAULT_BINDINGS.keys } : keys,
    click: {
      up: isRideAction(click.up) ? click.up : fallbackClick.up,
      down: isRideAction(click.down) ? click.down : fallbackClick.down,
    },
  }
}

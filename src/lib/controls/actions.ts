/**
 * Everything a control can be made to do.
 *
 * Keys and Click buttons are both just ways of naming one of these, which is
 * what lets either be remapped without the ride engine knowing where the
 * instruction came from.
 */

export const RIDE_ACTIONS = [
  'shiftUp',
  'shiftDown',
  'powerUp1',
  'powerDown1',
  'powerUp10',
  'powerDown10',
  'powerUp50',
  'powerDown50',
  'togglePower',
  'togglePause',
  'nextStep',
  'previousStep',
  'speakStatus',
  'nothing',
] as const

export type RideAction = (typeof RIDE_ACTIONS)[number]

export const ACTION_LABELS: Record<RideAction, string> = {
  shiftUp: 'Harder gear',
  shiftDown: 'Easier gear',
  powerUp1: '+1 W',
  powerDown1: '−1 W',
  powerUp10: '+10 W',
  powerDown10: '−10 W',
  powerUp50: '+50 W',
  powerDown50: '−50 W',
  togglePower: 'Hold power on/off',
  togglePause: 'Pause or resume',
  nextStep: 'Skip to next step',
  previousStep: 'Back a step',
  speakStatus: 'Read the numbers aloud',
  nothing: 'Nothing',
}

/** Watts an action moves the target by, or `undefined` if it is not a nudge. */
export const POWER_STEP: Partial<Record<RideAction, number>> = {
  powerUp1: 1,
  powerDown1: -1,
  powerUp10: 10,
  powerDown10: -10,
  powerUp50: 50,
  powerDown50: -50,
}

export function isRideAction(value: unknown): value is RideAction {
  return typeof value === 'string' && (RIDE_ACTIONS as readonly string[]).includes(value)
}

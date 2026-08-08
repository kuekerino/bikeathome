/**
 * What to ask the browser's device chooser for.
 *
 * The chooser filters on **advertisement data only**. A service the trainer
 * implements but does not put in its advertising packet is invisible here, no
 * matter that it works perfectly once connected. Filtering on FTMS alone is
 * therefore a trap: several trainers, Wahoo's among them, advertise Cycling
 * Power and their own vendor service and leave FTMS to be discovered after
 * the connection is open. The chooser then sits there scanning forever and
 * finds nothing, which looks like a broken trainer rather than a too-narrow
 * filter.
 *
 * So match on what trainers actually advertise, and keep FTMS in
 * `optionalServices` so it can still be used once connected.
 */

import { CYCLING_POWER_SERVICE, FTMS_SERVICE } from './ftms'
import { ZWIFT_SERVICE_V1, ZWIFT_SERVICE_V2 } from './zwiftClickProtocol'

export const DEVICE_INFORMATION = 0x180a
export const BATTERY_SERVICE = 0x180f

/** Wahoo's vendor service, advertised by KICKRs that predate their FTMS support. */
export const WAHOO_SERVICE = 0xa026

const TRAINER_SERVICES = [
  FTMS_SERVICE,
  CYCLING_POWER_SERVICE,
  WAHOO_SERVICE,
  DEVICE_INFORMATION,
  BATTERY_SERVICE,
]

const CLICK_SERVICES = [ZWIFT_SERVICE_V1, ZWIFT_SERVICE_V2, DEVICE_INFORMATION, BATTERY_SERVICE]

/** Heart Rate Service — a Bluetooth SIG standard every strap advertises. */
export const HEART_RATE_SERVICE = 0x180d

const HEART_RATE_SERVICES = [HEART_RATE_SERVICE, DEVICE_INFORMATION, BATTERY_SERVICE]

/**
 * @param showEverything drops the filters entirely and lists every Bluetooth
 * device in range. The last resort when a trainer advertises nothing we
 * recognise — the rider can still see it and pick it by name.
 */
export function trainerRequest(showEverything = false): RequestDeviceOptions {
  if (showEverything) return { acceptAllDevices: true, optionalServices: TRAINER_SERVICES }
  return {
    // Cycling Power is the one every smart trainer advertises, which makes it
    // a better net than FTMS despite FTMS being what we go on to speak.
    filters: [
      { services: [FTMS_SERVICE] },
      { services: [CYCLING_POWER_SERVICE] },
      { services: [WAHOO_SERVICE] },
    ],
    optionalServices: TRAINER_SERVICES,
  }
}

export function clickRequest(showEverything = false): RequestDeviceOptions {
  if (showEverything) return { acceptAllDevices: true, optionalServices: CLICK_SERVICES }
  return {
    // Either a Zwift-branded name or one of the two services, since which a
    // given unit advertises is not consistent across firmware.
    filters: [
      { namePrefix: 'Zwift' },
      { services: [ZWIFT_SERVICE_V1] },
      { services: [ZWIFT_SERVICE_V2] },
    ],
    optionalServices: CLICK_SERVICES,
  }
}

export function heartRateRequest(showEverything = false): RequestDeviceOptions {
  if (showEverything) return { acceptAllDevices: true, optionalServices: HEART_RATE_SERVICES }
  // Straps do advertise their service, unlike some trainers, so one filter is
  // genuinely enough here.
  return {
    filters: [{ services: [HEART_RATE_SERVICE] }],
    optionalServices: HEART_RATE_SERVICES,
  }
}

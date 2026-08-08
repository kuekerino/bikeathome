/**
 * Which devices this browser has already been given permission to use.
 *
 * Web Bluetooth hands back an opaque, origin-scoped id per device. It says
 * nothing about what the device *is*, so remembering which id was the trainer
 * and which was the shifter is our job — otherwise reconnecting means guessing
 * from names, and a trainer is free to call itself anything.
 *
 * The ids are meaningless outside this browser and this origin, so there is
 * nothing here worth protecting.
 */

const STORAGE_KEY = 'bikeathome.devices.v1'

export type DeviceRole = 'trainer' | 'click' | 'heartRate'

export type KnownDevices = Record<DeviceRole, string | null>

export const NO_KNOWN_DEVICES: KnownDevices = { trainer: null, click: null, heartRate: null }

/** Stored ids outlive code changes, so treat whatever comes back as hostile. */
export function sanitizeKnownDevices(raw: unknown): KnownDevices {
  if (typeof raw !== 'object' || raw === null) return NO_KNOWN_DEVICES

  const input = raw as Partial<Record<DeviceRole, unknown>>
  const id = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null

  return { trainer: id(input.trainer), click: id(input.click), heartRate: id(input.heartRate) }
}

export function loadKnownDevices(): KnownDevices {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null ? NO_KNOWN_DEVICES : sanitizeKnownDevices(JSON.parse(raw))
  } catch {
    // Private browsing, disabled storage, or something that is not JSON.
    return NO_KNOWN_DEVICES
  }
}

export function rememberDevice(role: DeviceRole, id: string | undefined): void {
  if (!id) return
  save({ ...loadKnownDevices(), [role]: id })
}

export function forgetDevice(role: DeviceRole): void {
  save({ ...loadKnownDevices(), [role]: null })
}

function save(devices: KnownDevices): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(devices))
  } catch {
    // Remembering is a convenience; failing to is not worth interrupting a ride.
  }
}

/**
 * Chrome only exposes previously-granted devices behind a flag, and only over
 * a secure context. Without it the rider pairs by hand, exactly as before.
 */
export function canResumePairings(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.bluetooth?.getDevices === 'function'
}

/** Finds the remembered device among the ones this origin may still use. */
export function pick(
  granted: readonly BluetoothDevice[],
  id: string | null,
): BluetoothDevice | undefined {
  if (id === null) return undefined
  return granted.find((device) => device.id === id)
}

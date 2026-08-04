/**
 * GATT manners that are easy to get wrong, and hard to diagnose when you do.
 *
 * Chrome reports most peripheral-side rejections as "GATT operation failed for
 * unknown reason" — no operation, no characteristic, no cause. Since none of
 * this can be exercised without the hardware in the room, the least we can do
 * is make the message name the step it died on.
 */

export interface WriteProperties {
  write: boolean
  writeWithoutResponse: boolean
}

export type WriteMode = 'with-response' | 'without-response'

/**
 * Which write to attempt, in order.
 *
 * Writing *with* response to a characteristic that only accepts writes
 * *without* one is refused by the device, and that refusal is one of the
 * things hiding behind the "unknown reason" message. So ask the characteristic
 * what it declares, and keep the other mode as a fallback — declared
 * properties and actual behaviour do not always agree on reverse-engineered
 * hardware.
 */
export function writeOrder(properties: WriteProperties): WriteMode[] {
  const modes: WriteMode[] = []
  if (properties.write) modes.push('with-response')
  if (properties.writeWithoutResponse) modes.push('without-response')
  if (modes.length > 0) {
    // Whichever it declared first, still keep the other as a second chance.
    for (const mode of ['with-response', 'without-response'] as const) {
      if (!modes.includes(mode)) modes.push(mode)
    }
    return modes
  }
  // Declared neither. Try anyway rather than refusing to speak at all.
  return ['with-response', 'without-response']
}

/** Writes using whichever mode the characteristic will actually accept. */
export async function writeValue(
  characteristic: BluetoothRemoteGATTCharacteristic,
  data: BufferSource,
): Promise<void> {
  let last: unknown
  for (const mode of writeOrder(characteristic.properties)) {
    try {
      if (mode === 'with-response') await characteristic.writeValueWithResponse(data)
      else await characteristic.writeValueWithoutResponse(data)
      return
    } catch (cause) {
      last = cause
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

/**
 * Gives up after `ms`.
 *
 * `gatt.connect()` on a device that is switched off does not reliably reject —
 * it can sit there indefinitely waiting for something that will never
 * advertise. Fine for a button the rider pressed; not fine for a reconnect
 * attempt on page load, which would leave the row saying "connecting" forever.
 */
export async function withTimeout<T>(ms: number, what: string, run: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms.`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Names the step in the error, because the browser's message will not. */
export async function during<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`${what}: ${detail}`, { cause })
  }
}

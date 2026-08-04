/**
 * Why Web Bluetooth is unavailable, and what to do about it.
 *
 * `navigator.bluetooth === undefined` is a single symptom with three quite
 * different causes, and the advice for each contradicts the others. Telling
 * everyone to "use Chrome" is wrong on an iPad, where Chrome is Safari with a
 * different icon, and wrong again behind plain HTTP, where the browser is
 * already the right one.
 */

export interface Platform {
  /** `navigator.bluetooth !== undefined`. */
  hasBluetooth: boolean
  /** `navigator.userAgent`. */
  userAgent: string
  /** `navigator.maxTouchPoints` — the only way to tell an iPad from a Mac. */
  maxTouchPoints: number
  /** `window.isSecureContext`. */
  isSecureContext: boolean
}

/**
 * iPadOS reports itself as "Macintosh; Intel Mac OS X" and has done since
 * iPadOS 13, so the user agent alone cannot see it. A Mac has no touch screen
 * and an iPad has five, which is the distinction that survives.
 */
export function isAppleMobile({ userAgent, maxTouchPoints }: Platform): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1
}

/**
 * The note to show above the pairing buttons, or `undefined` when pairing
 * works and there is nothing to say.
 */
export function bluetoothNote(platform: Platform): string | undefined {
  if (platform.hasBluetooth) return undefined

  if (isAppleMobile(platform)) {
    return (
      'iPhones and iPads cannot pair Bluetooth devices from a browser — Chrome and Edge ' +
      'are Safari underneath on iOS, so installing one will not help. Ride from a computer ' +
      'running Chrome or Edge. The demo trainer works here.'
    )
  }

  // A page served over plain HTTP to anything but localhost loads perfectly and
  // silently loses Bluetooth. Worth naming, because nothing else on screen hints
  // at it.
  if (!platform.isSecureContext) {
    return (
      'This page is not served over HTTPS, so the browser blocks Bluetooth. Reach it over ' +
      'https:// or from localhost. The demo trainer works here.'
    )
  }

  return (
    'This browser cannot pair Bluetooth devices. Safari and Firefox do not implement Web ' +
    'Bluetooth — use Chrome or Edge on a computer. The demo trainer works here.'
  )
}

/** Reads the live browser. Separated so {@link bluetoothNote} stays pure. */
export function currentPlatform(): Platform {
  if (typeof navigator === 'undefined') {
    return { hasBluetooth: false, userAgent: '', maxTouchPoints: 0, isSecureContext: false }
  }
  return {
    hasBluetooth: navigator.bluetooth !== undefined,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext,
  }
}

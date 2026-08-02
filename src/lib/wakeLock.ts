/**
 * Keeps the screen on during a ride. Nobody touches the keyboard for twenty
 * minutes on a climb, and watching the dashboard go dark mid-effort is a poor
 * way to find that out.
 *
 * The browser drops the lock whenever the tab is hidden, so what is wanted and
 * what is held are tracked separately and reconciled when the tab comes back.
 */

let wanted = false
let sentinel: WakeLockSentinel | null = null
let listening = false

export function keepScreenAwake(active: boolean): void {
  wanted = active
  listen()
  void reconcile()
}

async function reconcile(): Promise<void> {
  if (typeof document === 'undefined' || !('wakeLock' in navigator)) return

  if (!wanted) {
    const held = sentinel
    sentinel = null
    await held?.release().catch(() => undefined)
    return
  }

  // Requesting while hidden always fails, so wait to be asked again.
  if (sentinel || document.visibilityState !== 'visible') return

  try {
    const lock = await navigator.wakeLock.request('screen')
    // A lock released by the browser has to be forgotten, or the tab coming
    // back finds a stale sentinel and never asks for a new one.
    lock.addEventListener('release', () => {
      if (sentinel === lock) sentinel = null
    })
    sentinel = lock
  } catch {
    // Denied, unsupported, or the battery saver said no. Not worth a ride.
  }
}

function listen(): void {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('visibilitychange', () => void reconcile())
}

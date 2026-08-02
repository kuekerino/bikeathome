/**
 * The keyboard as a shifter. Always available alongside whatever hardware is
 * paired: useful in demo mode, and worth keeping during a real ride as a
 * fallback for when the Click drops off mid-climb.
 */

import type { ConnectionState, Shifter } from './types'

const UP_KEYS = new Set(['+', '=', 'ArrowUp'])
const DOWN_KEYS = new Set(['-', '_', 'ArrowDown'])

export class KeyboardShifter implements Shifter {
  readonly label = 'Keyboard'

  onshift: ((direction: 1 | -1) => void) | null = null
  onbattery: ((percent: number) => void) | null = null
  onstate: ((state: ConnectionState, detail?: string) => void) | null = null

  private connection: ConnectionState = 'disconnected'
  private readonly handler = (event: KeyboardEvent) => this.handle(event)

  get state(): ConnectionState {
    return this.connection
  }

  async connect(): Promise<void> {
    if (typeof window === 'undefined') return
    window.addEventListener('keydown', this.handler)
    this.setState('connected')
  }

  async disconnect(): Promise<void> {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handler)
    }
    this.setState('disconnected')
  }

  private handle(event: KeyboardEvent): void {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
    if (isTyping(event.target)) return

    const direction = UP_KEYS.has(event.key) ? 1 : DOWN_KEYS.has(event.key) ? -1 : 0
    if (direction === 0) return

    // Stop the arrows scrolling the dashboard out from under the rider.
    event.preventDefault()
    this.onshift?.(direction)
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.connection = state
    this.onstate?.(state, detail)
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

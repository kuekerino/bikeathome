/**
 * The keyboard as a general control surface.
 *
 * Always live alongside whatever hardware is paired: useful in demo mode, and
 * worth keeping during a real ride as a fallback for when the Click drops off
 * mid-climb.
 */

import type { ConnectionState, Device } from '../ble/types'
import type { RideAction } from './actions'
import { actionForKey, DEFAULT_BINDINGS, type Bindings } from './bindings'

export class KeyboardControls implements Device {
  readonly label = 'Keyboard'

  onaction: ((action: RideAction) => void) | null = null
  onstate: ((state: ConnectionState, detail?: string) => void) | null = null

  private connection: ConnectionState = 'disconnected'
  private bindings: Bindings = DEFAULT_BINDINGS
  private readonly handler = (event: KeyboardEvent) => this.handle(event)

  get state(): ConnectionState {
    return this.connection
  }

  configure(bindings: Bindings): void {
    this.bindings = bindings
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

    const action = actionForKey(this.bindings, event.key)
    if (action === undefined || action === 'nothing') return

    // Stop the arrows scrolling the dashboard out from under the rider, and
    // space from pressing whatever button happens to have focus.
    event.preventDefault()
    this.onaction?.(action)
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

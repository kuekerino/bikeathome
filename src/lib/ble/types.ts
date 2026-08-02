/**
 * What the ride engine needs from a trainer and a shifter, with no mention of
 * Bluetooth. The real devices implement these in phase 7; the simulated ones
 * implement them now, which is what lets the whole app run without hardware.
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface TrainerData {
  /** Watts the rider is producing. */
  powerW?: number
  cadenceRpm?: number
  /**
   * The trainer's own idea of wheel speed. Shown for diagnostics only — the
   * ride's speed is worked out from power and the route, not from this.
   */
  speedKmh?: number
}

export interface Device {
  /** Shown in the connection panel. */
  readonly label: string
  readonly state: ConnectionState
  connect(): Promise<void>
  disconnect(): Promise<void>
  onstate: ((state: ConnectionState, detail?: string) => void) | null
}

export interface Trainer extends Device {
  /**
   * Ask the trainer to simulate this gradient, in percent. Called every tick;
   * implementations are expected to coalesce and rate-limit to suit their own
   * link rather than assuming the caller has done it for them.
   */
  setSimulation(gradientPct: number): Promise<void>
  ondata: ((data: TrainerData) => void) | null
}

export interface Shifter extends Device {
  onshift: ((direction: 1 | -1) => void) | null
  onbattery: ((percent: number) => void) | null
}

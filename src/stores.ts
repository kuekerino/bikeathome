/**
 * The app's single ride session: one engine, whichever devices are attached,
 * and the timer that drives it.
 */

import { KeyboardShifter } from './lib/ble/keyboardShifter'
import { SimulatedTrainer } from './lib/ble/simulatedTrainer'
import type { Trainer } from './lib/ble/types'
import { parseGpx } from './lib/gpx/parser'
import { Route } from './lib/gpx/route'
import { RideEngine } from './lib/ride/engine'

/** Four times a second: fast enough to feel immediate, slow enough to be free. */
const TICK_MS = 250

export const engine = new RideEngine()

/** Always available, even with a Click paired, as a fallback mid-ride. */
export const keyboardShifter = new KeyboardShifter()

export function startSession(): () => void {
  void keyboardShifter.connect()
  engine.attachShifter(keyboardShifter)

  const timer = setInterval(() => engine.tick(performance.now()), TICK_MS)

  return () => {
    clearInterval(timer)
    void keyboardShifter.disconnect()
  }
}

export async function useSimulatedTrainer(): Promise<Trainer> {
  const trainer = new SimulatedTrainer()
  await trainer.connect()
  engine.attachTrainer(trainer)
  return trainer
}

export function loadRouteFromText(xml: string): void {
  engine.setRoute(Route.from(parseGpx(xml)))
}

export async function loadDemoRoute(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}demo-route.gpx`)
  if (!response.ok) throw new Error(`Could not load the demo route (${response.status}).`)
  loadRouteFromText(await response.text())
}

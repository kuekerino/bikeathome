/**
 * The app's single ride session: one engine, whichever devices are attached,
 * and the timer that drives it.
 */

import { FtmsTrainer } from './lib/ble/ftmsTrainer'
import { KeyboardShifter } from './lib/ble/keyboardShifter'
import { SimulatedTrainer } from './lib/ble/simulatedTrainer'
import type { Shifter, Trainer } from './lib/ble/types'
import { ZwiftClick } from './lib/ble/zwiftClick'
import { parseGpx } from './lib/gpx/parser'
import { Route } from './lib/gpx/route'
import { RideEngine } from './lib/ride/engine'
import { RideRecorder } from './lib/ride/recorder'
import { buildTcx, tcxFilename } from './lib/ride/tcx'
import { loadSettings, saveSettings, type AppSettings } from './lib/settings'

/** Four times a second: fast enough to feel immediate, cheap enough to ignore. */
const TICK_MS = 250

export const engine = new RideEngine()
export const recorder = new RideRecorder()

/** Always available, even with a Click paired, as a fallback mid-ride. */
export const keyboardShifter = new KeyboardShifter()
export const zwiftClick = new ZwiftClick()

let simulated: SimulatedTrainer | null = null
let ftms: FtmsTrainer | null = null

export function startSession(): () => void {
  applySettings(loadSettings())

  void keyboardShifter.connect()
  engine.addShifter(keyboardShifter)

  const timer = setInterval(() => {
    // The engine wants a monotonic clock so a system time change cannot make
    // the rider jump. The recorder wants wall clock, because its timestamps
    // end up in a file other software has to read.
    engine.tick(performance.now())
    recorder.record(engine.snapshot(), Date.now())
  }, TICK_MS)

  return () => {
    clearInterval(timer)
    void keyboardShifter.disconnect()
  }
}

export function startRide(): void {
  recorder.reset()
  engine.start()
}

/** Hands the recorded ride to the browser as a TCX download. */
export function exportRide(): void {
  const startedAt = recorder.startedAt
  if (startedAt === null) throw new Error('Nothing recorded yet — ride first, then export.')

  const xml = buildTcx(recorder.samples, { name: engine.snapshot().routeName ?? undefined })
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.garmin.tcx+xml' }))

  const link = document.createElement('a')
  link.href = url
  link.download = tcxFilename(startedAt)
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Push settings everywhere they matter. The simulated trainer needs them too,
 * or the demo rider's physics stops agreeing with the ride's.
 */
export function applySettings(settings: AppSettings): void {
  engine.configure(settings)
  simulated?.configure({ rider: settings.rider, drivetrain: settings.drivetrain })
  // The trainer re-adds rolling and drag on top of whatever gradient it is
  // given, so it needs the same coefficients the app subtracted out.
  ftms?.configure(settings.rider)
  zwiftClick.configure(settings.shifter)
  saveSettings(settings)
}

export async function useSimulatedTrainer(): Promise<Trainer> {
  simulated ??= new SimulatedTrainer()
  await simulated.connect()
  engine.attachTrainer(simulated)
  return simulated
}

/**
 * Both of these open the browser's device chooser, so both need a click.
 *
 * `showEverything` drops the service filters and lists every Bluetooth device
 * in range — the way out when a device advertises nothing we match on.
 */
export async function pairTrainer(showEverything = false): Promise<Trainer> {
  ftms ??= new FtmsTrainer()
  ftms.configure(loadSettings().rider)
  await ftms.connect(showEverything)
  engine.attachTrainer(ftms)
  return ftms
}

export async function pairShifter(showEverything = false): Promise<Shifter> {
  await zwiftClick.connect(showEverything)
  engine.addShifter(zwiftClick)
  return zwiftClick
}

/** Web Bluetooth is Chrome and Edge only, and needs HTTPS or localhost. */
export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && navigator.bluetooth !== undefined
}

export function loadRouteFromText(xml: string): void {
  engine.setRoute(Route.from(parseGpx(xml)))
  recorder.reset()
}

export async function loadDemoRoute(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}demo-route.gpx`)
  if (!response.ok) throw new Error(`Could not load the demo route (${response.status}).`)
  loadRouteFromText(await response.text())
}

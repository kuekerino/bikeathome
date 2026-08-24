/**
 * The app's single ride session: one engine, whichever devices are attached,
 * and the timer that drives it.
 */

import { FtmsTrainer } from './lib/ble/ftmsTrainer'
import { HeartRateMonitor } from './lib/ble/heartRate'
import { withTimeout } from './lib/ble/gatt'
import { canResumePairings, loadKnownDevices, pick, rememberDevice } from './lib/ble/knownDevices'
import { SimulatedTrainer } from './lib/ble/simulatedTrainer'
import type { Shifter, Trainer } from './lib/ble/types'
import { ZwiftClick } from './lib/ble/zwiftClick'
import { KeyboardControls } from './lib/controls/keyboard'
import { parseGpx } from './lib/gpx/parser'
import { historyAvailable, loadTrack, saveRide } from './lib/history/store'
import { summarise } from './lib/history/summary'
import type { Workout } from './lib/workout/model'
import { parseZwo } from './lib/workout/zwo'
import { Route } from './lib/gpx/route'
import { RideEngine } from './lib/ride/engine'
import { RideRecorder } from './lib/ride/recorder'
import { buildTcx, tcxFilename } from './lib/ride/tcx'
import { loadSettings, saveSettings, type AppSettings } from './lib/settings'

/** Four times a second: fast enough to feel immediate, cheap enough to ignore. */
const TICK_MS = 250

/**
 * How often a ride in progress is written to the history.
 *
 * The point is not tidiness: without it, closing the tab or a browser crash
 * forty minutes in loses the whole ride, and the rider finds out afterwards.
 * Each save replaces the last, keyed on when the ride began.
 */
const AUTOSAVE_MS = 30_000

export const engine = new RideEngine()
export const recorder = new RideRecorder()

/** Always available, even with a Click paired, as a fallback mid-ride. */
export const keyboard = new KeyboardControls()
export const zwiftClick = new ZwiftClick()
export const heartRate = new HeartRateMonitor()

let simulated: SimulatedTrainer | null = null
let ftms: FtmsTrainer | null = null
let loadedWorkout: Workout | null = null
let lastSavedAt = 0

export function startSession(): () => void {
  applySettings(loadSettings())

  void keyboard.connect()
  keyboard.onaction = (action) => engine.perform(action)

  const timer = setInterval(() => {
    // The engine wants a monotonic clock so a system time change cannot make
    // the rider jump. The recorder wants wall clock, because its timestamps
    // end up in a file other software has to read.
    engine.tick(performance.now())
    const snapshot = engine.snapshot()
    recorder.record(snapshot, Date.now())

    const now = Date.now()
    if (snapshot.status === 'riding' && now - lastSavedAt >= AUTOSAVE_MS) {
      lastSavedAt = now
      void rememberRide()
    }
  }, TICK_MS)

  // Closing the tab is the commonest way a ride ends, and it gives no warning.
  const onLeaving = () => void rememberRide()
  window.addEventListener('pagehide', onLeaving)

  return () => {
    clearInterval(timer)
    window.removeEventListener('pagehide', onLeaving)
    void keyboard.disconnect()
  }
}

/**
 * Writes whatever has been recorded so far to the history.
 *
 * Failure is swallowed on purpose: a full disk or a private window must not
 * interrupt a ride, and the rider can still export by hand.
 */
export async function rememberRide(): Promise<void> {
  if (!historyAvailable() || recorder.isEmpty) return

  const snapshot = engine.snapshot()
  const summary = summarise(recorder.samples, {
    routeName: snapshot.routeName,
    workout: loadedWorkout,
    mode: snapshot.mode,
    climbedM: snapshot.climbed,
  })
  if (!summary) return

  try {
    await saveRide(summary, recorder.samples, loadedWorkout)
  } catch {
    // Out of quota, or storage blocked entirely. Not worth a ride.
  }
}

export function startRide(): void {
  recorder.reset()
  lastSavedAt = Date.now()
  engine.start()
}

/** Hands the recorded ride to the browser as a TCX download. */
export function exportRide(): void {
  const startedAt = recorder.startedAt
  if (startedAt === null) throw new Error('Nothing recorded yet — ride first, then export.')

  download(
    buildTcx(recorder.samples, { name: engine.snapshot().routeName ?? undefined }),
    tcxFilename(startedAt),
  )
}

function download(xml: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.garmin.tcx+xml' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
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
  engine.bindings = settings.bindings
  engine.heartRateCap = settings.heartRateCap
  engine.setFtp(settings.ftpW)
  keyboard.configure(settings.bindings)
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
  rememberDevice('trainer', ftms.deviceId)
  return ftms
}

export async function pairHeartRate(showEverything = false): Promise<HeartRateMonitor> {
  await heartRate.connect(showEverything)
  adoptHeartRate()
  rememberDevice('heartRate', heartRate.deviceId)
  return heartRate
}

/**
 * A strap that goes away must stop feeding the engine, or the last reading
 * would sit there forever holding the power down.
 */
function adoptHeartRate(): void {
  heartRate.onreading = ({ bpm }) => engine.setHeartRate(bpm)
  const previous = heartRate.onstate
  heartRate.onstate = (state, detail) => {
    if (state === 'disconnected' || state === 'error') engine.setHeartRate(null)
    previous?.(state, detail)
  }
}

export async function pairShifter(showEverything = false): Promise<Shifter> {
  await zwiftClick.connect(showEverything)
  engine.addShifter(zwiftClick)
  rememberDevice('click', zwiftClick.deviceId)
  return zwiftClick
}

/** How long to wait for a remembered device before giving up on it quietly. */
const RESUME_TIMEOUT_MS = 8000

export interface Resumed {
  trainer?: Trainer
  click?: Shifter
  heartRate?: HeartRateMonitor
}

/**
 * Reconnects to devices this browser already has permission for, with no
 * chooser and no click.
 *
 * Every failure here is silent by design: the rider did not ask for this, so a
 * trainer that is switched off should look like a trainer that was never
 * paired, not like an error. The pairing buttons stay exactly where they were.
 */
export async function resumePairings(): Promise<Resumed> {
  const known = loadKnownDevices()
  const nothingKnown = known.trainer === null && known.click === null && known.heartRate === null
  if (!canResumePairings() || nothingKnown) return {}

  let granted: BluetoothDevice[]
  try {
    granted = await navigator.bluetooth.getDevices()
  } catch {
    return {}
  }

  const resumed: Resumed = {}

  const trainerDevice = pick(granted, known.trainer)
  if (trainerDevice) {
    ftms ??= new FtmsTrainer()
    ftms.configure(loadSettings().rider)
    try {
      await withTimeout(RESUME_TIMEOUT_MS, 'Reconnecting to the trainer', ftms.resume(trainerDevice))
      engine.attachTrainer(ftms)
      resumed.trainer = ftms
    } catch {
      // Out of range, asleep, or claimed by another app. Pair by hand.
    }
  }

  const clickDevice = pick(granted, known.click)
  if (clickDevice) {
    try {
      await withTimeout(RESUME_TIMEOUT_MS, 'Reconnecting to the Click', zwiftClick.resume(clickDevice))
      engine.addShifter(zwiftClick)
      resumed.click = zwiftClick
    } catch {
      // The keyboard is still there.
    }
  }

  const strapDevice = pick(granted, known.heartRate)
  if (strapDevice) {
    try {
      await withTimeout(RESUME_TIMEOUT_MS, 'Reconnecting to the strap', heartRate.resume(strapDevice))
      adoptHeartRate()
      resumed.heartRate = heartRate
    } catch {
      // Straps sleep when they are off a chest. Pair by hand.
    }
  }

  return resumed
}

/** Web Bluetooth is Chrome and Edge only, and needs HTTPS or localhost. */
export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && navigator.bluetooth !== undefined
}

export function loadRouteFromText(xml: string): void {
  engine.setRoute(Route.from(parseGpx(xml)))
  recorder.reset()
}

/**
 * Reads a Zwift workout without committing to it, so a file that will not parse
 * cannot half-change the screen on its way to failing.
 */
export function parseWorkout(xml: string): Workout {
  return parseZwo(xml)
}

/** A workout drives the power; the route, if any, still drives distance. */
export function setWorkout(workout: Workout): void {
  loadedWorkout = workout
  engine.setWorkout(workout)
}

/** Loads the workout a past ride followed, so it can be ridden again. */
export async function repeatRide(id: number): Promise<Workout | null> {
  const track = await loadTrack(id)
  if (!track?.workout) return null
  setWorkout(track.workout)
  return track.workout
}

/** Rebuilds the TCX for a ride that finished long ago. */
export async function exportSavedRide(id: number, name: string): Promise<void> {
  const track = await loadTrack(id)
  if (!track || track.samples.length === 0) {
    throw new Error('That ride has no recorded track to export.')
  }
  download(buildTcx(track.samples, { name }), tcxFilename(track.samples[0]!.time))
}

export function clearWorkout(): void {
  loadedWorkout = null
  engine.setWorkout(null)
}

/** Where free ride starts if the rider has not set a power before. */
const DEFAULT_FREE_RIDE_W = 150

/** No route: flat and endless, for setting a power and pedalling. */
export function startFreeRide(): void {
  engine.setFreeRide()
  // Holding a power *is* the mode, so arrive already holding one rather than
  // making the rider find the switch. Whatever they last chose wins.
  engine.setTargetPower(engine.targetPower ?? DEFAULT_FREE_RIDE_W)
  recorder.reset()
}

export async function loadDemoRoute(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}demo-route.gpx`)
  if (!response.ok) throw new Error(`Could not load the demo route (${response.status}).`)
  loadRouteFromText(await response.text())
}
